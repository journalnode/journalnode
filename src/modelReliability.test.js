const path = require('path');
const fs = require('fs');

// Use a temporary database for testing
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'model_reliability.db');

// Remove any existing test database to start fresh
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

const { recordPrediction, scorePrediction, getModelReliability, getModelStats, closeDb } = require('./modelReliability');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\n=== Model Reliability Module Tests ===\n');

// --- recordPrediction tests ---
console.log('recordPrediction:');

const ids = [];

test('records a prediction and returns a UUID', () => {
  const id = recordPrediction({
    modelName: 'gpt-4',
    asset: 'BTC',
    assetClass: 'crypto',
    timeframe: '1d',
    predictedDirection: 'up',
    predictedValue: 70000,
    modeUsed: 'standard',
    timestamp: new Date().toISOString(),
  });
  assert(typeof id === 'string' && id.length === 36, 'should return a UUID string');
  ids.push(id);
});

test('records multiple predictions for different models and asset classes', () => {
  const predictions = [
    { modelName: 'gpt-4', asset: 'ETH', assetClass: 'crypto', timeframe: '4h', predictedDirection: 'down', predictedValue: 3000, modeUsed: 'standard', timestamp: new Date().toISOString() },
    { modelName: 'gpt-4', asset: 'AAPL', assetClass: 'equities', timeframe: '1d', predictedDirection: 'up', predictedValue: 200, modeUsed: 'standard', timestamp: new Date().toISOString() },
    { modelName: 'claude-3', asset: 'BTC', assetClass: 'crypto', timeframe: '1d', predictedDirection: 'up', predictedValue: 72000, modeUsed: 'enhanced', timestamp: new Date().toISOString() },
    { modelName: 'claude-3', asset: 'SOL', assetClass: 'crypto', timeframe: '1h', predictedDirection: 'down', predictedValue: 150, modeUsed: 'enhanced', timestamp: new Date().toISOString() },
  ];
  for (const p of predictions) {
    ids.push(recordPrediction(p));
  }
  assert(ids.length === 5, 'should have 5 prediction IDs total');
});

// Add more predictions to gpt-4 crypto to exceed the 5-scored threshold
test('records enough predictions to test R_i threshold', () => {
  for (let i = 0; i < 5; i++) {
    ids.push(recordPrediction({
      modelName: 'gpt-4',
      asset: 'BTC',
      assetClass: 'crypto',
      timeframe: '1d',
      predictedDirection: i % 2 === 0 ? 'up' : 'down',
      predictedValue: 65000 + i * 1000,
      modeUsed: 'standard',
      timestamp: new Date().toISOString(),
    }));
  }
  assert(ids.length === 10, 'should have 10 prediction IDs total');
});

// --- getModelReliability default tests ---
console.log('\ngetModelReliability (defaults):');

test('returns 1.0 when no scored predictions exist', () => {
  const r = getModelReliability('gpt-4', 'crypto');
  assert(r === 1.0, `expected 1.0, got ${r}`);
});

test('returns 1.0 for unknown model', () => {
  const r = getModelReliability('nonexistent', 'crypto');
  assert(r === 1.0, `expected 1.0, got ${r}`);
});

// --- scorePrediction tests ---
console.log('\nscorePrediction:');

test('scores a prediction as correct', () => {
  const ri = scorePrediction(ids[0], 'correct');
  console.log(`    R_i after scoring ids[0] correct: ${ri}`);
  assert(typeof ri === 'number', 'should return a number');
});

test('scores a prediction as incorrect', () => {
  const ri = scorePrediction(ids[1], 'incorrect');
  console.log(`    R_i after scoring ids[1] incorrect: ${ri}`);
  assert(typeof ri === 'number', 'should return a number');
});

test('scores a prediction as partial', () => {
  const ri = scorePrediction(ids[3], 'partial');
  console.log(`    R_i after scoring ids[3] partial (claude-3 crypto): ${ri}`);
  assert(typeof ri === 'number', 'should return a number');
});

test('throws on invalid outcome', () => {
  let threw = false;
  try {
    scorePrediction(ids[2], 'maybe');
  } catch {
    threw = true;
  }
  assert(threw, 'should throw on invalid outcome');
});

test('throws on nonexistent prediction id', () => {
  let threw = false;
  try {
    scorePrediction('00000000-0000-0000-0000-000000000000', 'correct');
  } catch {
    threw = true;
  }
  assert(threw, 'should throw on nonexistent id');
});

// Score remaining gpt-4 crypto predictions to exceed threshold
test('scores enough predictions to compute real R_i (>=5 scored)', () => {
  // ids[5..9] are the extra gpt-4 crypto predictions
  scorePrediction(ids[5], 'correct');   // 1
  scorePrediction(ids[6], 'correct');   // 1
  scorePrediction(ids[7], 'incorrect'); // 0
  scorePrediction(ids[8], 'partial');   // 0.5
  scorePrediction(ids[9], 'correct');   // 1

  // gpt-4 crypto scored: ids[0]=correct(1), ids[1]=incorrect(0), ids[5]=correct(1), ids[6]=correct(1), ids[7]=incorrect(0), ids[8]=partial(0.5), ids[9]=correct(1)
  // Total scored = 7, scoreSum = 1+0+1+1+0+0.5+1 = 4.5
  // R_i = 4.5 / 7 ≈ 0.6429
  const ri = getModelReliability('gpt-4', 'crypto');
  console.log(`    gpt-4 crypto R_i with 7 scored: ${ri}`);
  assert(ri >= 0 && ri <= 1, `R_i should be 0-1, got ${ri}`);
  assert(Math.abs(ri - 4.5 / 7) < 0.001, `expected ~0.6429, got ${ri}`);
});

// --- getModelReliability after scoring ---
console.log('\ngetModelReliability (after scoring):');

test('returns 1.0 for gpt-4 equities (fewer than 5 scored)', () => {
  const ri = getModelReliability('gpt-4', 'equities');
  assert(ri === 1.0, `expected 1.0 (< 5 scored), got ${ri}`);
});

test('returns 1.0 for claude-3 crypto (fewer than 5 scored)', () => {
  const ri = getModelReliability('claude-3', 'crypto');
  assert(ri === 1.0, `expected 1.0 (< 5 scored), got ${ri}`);
});

// --- getModelStats tests ---
console.log('\ngetModelStats:');

test('returns complete stats for gpt-4', () => {
  const stats = getModelStats('gpt-4');
  console.log('    gpt-4 stats:', JSON.stringify(stats, null, 2));
  assert(stats.modelName === 'gpt-4', 'modelName should be gpt-4');
  assert(stats.totalPredictions === 8, `expected 8 total, got ${stats.totalPredictions}`);
  assert(stats.scoredPredictions === 7, `expected 7 scored, got ${stats.scoredPredictions}`);
  assert(stats.byAssetClass.crypto, 'should have crypto asset class');
  assert(stats.byAssetClass.equities, 'should have equities asset class');
  assert(Math.abs(stats.byAssetClass.crypto.reliability - 4.5 / 7) < 0.001, 'crypto R_i should be ~0.6429');
  assert(stats.byAssetClass.equities.reliability === 1.0, 'equities R_i should be 1.0 (< 5 scored)');
});

test('returns complete stats for claude-3', () => {
  const stats = getModelStats('claude-3');
  console.log('    claude-3 stats:', JSON.stringify(stats, null, 2));
  assert(stats.modelName === 'claude-3', 'modelName should be claude-3');
  assert(stats.totalPredictions === 2, `expected 2 total, got ${stats.totalPredictions}`);
  assert(stats.scoredPredictions === 1, `expected 1 scored, got ${stats.scoredPredictions}`);
  assert(stats.byAssetClass.crypto.reliability === 1.0, 'crypto R_i should be 1.0 (< 5 scored)');
});

test('returns empty stats for unknown model', () => {
  const stats = getModelStats('nonexistent');
  console.log('    nonexistent stats:', JSON.stringify(stats, null, 2));
  assert(stats.totalPredictions === 0, 'should have 0 total predictions');
  assert(stats.scoredPredictions === 0, 'should have 0 scored predictions');
  assert(Object.keys(stats.byAssetClass).length === 0, 'should have no asset classes');
});

// Cleanup
closeDb();
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

console.log('\n=== All tests completed ===\n');
