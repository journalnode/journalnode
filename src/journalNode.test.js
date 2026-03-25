'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Test data directory (isolated from production)
// ---------------------------------------------------------------------------
const TEST_DATA_DIR = path.join(__dirname, '..', 'data', '_test_journalNode');
const ANCHOR_LEDGER = path.join(TEST_DATA_DIR, 'anchorLedger.jsonl');
const TRADE_JOURNAL = path.join(TEST_DATA_DIR, 'tradeJournal.jsonl');
const SIGNAL_LEDGER = path.join(TEST_DATA_DIR, 'signalLedger.jsonl');

// ---------------------------------------------------------------------------
// Stub: modelReliability
// ---------------------------------------------------------------------------
const scorePredictionCalls = [];
const recordPredictionCalls = [];
require.cache[require.resolve('./modelReliability')] = {
  id: require.resolve('./modelReliability'),
  filename: require.resolve('./modelReliability'),
  loaded: true,
  exports: {
    recordPrediction: (params) => {
      recordPredictionCalls.push(params);
      return `pred-${recordPredictionCalls.length}`;
    },
    scorePrediction: (id, outcome) => {
      scorePredictionCalls.push({ id, outcome });
      return 1.0;
    },
    getModelReliability: () => 1.0,
    getModelStats: () => ({}),
    closeDb: () => {},
  },
};

// ---------------------------------------------------------------------------
// Stub: rawDataPack
// ---------------------------------------------------------------------------
require.cache[require.resolve('./rawDataPack')] = {
  id: require.resolve('./rawDataPack'),
  filename: require.resolve('./rawDataPack'),
  loaded: true,
  exports: {
    assembleDataPack: async ({ ticker }) => ({
      ticker,
      assetClass: 'crypto',
      timeframe: '1W',
      price_current: 67500.0,
      price_history: [],
      market_cap: null,
      recent_news: [],
      sector_peers: [],
      data_freshness_timestamp: new Date().toISOString(),
    }),
    clearCache: () => {},
    _setFetchFn: () => {},
  },
};

// ---------------------------------------------------------------------------
// Stub: modeA — returns a realistic Mode A output
// ---------------------------------------------------------------------------
const MOCK_MODE_A_OUTPUT = {
  scsScore: 72,
  label: 'High Conviction Bullish',
  bullPct: 78,
  bearPct: 22,
  synthesisSummary: 'Majority bullish consensus across agents.',
  semanticProximityKeywords: ['momentum', 'breakout', 'support', 'volume'],
  semanticDecayWarning: false,
  recursiveResearchTriggered: false,
  excluded: [],
  dataFreshness: new Date().toISOString(),
};

require.cache[require.resolve('./modeA')] = {
  id: require.resolve('./modeA'),
  filename: require.resolve('./modeA'),
  loaded: true,
  exports: {
    runModeA: async () => ({ ...MOCK_MODE_A_OUTPUT }),
  },
};

// ---------------------------------------------------------------------------
// Stub: onChainAnchor — write to test-isolated anchor ledger
// ---------------------------------------------------------------------------
const crypto = require('crypto');

function deterministicStringify(obj) {
  return JSON.stringify(obj, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  });
}

require.cache[require.resolve('./onChainAnchor')] = {
  id: require.resolve('./onChainAnchor'),
  filename: require.resolve('./onChainAnchor'),
  loaded: true,
  exports: {
    anchorOutput: async ({ sapOutput, ticker, modeUsed, userDiscordId }) => {
      const serialized = deterministicStringify(sapOutput);
      const contentHash = crypto.createHash('sha256').update(serialized).digest('hex');
      const anchoredAt = new Date().toISOString();
      const txHash = 'mock_tx_' + Date.now();

      const memoPayload = {
        source_node: 'journal_node',
        output_type: modeUsed,
        content_hash: contentHash,
        ticker,
        timestamp: anchoredAt,
        user_id: userDiscordId,
      };

      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
      fs.appendFileSync(ANCHOR_LEDGER, JSON.stringify(memoPayload) + '\n', 'utf8');

      return { contentHash, txHash, memoPayload, anchoredAt };
    },
    getAnchorByHash: (hash) => {
      if (!fs.existsSync(ANCHOR_LEDGER)) return null;
      const lines = fs.readFileSync(ANCHOR_LEDGER, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const record = JSON.parse(line);
        if (record.content_hash === hash) return record;
      }
      return null;
    },
    verifyOutput: () => ({ verified: false, anchoredAt: null, memoPayload: null }),
    submitPFTMemoTx: async () => ({ txHash: 'mock_tx' }),
  },
};

// ---------------------------------------------------------------------------
// Stub: tradeTicket — write to test-isolated journal
// ---------------------------------------------------------------------------
const IMMUTABLE_FIELDS = ['modelConsensus', 'scsScoreAtEntry', 'modeUsed', 'userAlignment', 'signalPriceAtEntry'];

function detectMode(sapOutput) {
  if (sapOutput.bullPct !== undefined) return 'A';
  if (sapOutput.vac !== undefined) return 'B';
  if (Array.isArray(sapOutput.runs) && sapOutput.runs.some(r => r.stabilityBadge !== undefined) || sapOutput.stabilityBadge !== undefined) return 'C';
  if (sapOutput.voteTally !== undefined) return 'D';
  throw new Error('Unable to detect SAP mode from sapOutput shape');
}

function deriveConsensus(sapOutput, mode) {
  if (mode === 'A') {
    const { bullPct, bearPct } = sapOutput;
    if (bullPct > bearPct + 10) return 'bullish';
    if (bearPct > bullPct + 10) return 'bearish';
    return 'mixed';
  }
  return 'mixed';
}

function readTradeJournal() {
  if (!fs.existsSync(TRADE_JOURNAL)) return [];
  return fs.readFileSync(TRADE_JOURNAL, 'utf-8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

function writeTradeJournal(records) {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  fs.writeFileSync(TRADE_JOURNAL, records.map(r => JSON.stringify(r)).join('\n') + '\n');
}

require.cache[require.resolve('./tradeTicket')] = {
  id: require.resolve('./tradeTicket'),
  filename: require.resolve('./tradeTicket'),
  loaded: true,
  exports: {
    createTradeTicket: async ({ ticker, assetClass, direction, entryPrice, stopLoss, takeProfit, timeframe, sapOutput, userAlignment, notes }) => {
      const modeUsed = detectMode(sapOutput);
      const modelConsensus = deriveConsensus(sapOutput, modeUsed);
      const scsScoreAtEntry = sapOutput.scsScore !== undefined ? sapOutput.scsScore : null;
      const signalPriceAtEntry = 67500.0; // from stubbed assembleDataPack

      const record = {
        id: crypto.randomUUID(),
        ticker,
        assetClass,
        direction,
        entryPrice,
        stopLoss,
        takeProfit,
        timeframe: timeframe || '1W',
        modeUsed,
        modelConsensus,
        scsScoreAtEntry,
        signalPriceAtEntry,
        userAlignment,
        notes: notes || null,
        sapOutput,
        status: 'open',
        createdAt: new Date().toISOString(),
        immutableFields: IMMUTABLE_FIELDS,
      };

      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
      fs.appendFileSync(TRADE_JOURNAL, JSON.stringify(record) + '\n');
      return record;
    },
    closeTradeTicket: async ({ id, exitPrice, outcome }) => {
      const records = readTradeJournal();
      const idx = records.findIndex(r => r.id === id);
      if (idx === -1) throw new Error(`Ticket not found: ${id}`);

      records[idx].exitPrice = exitPrice;
      records[idx].closedAt = new Date().toISOString();
      records[idx].outcome = outcome;
      records[idx].status = 'closed';
      writeTradeJournal(records);

      // Mirror real closeTradeTicket: record + score the aggregate mode prediction
      const outcomeMap = { win: 'correct', loss: 'incorrect', breakeven: 'partial' };
      const predId = `pred-${recordPredictionCalls.length + 1}`;
      recordPredictionCalls.push({
        modelName: `sap-mode-${records[idx].modeUsed}`,
        asset: records[idx].ticker,
        assetClass: records[idx].assetClass,
        timeframe: records[idx].timeframe,
        predictedDirection: records[idx].modelConsensus,
        predictedValue: records[idx].scsScoreAtEntry,
        modeUsed: records[idx].modeUsed,
        timestamp: records[idx].createdAt,
      });
      scorePredictionCalls.push({ id: predId, outcome: outcomeMap[outcome] });

      return records[idx];
    },
    getOpenTickets: () => readTradeJournal().filter(r => r.status === 'open'),
    getTicketById: (id) => readTradeJournal().find(r => r.id === id) || null,
    _JOURNAL_PATH: TRADE_JOURNAL,
  },
};

// ---------------------------------------------------------------------------
// Stub: accuracyFeedback — uses the test tradeTicket stub
// ---------------------------------------------------------------------------
require.cache[require.resolve('./accuracyFeedback')] = {
  id: require.resolve('./accuracyFeedback'),
  filename: require.resolve('./accuracyFeedback'),
  loaded: true,
  exports: {
    processTradeClosure: async ({ ticketId }) => {
      const ticket = readTradeJournal().find(r => r.id === ticketId);
      if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

      // Determine correctness
      const { outcome, modelConsensus, direction, sapOutput, modeUsed } = ticket;
      let score;
      if (modelConsensus === 'mixed' || modelConsensus === 'neutral') {
        score = 'partial';
      } else {
        const bullish = ['bullish', 'long'];
        const matched = direction === 'long' ? bullish.includes(modelConsensus) : !bullish.includes(modelConsensus);
        if (matched) {
          score = outcome === 'win' ? 'correct' : outcome === 'loss' ? 'incorrect' : 'partial';
        } else {
          score = 'partial';
        }
      }

      // Extract contributing models
      const models = new Set();
      if (Array.isArray(sapOutput.models)) sapOutput.models.forEach(m => m.modelName && models.add(m.modelName));
      if (Array.isArray(sapOutput.runs)) sapOutput.runs.forEach(r => r.modelName && models.add(r.modelName));
      const contributingModels = [...models];

      // Score each contributing model
      const results = [];
      for (const modelName of contributingModels) {
        const predId = `pred-${recordPredictionCalls.length + 1}`;
        recordPredictionCalls.push({
          modelName,
          asset: ticket.ticker,
          assetClass: ticket.assetClass,
          timeframe: ticket.timeframe,
          predictedDirection: modelConsensus,
          predictedValue: ticket.scsScoreAtEntry,
          modeUsed,
          timestamp: ticket.createdAt,
        });
        scorePredictionCalls.push({ id: predId, outcome: score });
        results.push({ modelName, score, reliability: 1.0 });
      }

      return { ticketId, score, contributingModels, results };
    },
    getModeAccuracyStats: async () => ({}),
    getPersonalCalibrationScore: async () => ({ calibrationScore: 0, totalSignals: 0, trend: 'stable' }),
  },
};

// ---------------------------------------------------------------------------
// Stub: pftFee — write to test-isolated signal ledger
// ---------------------------------------------------------------------------
function readSignalLedger() {
  if (!fs.existsSync(SIGNAL_LEDGER)) return [];
  const raw = fs.readFileSync(SIGNAL_LEDGER, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map(l => JSON.parse(l));
}

require.cache[require.resolve('./pftFee')] = {
  id: require.resolve('./pftFee'),
  filename: require.resolve('./pftFee'),
  loaded: true,
  exports: {
    recordSignal: async ({ ticketId, asset, signalDirection, signalPrice, userTimeframe, modeUsed, userDiscordId }) => {
      const record = {
        signalId: crypto.randomUUID(),
        ticketId,
        asset,
        signalDirection,
        signalPrice,
        userTimeframe,
        modeUsed,
        userDiscordId,
        createdAt: new Date().toISOString(),
        observationWindowClosesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'open',
      };
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
      fs.appendFileSync(SIGNAL_LEDGER, JSON.stringify(record) + '\n');
      return record;
    },
    checkObservationWindows: async () => {
      // For the test, close any open signals with a correct outcome
      const records = readSignalLedger();
      const closed = [];
      for (let i = 0; i < records.length; i++) {
        if (records[i].status === 'open') {
          records[i].status = 'closed';
          records[i].closedAt = new Date().toISOString();
          records[i].outcome = 'correct';
          records[i].currentPrice = 70000;
          records[i].rawFeeAccrued = 0.185;
          closed.push(records[i]);
        }
      }
      if (closed.length) {
        fs.writeFileSync(SIGNAL_LEDGER, records.map(r => JSON.stringify(r)).join('\n') + '\n');
      }
      return closed;
    },
    getUserFeeStatement: async ({ userDiscordId }) => {
      const records = readSignalLedger();
      const userSignals = records.filter(r => r.userDiscordId === userDiscordId && r.status === 'closed');
      return {
        totalSignals: userSignals.length,
        correctSignals: userSignals.filter(r => r.outcome === 'correct').length,
        incorrectSignals: userSignals.filter(r => r.outcome === 'incorrect').length,
        cumulativePnlPct: 3.7,
        totalFeesOwed: 0.185,
        isNetNegative: false,
        signals: userSignals,
      };
    },
    generateSignalOutcomeNotification: async () => 'mock notification',
    PFT_FEE_PCT: 0.05,
    _setLedgerPath: () => {},
    _getLedgerPath: () => SIGNAL_LEDGER,
  },
};

// ---------------------------------------------------------------------------
// Now require the orchestrator (will pick up all stubs)
// ---------------------------------------------------------------------------
const { runAnalysis, openTrade, closeTrade } = require('./journalNode');
const { getUserFeeStatement } = require('./pftFee');
const { getAnchorByHash } = require('./onChainAnchor');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
function cleanup() {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Run full end-to-end flow
// ---------------------------------------------------------------------------
(async () => {
  cleanup();

  const USER_ID = 'test-user-123';
  let analysisResult, tradeResult, closeResult;

  console.log('\nJournalNode — Full End-to-End Flow:\n');

  // ---- Step 1: Analyze with Mode A ----
  console.log('  Phase 1: runAnalysis (Mode A)');

  await test('runAnalysis returns Mode A result with anchor', async () => {
    analysisResult = await runAnalysis({
      ticker: 'BTC',
      assetClass: 'crypto',
      mode: 'A',
      timeframe: '1W',
      selectedModels: ['openai/gpt-4'],
      userDiscordId: USER_ID,
    });
    assert(analysisResult.scsScore === 72, `expected scsScore=72, got ${analysisResult.scsScore}`);
    assert(analysisResult.bullPct === 78, `expected bullPct=78, got ${analysisResult.bullPct}`);
    assert(analysisResult.label === 'High Conviction Bullish', `unexpected label: ${analysisResult.label}`);
  });

  await test('anchor field contains contentHash and txHash', async () => {
    assert(analysisResult.anchor, 'anchor field missing');
    assert(typeof analysisResult.anchor.contentHash === 'string', 'contentHash not a string');
    assert(analysisResult.anchor.contentHash.length === 64, `contentHash length=${analysisResult.anchor.contentHash.length}, expected 64`);
    assert(typeof analysisResult.anchor.txHash === 'string', 'txHash not a string');
    assert(analysisResult.anchor.txHash.startsWith('mock_tx_'), 'txHash should start with mock_tx_');
  });

  await test('anchorLedger.jsonl contains the content hash', async () => {
    assert(fs.existsSync(ANCHOR_LEDGER), 'anchor ledger file not found');
    const record = getAnchorByHash(analysisResult.anchor.contentHash);
    assert(record !== null, 'anchor record not found in ledger');
    assert(record.content_hash === analysisResult.anchor.contentHash, 'content hash mismatch');
    assert(record.ticker === 'BTC', `ticker mismatch: ${record.ticker}`);
    assert(record.output_type === 'mode_a', `output_type mismatch: ${record.output_type}`);
  });

  // ---- Step 2: Open trade from analysis output ----
  console.log('\n  Phase 2: openTrade');

  await test('openTrade creates ticket and signal', async () => {
    // Remove the anchor field before passing as sapOutput (it wasn't part of the original analysis)
    const { anchor, ...sapOutput } = analysisResult;
    tradeResult = await openTrade({
      ticker: 'BTC',
      assetClass: 'crypto',
      direction: 'long',
      entryPrice: 67000,
      stopLoss: 64000,
      takeProfit: 72000,
      timeframe: '1W',
      sapOutput,
      userAlignment: 'agree',
      userDiscordId: USER_ID,
    });
    assert(tradeResult.ticket, 'ticket missing from openTrade result');
    assert(tradeResult.signal, 'signal missing from openTrade result');
  });

  await test('tradeJournal.jsonl contains ticket with correct immutable fields', async () => {
    assert(fs.existsSync(TRADE_JOURNAL), 'trade journal file not found');
    const records = readTradeJournal();
    assert(records.length >= 1, 'no records in trade journal');
    const ticket = records.find(r => r.id === tradeResult.ticket.id);
    assert(ticket, 'ticket not found in journal');
    assert(ticket.modeUsed === 'A', `modeUsed mismatch: ${ticket.modeUsed}`);
    assert(ticket.modelConsensus === 'bullish', `modelConsensus mismatch: ${ticket.modelConsensus}`);
    assert(ticket.scsScoreAtEntry === 72, `scsScoreAtEntry mismatch: ${ticket.scsScoreAtEntry}`);
    assert(ticket.signalPriceAtEntry === 67500.0, `signalPriceAtEntry mismatch: ${ticket.signalPriceAtEntry}`);
    assert(ticket.userAlignment === 'agree', `userAlignment mismatch: ${ticket.userAlignment}`);
    assert(ticket.status === 'open', `status should be open, got ${ticket.status}`);
    assert(Array.isArray(ticket.immutableFields), 'immutableFields not an array');
    assert(ticket.immutableFields.includes('modelConsensus'), 'immutableFields missing modelConsensus');
  });

  await test('signalLedger.jsonl contains the signal record', async () => {
    assert(fs.existsSync(SIGNAL_LEDGER), 'signal ledger file not found');
    const signals = readSignalLedger();
    assert(signals.length >= 1, 'no records in signal ledger');
    const signal = signals.find(s => s.ticketId === tradeResult.ticket.id);
    assert(signal, 'signal not found for ticket');
    assert(signal.asset === 'BTC', `asset mismatch: ${signal.asset}`);
    assert(signal.signalDirection === 'bullish', `signalDirection mismatch: ${signal.signalDirection}`);
    assert(signal.modeUsed === 'A', `modeUsed mismatch: ${signal.modeUsed}`);
    assert(signal.userDiscordId === USER_ID, `userDiscordId mismatch`);
    assert(signal.status === 'open', `signal status should be open, got ${signal.status}`);
  });

  // ---- Step 3: Close trade with win ----
  console.log('\n  Phase 3: closeTrade');

  await test('closeTrade returns closure summary', async () => {
    closeResult = await closeTrade({
      ticketId: tradeResult.ticket.id,
      exitPrice: 70000,
      outcome: 'win',
      userDiscordId: USER_ID,
    });
    assert(closeResult.closedTicket, 'closedTicket missing');
    assert(closeResult.accuracyResult, 'accuracyResult missing');
    assert(closeResult.windowResults !== undefined, 'windowResults missing');
  });

  await test('closed ticket has correct status and outcome', async () => {
    assert(closeResult.closedTicket.status === 'closed', `status should be closed, got ${closeResult.closedTicket.status}`);
    assert(closeResult.closedTicket.outcome === 'win', `outcome should be win, got ${closeResult.closedTicket.outcome}`);
    assert(closeResult.closedTicket.exitPrice === 70000, `exitPrice mismatch: ${closeResult.closedTicket.exitPrice}`);
    assert(closeResult.closedTicket.closedAt, 'closedAt timestamp missing');
  });

  await test('accuracy result scores the prediction as correct', async () => {
    assert(closeResult.accuracyResult.score === 'correct', `expected score=correct, got ${closeResult.accuracyResult.score}`);
    assert(closeResult.accuracyResult.ticketId === tradeResult.ticket.id, 'ticketId mismatch in accuracy result');
  });

  await test('tradeJournal.jsonl reflects closed state', async () => {
    const records = readTradeJournal();
    const closedTicket = records.find(r => r.id === tradeResult.ticket.id);
    assert(closedTicket, 'ticket not found in journal after close');
    assert(closedTicket.status === 'closed', `journal status should be closed, got ${closedTicket.status}`);
    assert(closedTicket.outcome === 'win', `journal outcome should be win, got ${closedTicket.outcome}`);
  });

  await test('scorePrediction was called for contributing models', async () => {
    // The closeTradeTicket stub in tradeTicket calls recordPrediction + scorePrediction
    // and processTradeClosure also calls them for each contributing model
    assert(scorePredictionCalls.length > 0, `scorePrediction was never called (${scorePredictionCalls.length} calls)`);
  });

  // ---- Step 4: Verify fee statement ----
  console.log('\n  Phase 4: Fee Statement');

  await test('getUserFeeStatement returns non-zero totalSignals', async () => {
    const feeStatement = await getUserFeeStatement({ userDiscordId: USER_ID });
    assert(feeStatement.totalSignals > 0, `expected totalSignals > 0, got ${feeStatement.totalSignals}`);
    assert(feeStatement.correctSignals > 0, `expected correctSignals > 0, got ${feeStatement.correctSignals}`);
    assert(!feeStatement.isNetNegative, 'fee statement should not be net negative');
  });

  // ---- Cleanup ----
  cleanup();

  console.log(`\n  Results: ${passed} passed, ${failures} failed\n`);
  if (failures > 0) process.exit(1);
})();
