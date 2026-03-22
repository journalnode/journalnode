'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const { runModeD } = require('./modeD');

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
// Stub data
// ---------------------------------------------------------------------------

const STUB_VISION_EXTRACT = {
  asset_context: { ticker: 'BTC', timeframe: '4H', last_price: 67500 },
  recent_price_action: [
    { candle_index: 0, type: 'bullish', volume: 'high' },
    { candle_index: 1, type: 'bearish', volume: 'normal' },
    { candle_index: 2, type: 'bullish', volume: 'high' },
  ],
  technical_indicators: { rsi: 72, ma_alignment: 'bullish', macd: 'bullish_cross' },
  visual_structures: { support_level: 65000, resistance_level: 70000, pattern_identified: 'ascending_triangle' },
};

// 8 downstream models: 6 long, 2 short
const MODEL_NAMES = [
  'openai/gpt-4o',
  'anthropic/claude-3.5-sonnet',
  'google/gemini-1.5-pro',
  'x-ai/grok-2',
  'deepseek/deepseek-v3',
  'qwen/qwen-72b',
  'moonshotai/kimi-v1',
  'openai/gpt-4o-mini',
];

function createModelResponse(modelName) {
  // Models 7 and 8 (index 6,7) are dissenters (short)
  const idx = MODEL_NAMES.indexOf(modelName);
  if (idx >= 6) {
    return {
      recommendation: 'short',
      confidence: 6,
      primaryReason: 'RSI approaching overbought territory with declining momentum',
      technicalJustification: 'RSI at 72 nearing exhaustion zone, bearish divergence on MACD histogram',
    };
  }
  return {
    recommendation: 'long',
    confidence: 8,
    primaryReason: 'Strong bullish momentum with ascending triangle breakout',
    technicalJustification: 'MA alignment bullish, MACD bullish cross confirmed, price holding above support',
  };
}

const STUB_TRAP_DETECTOR = {
  trapProbabilityScore: 85,
  trapType: 'bull_trap',
  divergences: [
    'Price/volume divergence: new highs on declining volume',
    'RSI at 72 approaching exhaustion zone above 75',
  ],
};

// ---------------------------------------------------------------------------
// Create a temporary test image file
// ---------------------------------------------------------------------------
const TEMP_IMAGE_PATH = path.join(os.tmpdir(), 'modeD_test_chart.png');

function ensureTestImage() {
  // Write a minimal 1x1 PNG (valid PNG header + IHDR + IDAT + IEND)
  const minimalPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  fs.writeFileSync(TEMP_IMAGE_PATH, minimalPng);
}

function cleanupTestImage() {
  if (fs.existsSync(TEMP_IMAGE_PATH)) fs.unlinkSync(TEMP_IMAGE_PATH);
}

// ---------------------------------------------------------------------------
// Handler factories
// ---------------------------------------------------------------------------

function createVisionHandler() {
  return async () => STUB_VISION_EXTRACT;
}

function createModelHandler() {
  return async ({ modelId }) => createModelResponse(modelId);
}

function createTrapHandler() {
  return async () => STUB_TRAP_DETECTOR;
}

/**
 * Vision handler that fails on the first call (returns unparseable string),
 * then succeeds on the second call.
 */
function createRetryVisionHandler() {
  let callCount = 0;
  return async () => {
    callCount++;
    if (callCount === 1) {
      return 'THIS IS NOT VALID JSON {{{{';
    }
    return STUB_VISION_EXTRACT;
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
async function runAll() {
  console.log('\n=== Mode D: Vision Pipeline + Trap Detector Tests ===\n');

  ensureTestImage();

  // ── Scenario 1: Full pipeline with 6 long / 2 short, trap score 85 ──
  console.log('Scenario 1: Standard pipeline (6 long, 2 short, trap=85)\n');

  await test('returns complete result object with correct schema', async () => {
    const result = await runModeD({
      imagePath: TEMP_IMAGE_PATH,
      selectedModels: MODEL_NAMES,
      ticker: 'BTC',
      _visionHandler: createVisionHandler(),
      _modelHandler: createModelHandler(),
      _trapHandler: createTrapHandler(),
    });

    console.log('    Full result:', JSON.stringify(result, null, 2));

    // Top-level schema checks
    assert(result.visionExtract !== null, 'visionExtract should not be null');
    assert(Array.isArray(result.runs), 'runs should be array');
    assert(result.runs.length === 8, `should have 8 runs (got ${result.runs.length})`);
    assert(typeof result.voteTally === 'object', 'voteTally should be object');
    assert(Array.isArray(result.dissentingModels), 'dissentingModels should be array');
    assert(typeof result.trapDetector === 'object', 'trapDetector should be object');
    assert(typeof result.divergentSignal === 'boolean', 'divergentSignal should be boolean');
    assert(typeof result.ohlcSummary === 'object', 'ohlcSummary should be object');
    assert(typeof result.visionExtractFailed === 'boolean', 'visionExtractFailed should be boolean');
    assert(Array.isArray(result.excluded), 'excluded should be array');
  });

  await test('vote tally counts are correct (6 long, 2 short, 0 neutral)', async () => {
    const result = await runModeD({
      imagePath: TEMP_IMAGE_PATH,
      selectedModels: MODEL_NAMES,
      ticker: 'BTC',
      _visionHandler: createVisionHandler(),
      _modelHandler: createModelHandler(),
      _trapHandler: createTrapHandler(),
    });

    assert(result.voteTally.long === 6, `voteTally.long should be 6 (got ${result.voteTally.long})`);
    assert(result.voteTally.short === 2, `voteTally.short should be 2 (got ${result.voteTally.short})`);
    assert(result.voteTally.neutral === 0, `voteTally.neutral should be 0 (got ${result.voteTally.neutral})`);
  });

  await test('divergentSignal is true when trap score > 70 contradicts majority', async () => {
    const result = await runModeD({
      imagePath: TEMP_IMAGE_PATH,
      selectedModels: MODEL_NAMES,
      ticker: 'BTC',
      _visionHandler: createVisionHandler(),
      _modelHandler: createModelHandler(),
      _trapHandler: createTrapHandler(),
    });

    assert(result.divergentSignal === true,
      `divergentSignal should be true (trap=85, type=bull_trap, majority=long)`);
    assert(result.trapDetector.trapProbabilityScore === 85,
      `trapProbabilityScore should be 85 (got ${result.trapDetector.trapProbabilityScore})`);
    assert(result.trapDetector.trapType === 'bull_trap',
      `trapType should be "bull_trap" (got "${result.trapDetector.trapType}")`);
  });

  await test('dissenting models are identified by name', async () => {
    const result = await runModeD({
      imagePath: TEMP_IMAGE_PATH,
      selectedModels: MODEL_NAMES,
      ticker: 'BTC',
      _visionHandler: createVisionHandler(),
      _modelHandler: createModelHandler(),
      _trapHandler: createTrapHandler(),
    });

    assert(result.dissentingModels.length === 2,
      `should have 2 dissenting models (got ${result.dissentingModels.length})`);

    const dissenterNames = result.dissentingModels.map(d => d.modelName);
    assert(dissenterNames.includes('moonshotai/kimi-v1'),
      `dissenters should include moonshotai/kimi-v1 (got ${JSON.stringify(dissenterNames)})`);
    assert(dissenterNames.includes('openai/gpt-4o-mini'),
      `dissenters should include openai/gpt-4o-mini (got ${JSON.stringify(dissenterNames)})`);

    // Each dissenter should have recommendation and technicalJustification
    for (const d of result.dissentingModels) {
      assert(d.recommendation === 'short', `dissenter ${d.modelName} should recommend short`);
      assert(typeof d.technicalJustification === 'string', `dissenter ${d.modelName} should have technicalJustification`);
    }
  });

  await test('ohlcSummary is populated from vision extract', async () => {
    const result = await runModeD({
      imagePath: TEMP_IMAGE_PATH,
      selectedModels: MODEL_NAMES,
      ticker: 'BTC',
      _visionHandler: createVisionHandler(),
      _modelHandler: createModelHandler(),
      _trapHandler: createTrapHandler(),
    });

    assert(result.ohlcSummary.lastPrice === 67500, `lastPrice should be 67500 (got ${result.ohlcSummary.lastPrice})`);
    assert(result.ohlcSummary.rsi === 72, `rsi should be 72 (got ${result.ohlcSummary.rsi})`);
    assert(result.ohlcSummary.maAlignment === 'bullish', `maAlignment should be "bullish" (got "${result.ohlcSummary.maAlignment}")`);
    assert(result.ohlcSummary.patternIdentified === 'ascending_triangle',
      `patternIdentified should be "ascending_triangle" (got "${result.ohlcSummary.patternIdentified}")`);
  });

  await test('visionExtractFailed is false on successful extraction', async () => {
    const result = await runModeD({
      imagePath: TEMP_IMAGE_PATH,
      selectedModels: MODEL_NAMES,
      ticker: 'BTC',
      _visionHandler: createVisionHandler(),
      _modelHandler: createModelHandler(),
      _trapHandler: createTrapHandler(),
    });

    assert(result.visionExtractFailed === false,
      `visionExtractFailed should be false (got ${result.visionExtractFailed})`);
  });

  // ── Scenario 2: Vision retry logic ────────────────────────────────
  console.log('\nScenario 2: Vision pre-processor retry logic\n');

  await test('retries once on first parse failure, succeeds on second attempt', async () => {
    const result = await runModeD({
      imagePath: TEMP_IMAGE_PATH,
      selectedModels: MODEL_NAMES,
      ticker: 'BTC',
      _visionHandler: createRetryVisionHandler(),
      _modelHandler: createModelHandler(),
      _trapHandler: createTrapHandler(),
    });

    assert(result.visionExtract !== null,
      'visionExtract should not be null after successful retry');
    assert(result.visionExtractFailed === false,
      `visionExtractFailed should be false after successful retry (got ${result.visionExtractFailed})`);
    assert(result.visionRetryCount === 1,
      `visionRetryCount should be 1 (got ${result.visionRetryCount})`);

    // Verify the extract is correct after retry
    assert(result.visionExtract.asset_context.ticker === 'BTC',
      'vision extract ticker should be BTC after retry');
  });

  await test('sets visionExtractFailed when both attempts fail', async () => {
    // Handler that always returns unparseable output
    const alwaysFailHandler = async () => 'NOT VALID JSON {{{{';

    const result = await runModeD({
      imagePath: TEMP_IMAGE_PATH,
      selectedModels: MODEL_NAMES,
      ticker: 'BTC',
      _visionHandler: alwaysFailHandler,
      _modelHandler: createModelHandler(),
      _trapHandler: createTrapHandler(),
    });

    assert(result.visionExtractFailed === true,
      `visionExtractFailed should be true when both attempts fail (got ${result.visionExtractFailed})`);
    assert(result.visionExtract === null,
      'visionExtract should be null when extraction fails');
  });

  // ── Scenario 3: Each run has correct per-model fields ─────────────
  console.log('\nScenario 3: Per-model response validation\n');

  await test('each run includes modelName, recommendation, confidence, technicalJustification', async () => {
    const result = await runModeD({
      imagePath: TEMP_IMAGE_PATH,
      selectedModels: MODEL_NAMES,
      ticker: 'BTC',
      _visionHandler: createVisionHandler(),
      _modelHandler: createModelHandler(),
      _trapHandler: createTrapHandler(),
    });

    for (const run of result.runs) {
      assert(typeof run.modelName === 'string', `run.modelName should be string (got ${typeof run.modelName})`);
      assert(['long', 'short', 'neutral'].includes(run.recommendation),
        `run.recommendation should be long/short/neutral (got "${run.recommendation}")`);
      assert(typeof run.confidence === 'number' && run.confidence >= 1 && run.confidence <= 10,
        `run.confidence should be 1-10 (got ${run.confidence})`);
      assert(typeof run.technicalJustification === 'string',
        `run.technicalJustification should be string`);
      assert(typeof run.primaryReason === 'string',
        `run.primaryReason should be string`);
    }
  });

  // ── Scenario 4: Trap detector with low score → no divergent signal ─
  console.log('\nScenario 4: No divergent signal when trap score is low\n');

  await test('divergentSignal is false when trap score <= 70', async () => {
    const lowTrapHandler = async () => ({
      trapProbabilityScore: 30,
      trapType: 'none',
      divergences: [],
    });

    const result = await runModeD({
      imagePath: TEMP_IMAGE_PATH,
      selectedModels: MODEL_NAMES,
      ticker: 'BTC',
      _visionHandler: createVisionHandler(),
      _modelHandler: createModelHandler(),
      _trapHandler: lowTrapHandler,
    });

    assert(result.divergentSignal === false,
      `divergentSignal should be false when trap score is 30 (got ${result.divergentSignal})`);
  });

  // ── Scenario 5: Error handling ────────────────────────────────────
  console.log('\nScenario 5: Error handling\n');

  await test('throws on missing imagePath', async () => {
    let threw = false;
    try {
      await runModeD({ selectedModels: MODEL_NAMES, ticker: 'BTC' });
    } catch (e) {
      threw = true;
      assert(e.message.includes('imagePath'), `error should mention imagePath (got: ${e.message})`);
    }
    assert(threw, 'should throw when imagePath is missing');
  });

  await test('throws on missing selectedModels', async () => {
    let threw = false;
    try {
      await runModeD({ imagePath: TEMP_IMAGE_PATH, ticker: 'BTC' });
    } catch (e) {
      threw = true;
      assert(e.message.includes('selectedModels'), `error should mention selectedModels (got: ${e.message})`);
    }
    assert(threw, 'should throw when selectedModels is missing');
  });

  await test('throws on missing ticker', async () => {
    let threw = false;
    try {
      await runModeD({ imagePath: TEMP_IMAGE_PATH, selectedModels: MODEL_NAMES });
    } catch (e) {
      threw = true;
      assert(e.message.includes('ticker'), `error should mention ticker (got: ${e.message})`);
    }
    assert(threw, 'should throw when ticker is missing');
  });

  // Cleanup
  cleanupTestImage();

  console.log('\n=== All Mode D tests completed ===\n');
}

runAll();
