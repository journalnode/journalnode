const fs = require('fs');
const path = require('path');

// --- Track calls to modelReliability ---
const recordPredictionCalls = [];
const scorePredictionCalls = [];
let predictionIdCounter = 0;

// --- Stub modelReliability before requiring accuracyFeedback ---
const reliabilityPath = require.resolve('./modelReliability');
require.cache[reliabilityPath] = {
  id: reliabilityPath,
  filename: reliabilityPath,
  loaded: true,
  exports: {
    recordPrediction: (params) => {
      const id = `mock-pred-${++predictionIdCounter}`;
      recordPredictionCalls.push({ id, ...params });
      return id;
    },
    scorePrediction: (id, outcome) => {
      scorePredictionCalls.push({ id, outcome });
      return 1.0;
    },
    getModelReliability: () => 1.0,
    getModelStats: () => ({}),
    closeDb: () => {}
  }
};

// --- Stub rawDataPack (needed by tradeTicket) ---
const rawDataPackPath = require.resolve('./rawDataPack');
require.cache[rawDataPackPath] = {
  id: rawDataPackPath,
  filename: rawDataPackPath,
  loaded: true,
  exports: {
    assembleDataPack: async () => ({
      ticker: 'BTC',
      assetClass: 'crypto',
      timeframe: '1W',
      price_current: 67500.00,
      price_history: [],
      market_cap: null,
      recent_news: [],
      sector_peers: [],
      data_freshness_timestamp: new Date().toISOString()
    }),
    clearCache: () => {},
    _setFetchFn: () => {}
  }
};

const { processTradeClosure, getModeAccuracyStats, getPersonalCalibrationScore } = require('./accuracyFeedback');
const { _JOURNAL_PATH } = require('./tradeTicket');

// --- Test harness ---
let passed = 0;
let failures = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failures++;
  }
}

// --- JSONL helpers ---
const DATA_DIR = path.join(__dirname, '..', 'data');

function writeRecords(records) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(_JOURNAL_PATH, records.map(r => JSON.stringify(r)).join('\n') + '\n');
}

function cleanup() {
  if (fs.existsSync(_JOURNAL_PATH)) fs.unlinkSync(_JOURNAL_PATH);
}

// --- Test data factories ---

function makeClosedTicket(overrides = {}) {
  return {
    id: `ticket-${Math.random().toString(36).slice(2, 8)}`,
    ticker: 'BTC',
    assetClass: 'crypto',
    direction: 'long',
    entryPrice: 67000,
    exitPrice: 71000,
    stopLoss: 64000,
    takeProfit: 72000,
    timeframe: '1W',
    modeUsed: 'A',
    modelConsensus: 'bullish',
    scsScoreAtEntry: 72,
    signalPriceAtEntry: 67500,
    userAlignment: 'agree',
    notes: null,
    sapOutput: {
      bullPct: 78,
      bearPct: 22,
      scsScore: 72,
      models: [
        { modelName: 'anthropic/claude-3-opus', estimate: 80, logicScore: 9, outlier: false },
        { modelName: 'openai/gpt-4', estimate: 75, logicScore: 8, outlier: false },
        { modelName: 'google/gemini-pro', estimate: 70, logicScore: 7, outlier: false }
      ]
    },
    status: 'closed',
    outcome: 'win',
    userDiscordId: 'user-123',
    createdAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
    immutableFields: ['modelConsensus', 'scsScoreAtEntry', 'modeUsed', 'userAlignment', 'signalPriceAtEntry'],
    ...overrides
  };
}

// --- Tests ---

(async () => {
  // ============================================================
  console.log('\nAccuracyFeedback — processTradeClosure:');
  // ============================================================

  cleanup();
  recordPredictionCalls.length = 0;
  scorePredictionCalls.length = 0;
  predictionIdCounter = 0;

  const winTicket = makeClosedTicket({
    id: 'ticket-win-a',
    modeUsed: 'A',
    modelConsensus: 'bullish',
    direction: 'long',
    outcome: 'win'
  });
  writeRecords([winTicket]);

  await test('processTradeClosure calls scorePrediction once per contributing model', async () => {
    const result = await processTradeClosure({ ticketId: 'ticket-win-a' });
    assert(result.contributingModels.length === 3,
      `expected 3 contributing models, got ${result.contributingModels.length}`);
    assert(scorePredictionCalls.length === 3,
      `expected 3 scorePrediction calls, got ${scorePredictionCalls.length}`);
  });

  await test('all scorePrediction calls receive "correct" for win+matched', async () => {
    for (let i = 0; i < scorePredictionCalls.length; i++) {
      assert(scorePredictionCalls[i].outcome === 'correct',
        `call ${i}: expected "correct", got "${scorePredictionCalls[i].outcome}"`);
    }
  });

  await test('recordPrediction called with each model name', async () => {
    const modelNames = recordPredictionCalls.map(c => c.modelName).sort();
    assert(modelNames.length === 3, `expected 3, got ${modelNames.length}`);
    assert(modelNames.includes('anthropic/claude-3-opus'), 'missing anthropic/claude-3-opus');
    assert(modelNames.includes('openai/gpt-4'), 'missing openai/gpt-4');
    assert(modelNames.includes('google/gemini-pro'), 'missing google/gemini-pro');
  });

  // Test loss + matched → incorrect
  cleanup();
  recordPredictionCalls.length = 0;
  scorePredictionCalls.length = 0;
  predictionIdCounter = 0;

  const lossTicket = makeClosedTicket({
    id: 'ticket-loss',
    outcome: 'loss',
    modelConsensus: 'bullish',
    direction: 'long'
  });
  writeRecords([lossTicket]);

  await test('loss + matched consensus scores as "incorrect"', async () => {
    await processTradeClosure({ ticketId: 'ticket-loss' });
    for (const call of scorePredictionCalls) {
      assert(call.outcome === 'incorrect',
        `expected "incorrect", got "${call.outcome}"`);
    }
  });

  // Test mixed consensus → partial
  cleanup();
  recordPredictionCalls.length = 0;
  scorePredictionCalls.length = 0;
  predictionIdCounter = 0;

  const mixedTicket = makeClosedTicket({
    id: 'ticket-mixed',
    outcome: 'win',
    modelConsensus: 'mixed',
    direction: 'long'
  });
  writeRecords([mixedTicket]);

  await test('mixed consensus scores as "partial" regardless of outcome', async () => {
    await processTradeClosure({ ticketId: 'ticket-mixed' });
    for (const call of scorePredictionCalls) {
      assert(call.outcome === 'partial',
        `expected "partial", got "${call.outcome}"`);
    }
  });

  // ============================================================
  console.log('\nAccuracyFeedback — getModeAccuracyStats:');
  // ============================================================

  cleanup();

  await test('returns empty object when no closed tickets exist', async () => {
    writeRecords([]);
    const stats = await getModeAccuracyStats({ userDiscordId: 'user-123' });
    assert(Object.keys(stats).length === 0, 'expected empty result');
  });

  await test('returns null for modes with fewer than 3 tickets', async () => {
    const tickets = [
      makeClosedTicket({ id: 't1', modeUsed: 'A', outcome: 'win', modelConsensus: 'bullish', direction: 'long' }),
      makeClosedTicket({ id: 't2', modeUsed: 'A', outcome: 'loss', modelConsensus: 'bullish', direction: 'long' })
    ];
    writeRecords(tickets);
    const stats = await getModeAccuracyStats({ userDiscordId: 'user-123' });
    assert(stats.mode_a === null, `expected null for mode_a with 2 tickets, got ${JSON.stringify(stats.mode_a)}`);
  });

  await test('returns correct accuracyPct for modes with sufficient data', async () => {
    // 3 correct, 1 incorrect, 1 partial → accuracyPct = (3 + 0.5*1)/5*100 = 70
    const tickets = [
      makeClosedTicket({ id: 's1', modeUsed: 'B', outcome: 'win', modelConsensus: 'bullish', direction: 'long' }),
      makeClosedTicket({ id: 's2', modeUsed: 'B', outcome: 'win', modelConsensus: 'bullish', direction: 'long' }),
      makeClosedTicket({ id: 's3', modeUsed: 'B', outcome: 'win', modelConsensus: 'bullish', direction: 'long' }),
      makeClosedTicket({ id: 's4', modeUsed: 'B', outcome: 'loss', modelConsensus: 'bullish', direction: 'long' }),
      makeClosedTicket({ id: 's5', modeUsed: 'B', outcome: 'win', modelConsensus: 'mixed', direction: 'long' })
    ];
    writeRecords(tickets);
    const stats = await getModeAccuracyStats({ userDiscordId: 'user-123' });
    assert(stats.mode_b !== null, 'expected mode_b stats');
    assert(stats.mode_b.total === 5, `expected total=5, got ${stats.mode_b.total}`);
    assert(stats.mode_b.correct === 3, `expected correct=3, got ${stats.mode_b.correct}`);
    assert(stats.mode_b.incorrect === 1, `expected incorrect=1, got ${stats.mode_b.incorrect}`);
    assert(stats.mode_b.partial === 1, `expected partial=1, got ${stats.mode_b.partial}`);
    assert(stats.mode_b.accuracyPct === 70, `expected accuracyPct=70, got ${stats.mode_b.accuracyPct}`);
  });

  await test('filters by userDiscordId', async () => {
    const tickets = [
      makeClosedTicket({ id: 'u1', modeUsed: 'A', userDiscordId: 'user-123' }),
      makeClosedTicket({ id: 'u2', modeUsed: 'A', userDiscordId: 'user-456' }),
      makeClosedTicket({ id: 'u3', modeUsed: 'A', userDiscordId: 'user-123' }),
      makeClosedTicket({ id: 'u4', modeUsed: 'A', userDiscordId: 'user-123' })
    ];
    writeRecords(tickets);
    const stats = await getModeAccuracyStats({ userDiscordId: 'user-123' });
    assert(stats.mode_a !== null, 'expected mode_a stats for user-123');
    assert(stats.mode_a.total === 3, `expected total=3, got ${stats.mode_a.total}`);
  });

  // ============================================================
  console.log('\nAccuracyFeedback — getPersonalCalibrationScore:');
  // ============================================================

  cleanup();

  await test('returns zero calibration with stable trend when no data', async () => {
    writeRecords([]);
    const result = await getPersonalCalibrationScore({ userDiscordId: 'user-123' });
    assert(result.calibrationScore === 0, `expected 0, got ${result.calibrationScore}`);
    assert(result.totalSignals === 0, `expected 0 signals, got ${result.totalSignals}`);
    assert(result.trend === 'stable', `expected stable, got ${result.trend}`);
  });

  await test('improving trend when last 5 outperform average by >10pp', async () => {
    // First 7 signals: all losses (score 0) → average so far low
    // Last 5 signals: all wins (score 1) → 100% vs overall ~41.7%
    // Overall: 5 correct out of 12 = 41.67%, last 5 = 100% → diff = 58.33 > 10 → improving
    const now = Date.now();
    const tickets = [];
    for (let i = 0; i < 7; i++) {
      tickets.push(makeClosedTicket({
        id: `imp-loss-${i}`,
        outcome: 'loss',
        modelConsensus: 'bullish',
        direction: 'long',
        closedAt: new Date(now + i * 1000).toISOString()
      }));
    }
    for (let i = 0; i < 5; i++) {
      tickets.push(makeClosedTicket({
        id: `imp-win-${i}`,
        outcome: 'win',
        modelConsensus: 'bullish',
        direction: 'long',
        closedAt: new Date(now + (7 + i) * 1000).toISOString()
      }));
    }
    writeRecords(tickets);
    const result = await getPersonalCalibrationScore({ userDiscordId: 'user-123' });
    assert(result.trend === 'improving',
      `expected "improving", got "${result.trend}" (calibration=${result.calibrationScore})`);
    assert(result.totalSignals === 12, `expected 12, got ${result.totalSignals}`);
  });

  await test('declining trend when last 5 underperform average by >10pp', async () => {
    const now = Date.now();
    const tickets = [];
    // First 7: all wins
    for (let i = 0; i < 7; i++) {
      tickets.push(makeClosedTicket({
        id: `dec-win-${i}`,
        outcome: 'win',
        modelConsensus: 'bullish',
        direction: 'long',
        closedAt: new Date(now + i * 1000).toISOString()
      }));
    }
    // Last 5: all losses
    for (let i = 0; i < 5; i++) {
      tickets.push(makeClosedTicket({
        id: `dec-loss-${i}`,
        outcome: 'loss',
        modelConsensus: 'bullish',
        direction: 'long',
        closedAt: new Date(now + (7 + i) * 1000).toISOString()
      }));
    }
    writeRecords(tickets);
    const result = await getPersonalCalibrationScore({ userDiscordId: 'user-123' });
    assert(result.trend === 'declining',
      `expected "declining", got "${result.trend}" (calibration=${result.calibrationScore})`);
  });

  await test('stable trend when last 5 are near overall average', async () => {
    const now = Date.now();
    const tickets = [];
    // 10 tickets alternating win/loss → 50% overall, last 5 also ~50%
    for (let i = 0; i < 10; i++) {
      tickets.push(makeClosedTicket({
        id: `stab-${i}`,
        outcome: i % 2 === 0 ? 'win' : 'loss',
        modelConsensus: 'bullish',
        direction: 'long',
        closedAt: new Date(now + i * 1000).toISOString()
      }));
    }
    writeRecords(tickets);
    const result = await getPersonalCalibrationScore({ userDiscordId: 'user-123' });
    assert(result.trend === 'stable',
      `expected "stable", got "${result.trend}" (calibration=${result.calibrationScore})`);
  });

  // --- Cleanup ---
  cleanup();

  console.log(`\nDone: ${passed} passed, ${failures} failure(s)`);
  process.exit(failures > 0 ? 1 : 0);
})();
