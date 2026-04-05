import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { loadConfig } from '@postfiatorg/pft-chatbot-mcp/dist/config.js';
import { deriveBotKeypair } from '@postfiatorg/pft-chatbot-mcp/dist/crypto/keys.js';
import { KeystoneClient } from '@postfiatorg/pft-chatbot-mcp/dist/grpc/client.js';
import { executeGetMessage } from '@postfiatorg/pft-chatbot-mcp/dist/tools/get_message.js';
import { executePing } from '@postfiatorg/pft-chatbot-mcp/dist/tools/ping.js';
import { executeRegisterBot } from '@postfiatorg/pft-chatbot-mcp/dist/tools/register_bot.js';
import { executeScanMessages } from '@postfiatorg/pft-chatbot-mcp/dist/tools/scan_messages.js';
import { executeSendMessage } from '@postfiatorg/pft-chatbot-mcp/dist/tools/send_message.js';

const require = createRequire(import.meta.url);
const {
  AUDIT_MODELS,
  createPublicAuditGist,
  getAuditGistToken,
  getAuditModelById,
  runValidatorAudit,
  validatePublicUrl,
} = require('./audit');
const {
  applyTaskNodeEnvOverrides,
  buildAuditFailureReply,
  buildAuditStartedReply,
  buildAuditSuccessReply,
  getTaskNodeAgentSettings,
  parseAuditRequest,
} = require('./tasknodeAuditAgentShared');

applyTaskNodeEnvOverrides(process.env);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settings = getTaskNodeAgentSettings(process.env);
const stateFilePath = path.resolve(__dirname, '..', settings.statePath);
const stateDirPath = path.dirname(stateFilePath);
const maxProcessedTxHashes = 500;

function log(message, extra) {
  const stamp = new Date().toISOString();
  if (extra === undefined) {
    console.log(`[tasknode-agent] ${stamp} ${message}`);
    return;
  }

  console.log(`[tasknode-agent] ${stamp} ${message}`, extra);
}

function ensureStateDir() {
  fs.mkdirSync(stateDirPath, { recursive: true });
}

function loadState() {
  ensureStateDir();
  if (!fs.existsSync(stateFilePath)) {
    return {
      sinceLedger: null,
      processedTxHashes: [],
      initializedAt: null,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    return {
      sinceLedger: Number.isFinite(parsed?.sinceLedger) ? parsed.sinceLedger : null,
      processedTxHashes: Array.isArray(parsed?.processedTxHashes) ? parsed.processedTxHashes.slice(-maxProcessedTxHashes) : [],
      initializedAt: parsed?.initializedAt || null,
    };
  } catch (err) {
    log(`State file was unreadable. Starting fresh. ${err.message}`);
    return {
      sinceLedger: null,
      processedTxHashes: [],
      initializedAt: null,
    };
  }
}

function saveState(state) {
  ensureStateDir();
  fs.writeFileSync(stateFilePath, JSON.stringify({
    sinceLedger: state.sinceLedger,
    processedTxHashes: state.processedTxHashes.slice(-maxProcessedTxHashes),
    initializedAt: state.initializedAt,
  }, null, 2));
}

function rememberProcessedTx(state, txHash) {
  if (!txHash) return;
  if (!state.processedTxHashes.includes(txHash)) {
    state.processedTxHashes.push(txHash);
    if (state.processedTxHashes.length > maxProcessedTxHashes) {
      state.processedTxHashes = state.processedTxHashes.slice(-maxProcessedTxHashes);
    }
  }
}

function parseJsonResult(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} returned a non-JSON payload: ${err.message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendReply({ config, keypair, grpcClient, inbound, message, replyToTx }) {
  const raw = await executeSendMessage(config, keypair, grpcClient, {
    recipient: inbound.sender,
    message,
    content_type: 'text/plain',
    amount_drops: settings.replyAmountDrops,
    thread_id: inbound.thread_id || inbound.tx_hash,
    reply_to_tx: replyToTx || inbound.tx_hash,
  });

  const result = parseJsonResult(raw, 'send_message');
  if (result.error) {
    throw new Error(result.error);
  }

  return result;
}

async function registerAgent({ config, keypair, grpcClient }) {
  const raw = await executeRegisterBot(config, keypair, grpcClient, {
    name: settings.agentName,
    description: settings.agentDescription,
    capabilities: settings.capabilities,
    commands: settings.commands,
  });

  const result = parseJsonResult(raw, 'register_bot');
  if (result.error || result.registered !== true) {
    throw new Error(result.error || 'Agent registration failed.');
  }

  log(`Agent registered as ${result.name} (${result.agent_id})`);
  return result;
}

async function heartbeat({ keypair, grpcClient }) {
  try {
    const raw = await executePing(keypair, grpcClient);
    const result = parseJsonResult(raw, 'ping');
    log(`Heartbeat ok at ${result.last_ping_at}`);
  } catch (err) {
    log(`Heartbeat failed: ${err.message}`);
  }
}

async function bootstrapCursor({ config, keypair, state }) {
  if (state.sinceLedger !== null) return;
  if (settings.processExistingOnFirstBoot || settings.bootstrapMode === 'process-existing') {
    state.initializedAt = state.initializedAt || new Date().toISOString();
    saveState(state);
    return;
  }

  const raw = await executeScanMessages(config, keypair, {
    direction: 'inbound',
    limit: 100,
  });
  const result = parseJsonResult(raw, 'scan_messages');
  state.sinceLedger = result.next_cursor || state.sinceLedger;
  state.initializedAt = new Date().toISOString();
  saveState(state);
  log(`Bootstrapped cursor to ledger ${state.sinceLedger ?? 'null'} and skipped pre-existing inbound messages.`);
}

async function loadInboundMessage({ config, keypair, messageMeta }) {
  const raw = await executeGetMessage(config, keypair, {
    tx_hash: messageMeta.tx_hash,
  });
  const result = parseJsonResult(raw, 'get_message');
  if (result.error) {
    throw new Error(result.error);
  }

  return {
    ...messageMeta,
    ...result,
  };
}

async function runAuditForInbound({ inbound, config, keypair, grpcClient }) {
  const request = parseAuditRequest(inbound.message || '');
  if (!request.shouldRespond) {
    return { ignored: true };
  }

  if (request.kind === 'usage-error') {
    await sendReply({
      config,
      keypair,
      grpcClient,
      inbound,
      message: request.error,
    });
    return { ignored: false, replied: true };
  }

  const validation = validatePublicUrl(request.url);
  if (!validation.ok) {
    await sendReply({
      config,
      keypair,
      grpcClient,
      inbound,
      message: buildAuditFailureReply(validation.error),
    });
    return { ignored: false, replied: true };
  }

  if (!getAuditGistToken()) {
    await sendReply({
      config,
      keypair,
      grpcClient,
      inbound,
      message: buildAuditFailureReply('GitHub gist publishing is not configured for this agent.'),
    });
    return { ignored: false, replied: true };
  }

  const model = getAuditModelById(settings.auditModel) || AUDIT_MODELS[0];
  const startedReply = await sendReply({
    config,
    keypair,
    grpcClient,
    inbound,
    message: buildAuditStartedReply(validation.normalizedUrl),
  });

  const audit = await runValidatorAudit({
    url: validation.normalizedUrl,
    modelId: model.id,
  });

  const gist = await createPublicAuditGist({
    pageUrl: audit.page.finalUrl,
    modelId: audit.model.id,
    report: audit.report,
  });

  await sendReply({
    config,
    keypair,
    grpcClient,
    inbound,
    replyToTx: startedReply.tx_hash || inbound.tx_hash,
    message: buildAuditSuccessReply({
      requestedUrl: validation.normalizedUrl,
      finalUrl: audit.page.finalUrl,
      modelName: audit.model.name,
      modelId: audit.model.id,
      gistUrl: gist.htmlUrl,
    }),
  });

  return { ignored: false, replied: true };
}

async function scanOnce({ config, keypair, grpcClient, state }) {
  const raw = await executeScanMessages(config, keypair, {
    since_ledger: state.sinceLedger ?? undefined,
    direction: 'inbound',
    limit: 100,
  });
  const result = parseJsonResult(raw, 'scan_messages');
  const messages = Array.isArray(result.messages) ? result.messages : [];

  if (Number.isFinite(result.next_cursor)) {
    state.sinceLedger = result.next_cursor;
  }

  if (messages.length === 0) {
    saveState(state);
    return;
  }

  messages.sort((a, b) => {
    if (a.ledger_index !== b.ledger_index) return a.ledger_index - b.ledger_index;
    return String(a.tx_hash).localeCompare(String(b.tx_hash));
  });

  for (const messageMeta of messages) {
    if (state.processedTxHashes.includes(messageMeta.tx_hash)) {
      continue;
    }

    try {
      const inbound = await loadInboundMessage({ config, keypair, messageMeta });
      const outcome = await runAuditForInbound({ inbound, config, keypair, grpcClient });
      if (!outcome.ignored) {
        log(`Handled inbound message ${messageMeta.tx_hash} from ${messageMeta.sender}`);
      }
    } catch (err) {
      log(`Failed to process inbound message ${messageMeta.tx_hash}: ${err.message}`);
      try {
        await sendReply({
          config,
          keypair,
          grpcClient,
          inbound: messageMeta,
          message: buildAuditFailureReply(err.message),
        });
      } catch (replyErr) {
        log(`Failed to send error reply for ${messageMeta.tx_hash}: ${replyErr.message}`);
      }
    } finally {
      rememberProcessedTx(state, messageMeta.tx_hash);
      saveState(state);
    }
  }
}

async function main() {
  if (!process.env.BOT_SEED && !process.env.BOT_SEED_FILE) {
    throw new Error(
      `Task Node bot seed is not configured. Set TASKNODE_AGENT_SEED_FILE or TASKNODE_AGENT_SEED. ` +
      `Expected seed file path: ${settings.seedPath}`
    );
  }

  const config = loadConfig();
  const keypair = await deriveBotKeypair(config.botSeed);
  const grpcClient = new KeystoneClient(config);
  const state = loadState();

  log(`Starting Task Node audit agent for wallet ${keypair.address}`);

  try {
    await registerAgent({ config, keypair, grpcClient });
    await bootstrapCursor({ config, keypair, state });

    const pingIntervalMs = Number.parseInt(process.env.PING_INTERVAL_MS || '900000', 10) || 900000;
    const heartbeatTimer = setInterval(() => {
      heartbeat({ keypair, grpcClient });
    }, pingIntervalMs);

    const shutdown = () => {
      clearInterval(heartbeatTimer);
      grpcClient.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    while (true) {
      await scanOnce({ config, keypair, grpcClient, state });

      if (process.env.TASKNODE_AGENT_RUN_ONCE === '1') {
        break;
      }

      await sleep(settings.pollIntervalMs);
    }
  } finally {
    grpcClient.close();
  }
}

main().catch(err => {
  console.error(`[tasknode-agent] Fatal: ${err.message}`);
  process.exit(1);
});
