'use strict';

const path = require('path');
const fs = require('fs');

// Use a fresh database for testing
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'model_reliability.db');
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const { runModeB } = require('./modeB');
const { _setFetchFn, clearCache } = require('./rawDataPack');
const { closeDb } = require('./modelReliability');

// ---------------------------------------------------------------------------
// Test harness (matches project convention)
// ---------------------------------------------------------------------------
function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Stub data-pack fetcher (no network required)
// ---------------------------------------------------------------------------
const STUB_EQUITY_DATA = {
  chart: {
    result: [{
      meta: { regularMarketPrice: 185, marketCap: 2900000000000 },
      timestamp: [
        Math.floor(Date.now() / 1000) - 6 * 86400,
        Math.floor(Date.now() / 1000) - 5 * 86400,
        Math.floor(Date.now() / 1000) - 4 * 86400,
        Math.floor(Date.now() / 1000) - 3 * 86400,
        Math.floor(Date.now() / 1000) - 2 * 86400,
        Math.floor(Date.now() / 1000) - 1 * 86400,
        Math.floor(Date.now() / 1000),
      ],
      indicators: {
        quote: [{
          close: [178, 180, 181, 183, 184, 185, 185],
        }],
      },
    }],
  },
};

_setFetchFn(async () => STUB_EQUITY_DATA);

// ---------------------------------------------------------------------------
// 8 model identifiers
// ---------------------------------------------------------------------------
const EIGHT_MODELS = [
  'stub/model-alpha',
  'stub/model-bravo',
  'stub/model-charlie',
  'stub/model-delta',
  'stub/model-echo',
  'stub/model-foxtrot',
  'stub/model-golf',
  'stub/model-hotel',   // ← this one will be the obvious outlier
];

// ---------------------------------------------------------------------------
// Stubbed handler: returns different responses based on prompt content and model
// ---------------------------------------------------------------------------
// Estimates: 7 models cluster around 2.8–3.2T; model-hotel returns 50T (outlier)
const MODEL_ESTIMATES = {
  'stub/model-alpha':   2.8,
  'stub/model-bravo':   3.0,
  'stub/model-charlie': 2.9,
  'stub/model-delta':   3.1,
  'stub/model-echo':    3.2,
  'stub/model-foxtrot': 2.85,
  'stub/model-golf':    3.05,
  'stub/model-hotel':   50.0,  // Obvious outlier — ~15x the cluster
};

let logicScoreCallModels = [];

function createStubHandler() {
  logicScoreCallModels = [];

  return async ({ modelId, prompt }) => {
    // ── Coordinator Agent (peer group identification) ─────────────
    if (prompt.includes('Peer Group Coordinator')) {
      return {
        peerGroup: [
          { ticker: 'MSFT', marketCap: 3100, rationale: 'Same mega-cap tech sector with comparable cloud revenue' },
          { ticker: 'GOOGL', marketCap: 2000, rationale: 'Adjacent advertising and AI platform with similar scale' },
          { ticker: 'AMZN', marketCap: 1900, rationale: 'Comparable cloud infrastructure and consumer ecosystem' },
          { ticker: 'META', marketCap: 1500, rationale: 'Similar digital advertising revenue model and AI investment' },
        ],
      };
    }

    // ── Logic Score self-assessment ───────────────────────────────
    if (prompt.includes('mathematical rigor')) {
      logicScoreCallModels.push(modelId);
      return {
        logicScore: 4,
        reasoning: 'Estimate was speculative with limited traceable peer multiples.',
      };
    }

    // ── Relative Valuation Specialist ────────────────────────────
    if (prompt.includes('Relative Valuation Specialist')) {
      const estimate = MODEL_ESTIMATES[modelId] || 3.0;
      return {
        estimatedMarketCapBillions: estimate,
        thesis: `Based on peer EV/Rev multiples averaging 12x, the target deserves a ${estimate > 3.0 ? 'premium' : 'discount'} at $${estimate}T market cap.`,
      };
    }

    // Fallback
    return { estimatedMarketCapBillions: 3.0, thesis: 'fallback' };
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
async function runAll() {
  console.log('\n=== Mode B: Peer-Anchored Multi-Valuation Orchestrator Tests ===\n');

  // ── Test 1: Full orchestration with 8 models and 1 outlier ─────────
  console.log('Scenario 1: 8 models with one obvious outlier (model-hotel at 50T)\n');

  await test('returns correct schema with all required fields', async () => {
    clearCache();
    const handler = createStubHandler();

    const result = await runModeB({
      ticker: 'AAPL',
      assetClass: 'equity',
      targetDate: '2026-06-01',
      selectedModels: EIGHT_MODELS,
      _handlerOverride: handler,
    });

    console.log('    Full result:', JSON.stringify(result, null, 2));

    // Schema checks
    assert(typeof result.vac === 'number', `vac should be number (got ${typeof result.vac})`);
    assert(typeof result.consensusZone === 'object', `consensusZone should be object`);
    assert(typeof result.consensusZone.low === 'number', `consensusZone.low should be number`);
    assert(typeof result.consensusZone.high === 'number', `consensusZone.high should be number`);
    assert(Array.isArray(result.models), 'models should be array');
    assert(result.models.length === 8, `should have 8 model entries (got ${result.models.length})`);
    assert(Array.isArray(result.peerGroup), 'peerGroup should be array');
    assert(result.peerGroup.length === 4, `should have 4 peers (got ${result.peerGroup.length})`);
    assert(typeof result.dataFreshness === 'string', `dataFreshness should be string`);
    assert(Array.isArray(result.excluded), 'excluded should be array');

    // Each model entry has required fields
    for (const m of result.models) {
      assert(typeof m.modelName === 'string', `model.modelName should be string`);
      assert(typeof m.estimate === 'number', `model.estimate should be number`);
      assert(typeof m.outlier === 'boolean', `model.outlier should be boolean`);
      assert(m.logicScore === null || typeof m.logicScore === 'number', `model.logicScore should be null or number`);
    }

    // Each peer has required fields
    for (const p of result.peerGroup) {
      assert(typeof p.ticker === 'string', `peer.ticker should be string`);
      assert(typeof p.marketCap === 'number', `peer.marketCap should be number`);
      assert(typeof p.rationale === 'string', `peer.rationale should be string`);
    }
  });

  // ── Test 2: Outlier is flagged and excluded from VAC ───────────────
  await test('model-hotel (50T) is flagged as outlier and excluded from VAC', async () => {
    clearCache();
    const handler = createStubHandler();

    const result = await runModeB({
      ticker: 'AAPL',
      assetClass: 'equity',
      targetDate: '2026-06-01',
      selectedModels: EIGHT_MODELS,
      _handlerOverride: handler,
    });

    const hotelModel = result.models.find(m => m.modelName === 'stub/model-hotel');
    assert(hotelModel, 'model-hotel should be present in models array');
    assert(hotelModel.outlier === true, `model-hotel should be flagged as outlier (got ${hotelModel.outlier})`);
    assert(hotelModel.estimate === 50.0, `model-hotel estimate should be 50.0 (got ${hotelModel.estimate})`);

    // Check it appears in excluded
    const excludedHotel = result.excluded.find(e => e.modelName === 'stub/model-hotel');
    assert(excludedHotel, 'model-hotel should appear in excluded list');

    // VAC should be based on clean values (~2.8–3.2 range), NOT including 50T
    assert(result.vac > 2.5 && result.vac < 3.5,
      `VAC should be in ~2.8-3.2 range (got ${result.vac}) — 50T outlier must not inflate it`);

    // Non-outlier models should NOT be flagged
    const nonOutlierModels = result.models.filter(m => m.modelName !== 'stub/model-hotel');
    for (const m of nonOutlierModels) {
      assert(m.outlier === false, `${m.modelName} should NOT be flagged as outlier (estimate ${m.estimate})`);
    }

    console.log(`    ✓ Outlier correctly flagged. VAC = ${result.vac.toFixed(4)}T (excluded 50T outlier)`);
  });

  // ── Test 3: Logic Score prompt fires only for flagged models ───────
  await test('Logic Score prompt fires only for models outside 1 stddev', async () => {
    clearCache();
    const handler = createStubHandler();

    const result = await runModeB({
      ticker: 'AAPL',
      assetClass: 'equity',
      targetDate: '2026-06-01',
      selectedModels: EIGHT_MODELS,
      _handlerOverride: handler,
    });

    // model-hotel (50T) is far outside 1 stddev — should have logicScore
    const hotelModel = result.models.find(m => m.modelName === 'stub/model-hotel');
    assert(hotelModel.logicScore !== null,
      `model-hotel should have a logicScore (it's an outlier), got ${hotelModel.logicScore}`);
    assert(typeof hotelModel.logicScore === 'number',
      `model-hotel logicScore should be number (got ${typeof hotelModel.logicScore})`);

    // Confirm Logic Score prompt was called for model-hotel
    assert(logicScoreCallModels.includes('stub/model-hotel'),
      `Logic Score prompt should have fired for model-hotel`);

    // Non-flagged models should have logicScore: null
    // (Some near-boundary models might also be flagged at 1 stddev, which is fine)
    const cleanModels = result.models.filter(m => m.logicScore === null);
    console.log(`    Logic Score fired for: ${logicScoreCallModels.join(', ')}`);
    console.log(`    Models with logicScore=null: ${cleanModels.map(m => m.modelName).join(', ')}`);

    // At minimum, models deep in the cluster should NOT have Logic Score
    // model-bravo (3.0) and model-delta (3.1) are near the mean
    const bravoModel = result.models.find(m => m.modelName === 'stub/model-bravo');
    assert(bravoModel.logicScore === null,
      `model-bravo (estimate 3.0, near mean) should have logicScore null`);
    assert(!logicScoreCallModels.includes('stub/model-bravo'),
      `Logic Score prompt should NOT have fired for model-bravo`);

    console.log(`    ✓ Logic Score selectively fired for ${logicScoreCallModels.length} flagged model(s)`);
  });

  // ── Test 4: Consensus zone bounds are correct ──────────────────────
  await test('consensus zone bounds match IQR of non-outlier estimates', async () => {
    clearCache();
    const handler = createStubHandler();

    const result = await runModeB({
      ticker: 'AAPL',
      assetClass: 'equity',
      targetDate: '2026-06-01',
      selectedModels: EIGHT_MODELS,
      _handlerOverride: handler,
    });

    // Non-outlier estimates (sorted): [2.8, 2.85, 2.9, 3.0, 3.05, 3.1, 3.2]
    // Q1 index = floor(7 * 0.25) = 1 → 2.85
    // Q3 index = floor(7 * 0.75) = 5 → 3.1
    assert(result.consensusZone.low >= 2.8 && result.consensusZone.low <= 2.9,
      `consensusZone.low should be ~2.85 (got ${result.consensusZone.low})`);
    assert(result.consensusZone.high >= 3.05 && result.consensusZone.high <= 3.2,
      `consensusZone.high should be ~3.1 (got ${result.consensusZone.high})`);
    assert(result.consensusZone.low < result.consensusZone.high,
      `consensusZone.low should be < high`);

    console.log(`    Consensus Zone: [${result.consensusZone.low}T, ${result.consensusZone.high}T]`);
    console.log(`    ✓ Consensus zone bounds are correct`);
  });

  // ── Test 5: Missing required params ────────────────────────────────
  console.log('\nScenario 2: Error handling for missing parameters\n');

  await test('throws on missing ticker', async () => {
    let threw = false;
    try {
      await runModeB({ assetClass: 'equity', selectedModels: ['stub/test'] });
    } catch (e) {
      threw = true;
      assert(e.message.includes('ticker'), `error should mention ticker (got: ${e.message})`);
    }
    assert(threw, 'should throw when ticker is missing');
  });

  await test('throws on missing selectedModels', async () => {
    let threw = false;
    try {
      await runModeB({ ticker: 'AAPL', assetClass: 'equity' });
    } catch (e) {
      threw = true;
      assert(e.message.includes('selectedModels'), `error should mention selectedModels (got: ${e.message})`);
    }
    assert(threw, 'should throw when selectedModels is missing');
  });

  // Cleanup
  closeDb();
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  console.log('\n=== All Mode B tests completed ===\n');
}

runAll();
