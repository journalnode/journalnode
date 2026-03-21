'use strict';

const path = require('path');
const fs = require('fs');

// Use a fresh database for testing
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'model_reliability.db');
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const { runModeC } = require('./modeC');
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
// Response sets
// ---------------------------------------------------------------------------

// Low-variance set: estimates cluster tightly around 3.0T (CV < 5%)
const LOW_VARIANCE_ESTIMATES = [2.95, 2.98, 3.0, 3.02, 3.05];

// High-variance set: estimates are all over the place (CV > 30%)
const HIGH_VARIANCE_ESTIMATES = [1.0, 5.0, 2.0, 8.0, 3.0];

// Upward-trending set: monotonically increasing
const UPWARD_ESTIMATES = [2.0, 2.5, 3.0, 3.5, 4.0];

// Downward-trending set: monotonically decreasing
const DOWNWARD_ESTIMATES = [4.0, 3.5, 3.0, 2.5, 2.0];

// Oscillating set: direction changes more than once
const OSCILLATING_ESTIMATES = [3.0, 4.0, 2.0, 5.0, 1.0];

// Flat set: perfectly deterministic model returning identical estimates
const FLAT_ESTIMATES = [3.0, 3.0, 3.0, 3.0, 3.0];

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------
function createSequentialHandler(estimates) {
  let callIndex = 0;
  return async () => {
    const estimate = estimates[callIndex % estimates.length];
    callIndex++;
    return {
      estimatedMarketCapBillions: estimate,
      reasoning: `Run ${callIndex} valuation estimate at $${estimate}T based on peer multiples.`,
    };
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
async function runAll() {
  console.log('\n=== Mode C: Stochastic Stress Test Orchestrator Tests ===\n');

  // ── Scenario 1: Low-variance set → HIGH_STABILITY ──────────────────
  console.log('Scenario 1: Low-variance estimates (CV < 5%)\n');

  await test('returns correct schema with all required fields', async () => {
    clearCache();
    const handler = createSequentialHandler(LOW_VARIANCE_ESTIMATES);

    const result = await runModeC({
      ticker: 'AAPL',
      assetClass: 'equity',
      targetDate: '2026-06-01',
      selectedModel: 'stub/model-alpha',
      _handlerOverride: handler,
    });

    console.log('    Full result:', JSON.stringify(result, null, 2));

    // Schema checks
    assert(Array.isArray(result.runs), 'runs should be array');
    assert(result.runs.length === 5, `should have 5 runs (got ${result.runs.length})`);
    assert(typeof result.stats === 'object', 'stats should be object');
    assert(typeof result.stats.mean === 'number', 'stats.mean should be number');
    assert(typeof result.stats.median === 'number', 'stats.median should be number');
    assert(typeof result.stats.stdDev === 'number', 'stats.stdDev should be number');
    assert(typeof result.stats.cv === 'number', 'stats.cv should be number');
    assert(typeof result.stats.rating === 'string', 'stats.rating should be string');
    assert(typeof result.confidenceZone === 'object', 'confidenceZone should be object');
    assert(typeof result.confidenceZone.low === 'number', 'confidenceZone.low should be number');
    assert(typeof result.confidenceZone.high === 'number', 'confidenceZone.high should be number');
    assert(typeof result.driftDirection === 'string', 'driftDirection should be string');
    assert(typeof result.confusionSummary === 'string', 'confusionSummary should be string');
    assert(typeof result.stabilityBadge === 'string', 'stabilityBadge should be string');
    assert(typeof result.temperatureSupported === 'boolean', 'temperatureSupported should be boolean');
    assert(typeof result.dataFreshness === 'string', 'dataFreshness should be string');

    // Each run has required fields
    for (const run of result.runs) {
      assert(typeof run.run === 'number', 'run.run should be number');
      assert(typeof run.temperature === 'number', 'run.temperature should be number');
      assert(typeof run.estimatedMarketCapBillions === 'number', 'run.estimatedMarketCapBillions should be number');
      assert(typeof run.reasoning === 'string', 'run.reasoning should be string');
    }

    // Temperature ladder correctness
    const temps = result.runs.map(r => r.temperature);
    assert(JSON.stringify(temps) === JSON.stringify([0.2, 0.3, 0.45, 0.6, 0.7]),
      `temperatures should match ladder (got ${JSON.stringify(temps)})`);
  });

  await test('low-variance set produces HIGH_STABILITY badge', async () => {
    clearCache();
    const handler = createSequentialHandler(LOW_VARIANCE_ESTIMATES);

    const result = await runModeC({
      ticker: 'AAPL',
      assetClass: 'equity',
      selectedModel: 'stub/model-alpha',
      _handlerOverride: handler,
    });

    assert(result.stabilityBadge === 'HIGH_STABILITY',
      `stabilityBadge should be HIGH_STABILITY (got ${result.stabilityBadge})`);
    assert(result.stats.cv < 5,
      `CV should be < 5 for low-variance set (got ${result.stats.cv.toFixed(2)})`);
    assert(result.confusionSummary.startsWith('High Conviction'),
      `confusionSummary should start with "High Conviction" (got "${result.confusionSummary}")`);

    console.log(`    CV: ${result.stats.cv.toFixed(4)}%, Badge: ${result.stabilityBadge}`);
    console.log(`    Summary: ${result.confusionSummary}`);
  });

  await test('low-variance confidence zone is tight', async () => {
    clearCache();
    const handler = createSequentialHandler(LOW_VARIANCE_ESTIMATES);

    const result = await runModeC({
      ticker: 'AAPL',
      assetClass: 'equity',
      selectedModel: 'stub/model-alpha',
      _handlerOverride: handler,
    });

    assert(result.confidenceZone.low >= 2.9 && result.confidenceZone.low <= 3.0,
      `confidenceZone.low should be ~2.98 (got ${result.confidenceZone.low})`);
    assert(result.confidenceZone.high >= 3.0 && result.confidenceZone.high <= 3.1,
      `confidenceZone.high should be ~3.02 (got ${result.confidenceZone.high})`);

    console.log(`    Confidence Zone: [${result.confidenceZone.low}T, ${result.confidenceZone.high}T]`);
  });

  // ── Scenario 2: High-variance set → LOW_RELIABILITY ────────────────
  console.log('\nScenario 2: High-variance estimates (CV > 30%)\n');

  await test('high-variance set produces LOW_RELIABILITY badge', async () => {
    clearCache();
    const handler = createSequentialHandler(HIGH_VARIANCE_ESTIMATES);

    const result = await runModeC({
      ticker: 'BTC',
      assetClass: 'crypto',
      selectedModel: 'stub/model-bravo',
      _handlerOverride: handler,
    });

    console.log('    Full result:', JSON.stringify(result, null, 2));

    assert(result.stabilityBadge === 'LOW_RELIABILITY',
      `stabilityBadge should be LOW_RELIABILITY (got ${result.stabilityBadge})`);
    assert(result.stats.cv > 30,
      `CV should be > 30 for high-variance set (got ${result.stats.cv.toFixed(2)})`);
    assert(result.confusionSummary.startsWith('Unreliable'),
      `confusionSummary should start with "Unreliable" (got "${result.confusionSummary}")`);

    console.log(`    CV: ${result.stats.cv.toFixed(4)}%, Badge: ${result.stabilityBadge}`);
    console.log(`    Summary: ${result.confusionSummary}`);
  });

  await test('high-variance confidence zone is wide', async () => {
    clearCache();
    const handler = createSequentialHandler(HIGH_VARIANCE_ESTIMATES);

    const result = await runModeC({
      ticker: 'BTC',
      assetClass: 'crypto',
      selectedModel: 'stub/model-bravo',
      _handlerOverride: handler,
    });

    const spread = result.confidenceZone.high - result.confidenceZone.low;
    assert(spread > 1.0,
      `confidence zone spread should be > 1.0 for high-variance (got ${spread.toFixed(2)})`);

    console.log(`    Confidence Zone: [${result.confidenceZone.low}T, ${result.confidenceZone.high}T] (spread: ${spread.toFixed(2)}T)`);
  });

  // ── Scenario 3: Drift direction tests ──────────────────────────────
  console.log('\nScenario 3: Drift direction detection\n');

  await test('upward-trending sequence produces "upward" drift', async () => {
    clearCache();
    const handler = createSequentialHandler(UPWARD_ESTIMATES);

    const result = await runModeC({
      ticker: 'AAPL',
      assetClass: 'equity',
      selectedModel: 'stub/model-alpha',
      _handlerOverride: handler,
    });

    assert(result.driftDirection === 'upward',
      `driftDirection should be "upward" (got "${result.driftDirection}")`);

    console.log(`    Estimates: ${result.runs.map(r => r.estimatedMarketCapBillions).join(' → ')}`);
    console.log(`    Drift: ${result.driftDirection}`);
  });

  await test('downward-trending sequence produces "downward" drift', async () => {
    clearCache();
    const handler = createSequentialHandler(DOWNWARD_ESTIMATES);

    const result = await runModeC({
      ticker: 'AAPL',
      assetClass: 'equity',
      selectedModel: 'stub/model-alpha',
      _handlerOverride: handler,
    });

    assert(result.driftDirection === 'downward',
      `driftDirection should be "downward" (got "${result.driftDirection}")`);

    console.log(`    Estimates: ${result.runs.map(r => r.estimatedMarketCapBillions).join(' → ')}`);
    console.log(`    Drift: ${result.driftDirection}`);
  });

  await test('oscillating sequence produces "oscillating" drift', async () => {
    clearCache();
    const handler = createSequentialHandler(OSCILLATING_ESTIMATES);

    const result = await runModeC({
      ticker: 'AAPL',
      assetClass: 'equity',
      selectedModel: 'stub/model-alpha',
      _handlerOverride: handler,
    });

    assert(result.driftDirection === 'oscillating',
      `driftDirection should be "oscillating" (got "${result.driftDirection}")`);

    console.log(`    Estimates: ${result.runs.map(r => r.estimatedMarketCapBillions).join(' → ')}`);
    console.log(`    Drift: ${result.driftDirection}`);
  });

  await test('flat sequence (identical estimates) produces "flat" drift', async () => {
    clearCache();
    const handler = createSequentialHandler(FLAT_ESTIMATES);

    const result = await runModeC({
      ticker: 'AAPL',
      assetClass: 'equity',
      selectedModel: 'stub/model-alpha',
      _handlerOverride: handler,
    });

    assert(result.driftDirection === 'flat',
      `driftDirection should be "flat" (got "${result.driftDirection}")`);
    assert(result.stats.cv === 0 || result.stats.cv < 0.001,
      `CV should be ~0 for identical estimates (got ${result.stats.cv})`);

    console.log(`    Estimates: ${result.runs.map(r => r.estimatedMarketCapBillions).join(' → ')}`);
    console.log(`    Drift: ${result.driftDirection}, CV: ${result.stats.cv}`);
  });

  // ── Scenario 4: CV bucket → confusion summary mapping ─────────────
  console.log('\nScenario 4: Confusion summary CV-bucket matching\n');

  await test('CV < 5 maps to "High Conviction" summary', async () => {
    clearCache();
    const handler = createSequentialHandler(LOW_VARIANCE_ESTIMATES);

    const result = await runModeC({
      ticker: 'AAPL',
      assetClass: 'equity',
      selectedModel: 'stub/model-alpha',
      _handlerOverride: handler,
    });

    assert(result.stats.cv < 5, `CV should be < 5 (got ${result.stats.cv.toFixed(2)})`);
    assert(result.confusionSummary === 'High Conviction \u2014 outputs clustered tightly across all temperature settings',
      `confusionSummary mismatch (got "${result.confusionSummary}")`);
  });

  await test('CV > 30 maps to "Unreliable" summary', async () => {
    clearCache();
    const handler = createSequentialHandler(HIGH_VARIANCE_ESTIMATES);

    const result = await runModeC({
      ticker: 'BTC',
      assetClass: 'crypto',
      selectedModel: 'stub/model-bravo',
      _handlerOverride: handler,
    });

    assert(result.stats.cv > 30, `CV should be > 30 (got ${result.stats.cv.toFixed(2)})`);
    assert(result.confusionSummary === 'Unreliable \u2014 high drift detected, do not use this output for position sizing',
      `confusionSummary mismatch (got "${result.confusionSummary}")`);
  });

  // ── Scenario 5: Error handling ─────────────────────────────────────
  console.log('\nScenario 5: Error handling\n');

  await test('throws on missing ticker', async () => {
    let threw = false;
    try {
      await runModeC({ assetClass: 'equity', selectedModel: 'stub/test' });
    } catch (e) {
      threw = true;
      assert(e.message.includes('ticker'), `error should mention ticker (got: ${e.message})`);
    }
    assert(threw, 'should throw when ticker is missing');
  });

  await test('throws on missing selectedModel', async () => {
    let threw = false;
    try {
      await runModeC({ ticker: 'AAPL', assetClass: 'equity' });
    } catch (e) {
      threw = true;
      assert(e.message.includes('selectedModel'), `error should mention selectedModel (got: ${e.message})`);
    }
    assert(threw, 'should throw when selectedModel is missing');
  });

  // Cleanup
  closeDb();
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  console.log('\n=== All Mode C tests completed ===\n');
}

runAll();
