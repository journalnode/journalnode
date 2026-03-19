const path = require('path');
const fs = require('fs');

// Use a fresh database for testing
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'model_reliability.db');

if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

const { queryModels, queryModelsWithSCS } = require('./modelQueryEngine');
const { closeDb } = require('./modelReliability');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
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

async function runAll() {
  console.log('\n=== Model Query Engine Tests ===\n');

  // ── Test 1: Parallel execution timing ──────────────────────────────
  console.log('Test Case 1: Parallel execution timing');

  await test('5 stubbed models complete in parallel (executionMs < n * delay)', async () => {
    const DELAY = 200; // ms each stub takes
    const NUM_MODELS = 5;

    const slowStub = async () => {
      await new Promise(r => setTimeout(r, DELAY));
      return 65;
    };

    const result = await queryModels({
      models: ['model-a', 'model-b', 'model-c', 'model-d', 'model-e'],
      prompt: 'test prompt',
      assetClass: 'crypto',
      timeout: 5000,
      _handlerOverride: slowStub,
    });

    console.log('    meta:', JSON.stringify(result.meta));

    // If serial, would take >= 1000ms. Parallel should be ~200ms.
    const maxAllowed = NUM_MODELS * DELAY;
    assert(result.meta.executionMs < maxAllowed,
      `executionMs (${result.meta.executionMs}) should be < ${maxAllowed} (serial time)`);
    assert(result.meta.totalRequested === NUM_MODELS,
      `totalRequested should be ${NUM_MODELS} (got ${result.meta.totalRequested})`);
    assert(result.meta.totalSucceeded === NUM_MODELS,
      `totalSucceeded should be ${NUM_MODELS} (got ${result.meta.totalSucceeded})`);
    assert(result.meta.totalExcluded === 0,
      `totalExcluded should be 0 (got ${result.meta.totalExcluded})`);
    assert(result.results.length === NUM_MODELS,
      `results length should be ${NUM_MODELS} (got ${result.results.length})`);
    assert(result.results.every(r => r.status === 'success'),
      'all results should have status "success"');
    assert(result.results.every(r => r.output === 65),
      'all results should have output 65');
  });

  // ── Test 2: Forced timeout populates excluded array ────────────────
  console.log('\nTest Case 2: Forced timeout populates excluded array');

  await test('timed-out model is excluded with correct reason', async () => {
    const TIMEOUT = 100; // ms

    // Handler that takes longer than timeout for specific models
    const mixedHandler = async ({ modelId }) => {
      if (modelId === 'slow-model') {
        await new Promise(r => setTimeout(r, 500)); // way over timeout
        return 99;
      }
      return 42; // fast models return immediately
    };

    const result = await queryModels({
      models: ['fast-a', 'slow-model', 'fast-b'],
      prompt: 'test prompt',
      assetClass: 'equities',
      timeout: TIMEOUT,
      _handlerOverride: mixedHandler,
    });

    console.log('    results:', JSON.stringify(result.results));
    console.log('    excluded:', JSON.stringify(result.excluded));
    console.log('    meta:', JSON.stringify(result.meta));

    assert(result.meta.totalRequested === 3,
      `totalRequested should be 3 (got ${result.meta.totalRequested})`);
    assert(result.meta.totalSucceeded === 2,
      `totalSucceeded should be 2 (got ${result.meta.totalSucceeded})`);
    assert(result.meta.totalExcluded === 1,
      `totalExcluded should be 1 (got ${result.meta.totalExcluded})`);

    assert(result.excluded.length === 1, `excluded length should be 1 (got ${result.excluded.length})`);
    assert(result.excluded[0].modelName === 'slow-model',
      `excluded model should be slow-model (got ${result.excluded[0].modelName})`);
    assert(result.excluded[0].status === 'timeout',
      `excluded status should be timeout (got ${result.excluded[0].status})`);
    assert(result.excluded[0].reason.includes('exceeded'),
      `excluded reason should mention exceeded (got ${result.excluded[0].reason})`);

    assert(result.results.length === 2, `results length should be 2 (got ${result.results.length})`);
    assert(result.results.every(r => r.output === 42),
      'fast model outputs should be 42');
  });

  // ── Test 3: Error handling populates excluded array ────────────────
  console.log('\nTest Case 3: Error handling populates excluded array');

  await test('erroring model is excluded with error status', async () => {
    const errorHandler = async ({ modelId }) => {
      if (modelId === 'broken-model') {
        throw new Error('API key invalid');
      }
      return 70;
    };

    const result = await queryModels({
      models: ['good-model', 'broken-model'],
      prompt: 'test prompt',
      assetClass: 'crypto',
      timeout: 5000,
      _handlerOverride: errorHandler,
    });

    console.log('    results:', JSON.stringify(result.results));
    console.log('    excluded:', JSON.stringify(result.excluded));

    assert(result.meta.totalSucceeded === 1,
      `totalSucceeded should be 1 (got ${result.meta.totalSucceeded})`);
    assert(result.meta.totalExcluded === 1,
      `totalExcluded should be 1 (got ${result.meta.totalExcluded})`);
    assert(result.excluded[0].modelName === 'broken-model',
      `excluded model should be broken-model (got ${result.excluded[0].modelName})`);
    assert(result.excluded[0].status === 'error',
      `excluded status should be error (got ${result.excluded[0].status})`);
  });

  // ── Test 4: SCS integration ────────────────────────────────────────
  console.log('\nTest Case 4: SCS integration via queryModelsWithSCS');

  await test('queryModelsWithSCS returns valid SCS score and label', async () => {
    const deterministicHandler = async ({ modelId }) => {
      const values = { 'model-1': 70, 'model-2': 75, 'model-3': 65 };
      return values[modelId] || 50;
    };

    const result = await queryModelsWithSCS({
      models: ['model-1', 'model-2', 'model-3'],
      prompt: 'rate BTC sentiment -100 to 100',
      assetClass: 'crypto',
      mode: 'sentiment',
      timeout: 5000,
      _handlerOverride: deterministicHandler,
    });

    console.log('    scs:', JSON.stringify(result.scs));
    console.log('    queryMeta:', JSON.stringify(result.queryMeta));

    assert(typeof result.scs.score === 'number', `score should be a number (got ${typeof result.scs.score})`);
    assert(typeof result.scs.label === 'string', `label should be a string (got ${typeof result.scs.label})`);
    assert(typeof result.scs.variance === 'number', `variance should be a number (got ${typeof result.scs.variance})`);
    assert(result.scs.score >= -100 && result.scs.score <= 100,
      `score should be in [-100, 100] (got ${result.scs.score})`);
    assert(result.scs.score > 0, `score should be positive for bullish inputs (got ${result.scs.score})`);
    assert(result.queryMeta.totalRequested === 3,
      `totalRequested should be 3 (got ${result.queryMeta.totalRequested})`);
    assert(result.queryMeta.totalSucceeded === 3,
      `totalSucceeded should be 3 (got ${result.queryMeta.totalSucceeded})`);
  });

  // ── Test 5: SCS integration with partial results (some excluded) ───
  console.log('\nTest Case 5: SCS integration with partial results');

  await test('queryModelsWithSCS works when some models time out', async () => {
    const partialHandler = async ({ modelId }) => {
      if (modelId === 'slow-one') {
        await new Promise(r => setTimeout(r, 500));
        return 99;
      }
      return 60;
    };

    const result = await queryModelsWithSCS({
      models: ['fast-1', 'fast-2', 'slow-one'],
      prompt: 'test',
      assetClass: 'equities',
      mode: 'sentiment',
      timeout: 100,
      _handlerOverride: partialHandler,
    });

    console.log('    scs:', JSON.stringify(result.scs));
    console.log('    queryMeta:', JSON.stringify(result.queryMeta));

    assert(result.queryMeta.totalExcluded === 1,
      `totalExcluded should be 1 (got ${result.queryMeta.totalExcluded})`);
    assert(result.queryMeta.totalSucceeded === 2,
      `totalSucceeded should be 2 (got ${result.queryMeta.totalSucceeded})`);
    assert(typeof result.scs.score === 'number',
      `score should still be computed (got ${typeof result.scs.score})`);
  });

  // ── Test 6: Built-in stub handlers ─────────────────────────────────
  console.log('\nTest Case 6: Built-in stub handlers return numeric output');

  await test('stub handlers for non-OpenAI/Anthropic models return numbers', async () => {
    const result = await queryModels({
      models: [
        'google/gemini-3-flash-preview',
        'x-ai/grok-4',
        'deepseek/deepseek-v3.2',
        'qwen/qwen3.5-397b-a17b',
        'unknown/new-model',
      ],
      prompt: 'test prompt',
      assetClass: 'crypto',
      timeout: 5000,
    });

    console.log('    results:', JSON.stringify(result.results));

    assert(result.meta.totalSucceeded === 5,
      `all 5 stubs should succeed (got ${result.meta.totalSucceeded})`);
    assert(result.results.every(r => typeof r.output === 'number'),
      'all stub outputs should be numbers');
  });

  // Cleanup
  closeDb();
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  console.log('\n=== All Model Query Engine tests completed ===\n');
}

runAll();
