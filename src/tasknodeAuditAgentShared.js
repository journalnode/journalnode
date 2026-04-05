const DEFAULT_AUDIT_MODEL = 'openai/gpt-5.4';
const DEFAULT_POLL_INTERVAL_MS = 15000;
const DEFAULT_STATE_PATH = 'data/tasknode-agent/state.json';
const DEFAULT_SEED_PATH = 'data/tasknode-agent/seed.txt';
const DEFAULT_BOOTSTRAP_MODE = 'skip-existing';
const DEFAULT_AGENT_NAME = 'Journal Node';
const DEFAULT_AGENT_DESCRIPTION = 'LLM-optimization suite by wizbubba';
const DEFAULT_AGENT_CAPABILITIES = ['text-generation', 'validator-audit', 'github-gist'];
const DEFAULT_AGENT_COMMANDS = [
  {
    command: '/audit',
    example: '/audit https://validator.example.com',
    description: 'Audit one public validator webpage and return a public GitHub gist report.',
  },
];

function coerceBoolean(value, defaultValue = false) {
  if (value == null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function applyTaskNodeEnvOverrides(env = process.env) {
  if (!env.BOT_SEED && env.TASKNODE_AGENT_SEED) {
    env.BOT_SEED = env.TASKNODE_AGENT_SEED;
  }

  if (!env.BOT_SEED_FILE && env.TASKNODE_AGENT_SEED_FILE) {
    env.BOT_SEED_FILE = env.TASKNODE_AGENT_SEED_FILE;
  }

  if (!env.KEYSTONE_API_KEY && env.TASKNODE_AGENT_KEYSTONE_API_KEY) {
    env.KEYSTONE_API_KEY = env.TASKNODE_AGENT_KEYSTONE_API_KEY;
  }

  if (!env.PING_INTERVAL_MS && env.TASKNODE_AGENT_PING_INTERVAL_MS) {
    env.PING_INTERVAL_MS = env.TASKNODE_AGENT_PING_INTERVAL_MS;
  }

  return env;
}

function getTaskNodeAgentSettings(env = process.env) {
  return {
    agentName: env.TASKNODE_AGENT_NAME || DEFAULT_AGENT_NAME,
    agentDescription: env.TASKNODE_AGENT_DESCRIPTION || DEFAULT_AGENT_DESCRIPTION,
    capabilities: DEFAULT_AGENT_CAPABILITIES.slice(),
    commands: DEFAULT_AGENT_COMMANDS.slice(),
    auditModel: env.TASKNODE_AGENT_AUDIT_MODEL || DEFAULT_AUDIT_MODEL,
    pollIntervalMs: parsePositiveInt(env.TASKNODE_AGENT_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
    replyAmountDrops: env.TASKNODE_AGENT_REPLY_AMOUNT_DROPS || '1',
    processExistingOnFirstBoot: coerceBoolean(env.TASKNODE_AGENT_PROCESS_EXISTING, false),
    statePath: env.TASKNODE_AGENT_STATE_PATH || DEFAULT_STATE_PATH,
    seedPath: env.TASKNODE_AGENT_SEED_FILE || DEFAULT_SEED_PATH,
    bootstrapMode: env.TASKNODE_AGENT_BOOTSTRAP_MODE || DEFAULT_BOOTSTRAP_MODE,
  };
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractFirstUrl(value) {
  const match = String(value || '').match(/https?:\/\/[^\s<>()]+/i);
  return match ? match[0].replace(/[),.;!?]+$/, '') : '';
}

function parseAuditRequest(messageText) {
  const raw = String(messageText || '').trim();
  if (!raw) {
    return { shouldRespond: false, reason: 'empty-message' };
  }

  const slashMatch = raw.match(/^\/audit\b([\s\S]*)$/i);
  if (slashMatch) {
    const url = extractFirstUrl(slashMatch[1]);
    if (!url) {
      return {
        shouldRespond: true,
        kind: 'usage-error',
        error: 'Usage: `/audit https://your-validator-page.example`',
      };
    }

    return { shouldRespond: true, kind: 'audit', url };
  }

  if (/^https?:\/\//i.test(raw)) {
    return { shouldRespond: true, kind: 'audit', url: extractFirstUrl(raw) };
  }

  return { shouldRespond: false, reason: 'unsupported-message' };
}

function buildAuditStartedReply(url) {
  return normalizeWhitespace(
    `Running the validator-page audit for ${url}. This can take a minute or two. ` +
    'I will reply with a public GitHub gist when the report is ready.'
  );
}

function buildAuditSuccessReply({ requestedUrl, finalUrl, modelName, modelId, gistUrl }) {
  const lines = [
    `Audit complete for ${requestedUrl}`,
    finalUrl && finalUrl !== requestedUrl ? `Resolved URL: ${finalUrl}` : '',
    `Model: ${modelName} (${modelId})`,
    `Public gist: ${gistUrl}`,
  ].filter(Boolean);

  return lines.join('\n');
}

function buildAuditFailureReply(message) {
  return `Audit failed: ${normalizeWhitespace(message || 'Unknown error.')}`;
}

module.exports = {
  DEFAULT_AGENT_CAPABILITIES,
  DEFAULT_AGENT_COMMANDS,
  DEFAULT_AGENT_DESCRIPTION,
  DEFAULT_AGENT_NAME,
  DEFAULT_AUDIT_MODEL,
  applyTaskNodeEnvOverrides,
  buildAuditFailureReply,
  buildAuditStartedReply,
  buildAuditSuccessReply,
  getTaskNodeAgentSettings,
  parseAuditRequest,
};
