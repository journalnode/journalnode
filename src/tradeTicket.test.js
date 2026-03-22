const fs = require('fs');
const path = require('path');

// --- Stub modelReliability before requiring tradeTicket ---
const reliabilityCalls = [];
const scoreCalls = [];
const originalReliabilityPath = require.resolve('./modelReliability');
require.cache[originalReliabilityPath] = {
  id: originalReliabilityPath,
  filename: originalReliabilityPath,
  loaded: true,
  exports: {
    recordPrediction: (params) => {
      reliabilityCalls.push(params);
      return 'mock-prediction-id';
    },
    scorePrediction: (id, outcome) => {
      scoreCalls.push({ id, outcome });
      return 1.0;
    },
    getModelReliability: () => 1.0,
    getModelStats: () => ({}),
    closeDb: () => {}
  }
};

// Stub rawDataPack
const rawDataPackPath = require.resolve('./rawDataPack');
require.cache[rawDataPackPath] = {
  id: rawDataPackPath,
  filename: rawDataPackPath,
  loaded: true,
  exports: {
    assembleDataPack: async ({ ticker }) => ({
      ticker,
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

const { createTradeTicket, closeTradeTicket, getOpenTickets, getTicketById, _JOURNAL_PATH } = require('./tradeTicket');

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

// --- Stub SAP outputs ---

const MODE_A_OUTPUT = {
  scsScore: 72,
  label: 'Strong Bullish',
  bullPct: 78,
  bearPct: 22,
  synthesisSummary: 'Majority bullish consensus across agents.',
  semanticProximityKeywords: ['momentum', 'breakout'],
  semanticDecayWarning: false,
  recursiveResearchTriggered: false,
  excluded: [],
  dataFreshness: new Date().toISOString()
};

const MODE_B_OUTPUT = {
  vac: 185.5,
  consensusZone: { low: 170, high: 200 },
  models: [
    { modelName: 'openai/gpt-4', estimate: 185, logicScore: 8, outlier: false },
    { modelName: 'anthropic/claude-3-sonnet', estimate: 190, logicScore: 7, outlier: false }
  ],
  peerGroup: [
    { ticker: 'MSFT', marketCap: 3000, rationale: 'Large-cap tech peer' }
  ],
  scsScore: -15,
  excluded: [],
  dataFreshness: new Date().toISOString()
};

// --- Cleanup before tests ---
if (fs.existsSync(_JOURNAL_PATH)) {
  fs.unlinkSync(_JOURNAL_PATH);
}

(async () => {
  console.log('\nTradeTicket — Mode Detection & Creation:');

  let ticketA;
  await test('creates ticket from Mode A output with correct modeUsed', async () => {
    ticketA = await createTradeTicket({
      ticker: 'BTC',
      assetClass: 'crypto',
      direction: 'long',
      entryPrice: 67000,
      stopLoss: 64000,
      takeProfit: 72000,
      timeframe: '1W',
      sapOutput: MODE_A_OUTPUT,
      userAlignment: 'agree',
      notes: 'Test Mode A ticket'
    });
    assert(ticketA.modeUsed === 'A', `expected modeUsed=A, got ${ticketA.modeUsed}`);
  });

  await test('Mode A ticket has correct modelConsensus', async () => {
    assert(ticketA.modelConsensus === 'bullish', `expected bullish, got ${ticketA.modelConsensus}`);
  });

  await test('Mode A ticket has correct scsScoreAtEntry', async () => {
    assert(ticketA.scsScoreAtEntry === 72, `expected 72, got ${ticketA.scsScoreAtEntry}`);
  });

  await test('Mode A ticket has signalPriceAtEntry from data pack', async () => {
    assert(ticketA.signalPriceAtEntry === 67500.00, `expected 67500, got ${ticketA.signalPriceAtEntry}`);
  });

  await test('Mode A ticket has UUID and status open', async () => {
    assert(typeof ticketA.id === 'string' && ticketA.id.length > 0, 'missing id');
    assert(ticketA.status === 'open', `expected open, got ${ticketA.status}`);
  });

  await test('Mode A ticket has all immutable fields listed', async () => {
    const expected = ['modelConsensus', 'scsScoreAtEntry', 'modeUsed', 'userAlignment', 'signalPriceAtEntry'];
    for (const field of expected) {
      assert(ticketA.immutableFields.includes(field), `immutableFields missing ${field}`);
    }
  });

  let ticketB;
  await test('creates ticket from Mode B output with correct modeUsed', async () => {
    ticketB = await createTradeTicket({
      ticker: 'AAPL',
      assetClass: 'equity',
      direction: 'short',
      entryPrice: 190,
      stopLoss: 200,
      takeProfit: 170,
      timeframe: '1M',
      sapOutput: MODE_B_OUTPUT,
      userAlignment: 'disagree'
    });
    assert(ticketB.modeUsed === 'B', `expected modeUsed=B, got ${ticketB.modeUsed}`);
  });

  await test('Mode B ticket has correct modelConsensus (bearish from negative scsScore)', async () => {
    assert(ticketB.modelConsensus === 'bearish', `expected bearish, got ${ticketB.modelConsensus}`);
  });

  await test('Mode B ticket has scsScoreAtEntry from sapOutput', async () => {
    assert(ticketB.scsScoreAtEntry === -15, `expected -15, got ${ticketB.scsScoreAtEntry}`);
  });

  await test('Mode B ticket has immutableFields array', async () => {
    assert(Array.isArray(ticketB.immutableFields), 'immutableFields not an array');
    assert(ticketB.immutableFields.length === 5, `expected 5, got ${ticketB.immutableFields.length}`);
  });

  console.log('\nTradeTicket — Retrieval:');

  await test('getOpenTickets returns both open tickets', async () => {
    const open = getOpenTickets();
    assert(open.length === 2, `expected 2 open tickets, got ${open.length}`);
  });

  await test('getTicketById returns correct ticket', async () => {
    const found = getTicketById(ticketA.id);
    assert(found !== null, 'ticket not found');
    assert(found.id === ticketA.id, 'id mismatch');
    assert(found.ticker === 'BTC', `expected BTC, got ${found.ticker}`);
  });

  await test('getTicketById returns null for unknown id', async () => {
    const found = getTicketById('nonexistent-id');
    assert(found === null, 'expected null for unknown id');
  });

  console.log('\nTradeTicket — Close Workflow:');

  reliabilityCalls.length = 0; // reset call tracker
  scoreCalls.length = 0;

  let closedTicket;
  await test('closeTradeTicket closes ticket with win outcome', async () => {
    closedTicket = await closeTradeTicket({
      id: ticketA.id,
      exitPrice: 71000,
      outcome: 'win'
    });
    assert(closedTicket.status === 'closed', `expected closed, got ${closedTicket.status}`);
    assert(closedTicket.exitPrice === 71000, `expected exitPrice 71000, got ${closedTicket.exitPrice}`);
    assert(closedTicket.outcome === 'win', `expected win, got ${closedTicket.outcome}`);
    assert(closedTicket.closedAt !== undefined, 'missing closedAt');
  });

  await test('recordPrediction called with correct arguments on close', async () => {
    assert(reliabilityCalls.length === 1, `expected 1 call, got ${reliabilityCalls.length}`);
    const call = reliabilityCalls[0];
    assert(call.modelName === 'sap-mode-A', `expected sap-mode-A, got ${call.modelName}`);
    assert(call.asset === 'BTC', `expected BTC, got ${call.asset}`);
    assert(call.assetClass === 'crypto', `expected crypto, got ${call.assetClass}`);
    assert(call.modeUsed === 'A', `expected A, got ${call.modeUsed}`);
    assert(call.predictedDirection === 'bullish', `expected bullish, got ${call.predictedDirection}`);
    assert(call.predictedValue === 72, `expected 72, got ${call.predictedValue}`);
  });

  await test('scorePrediction called with mapped outcome on close', async () => {
    assert(scoreCalls.length === 1, `expected 1 scorePrediction call, got ${scoreCalls.length}`);
    assert(scoreCalls[0].id === 'mock-prediction-id', `expected mock-prediction-id, got ${scoreCalls[0].id}`);
    assert(scoreCalls[0].outcome === 'correct', `expected 'correct' (mapped from 'win'), got ${scoreCalls[0].outcome}`);
  });

  await test('getOpenTickets returns only unclosed records after close', async () => {
    const open = getOpenTickets();
    assert(open.length === 1, `expected 1 open ticket, got ${open.length}`);
    assert(open[0].id === ticketB.id, `expected remaining open ticket to be Mode B`);
  });

  await test('closed ticket persisted correctly in journal', async () => {
    const found = getTicketById(ticketA.id);
    assert(found.status === 'closed', 'not persisted as closed');
    assert(found.exitPrice === 71000, 'exitPrice not persisted');
  });

  await test('closing already-closed ticket throws', async () => {
    try {
      await closeTradeTicket({ id: ticketA.id, exitPrice: 72000, outcome: 'loss' });
      assert(false, 'should have thrown');
    } catch (err) {
      assert(err.message.includes('already closed'), `unexpected error: ${err.message}`);
    }
  });

  console.log('\nTradeTicket — Immutable Fields Integrity:');

  await test('immutable fields unchanged after close', async () => {
    const found = getTicketById(ticketA.id);
    assert(found.modelConsensus === 'bullish', 'modelConsensus changed');
    assert(found.scsScoreAtEntry === 72, 'scsScoreAtEntry changed');
    assert(found.modeUsed === 'A', 'modeUsed changed');
    assert(found.userAlignment === 'agree', 'userAlignment changed');
    assert(found.signalPriceAtEntry === 67500.00, 'signalPriceAtEntry changed');
  });

  // --- Cleanup ---
  if (fs.existsSync(_JOURNAL_PATH)) {
    fs.unlinkSync(_JOURNAL_PATH);
  }

  console.log(`\nDone: ${passed} passed, ${failures} failure(s)`);
  process.exit(failures > 0 ? 1 : 0);
})();
