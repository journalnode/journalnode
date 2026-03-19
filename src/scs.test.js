const path = require('path');
const fs = require('fs');

// Use a fresh database for testing
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'model_reliability.db');

if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

const { calculateSCS } = require('./scs');
const { closeDb } = require('./modelReliability');

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

console.log('\n=== SCS Calculator Tests ===\n');

// All models will have < 5 scored predictions so R_i = 1.0 for each,
// meaning weights are uniform.

// --- Test Case 1: High-agreement bullish ---
console.log('Test Case 1: High-agreement bullish');

test('high-agreement bullish produces High Conviction Bullish', () => {
  const result = calculateSCS({
    models: ['gpt-4', 'claude-3', 'gemini-pro', 'llama-3', 'mistral-large'],
    outputs: [72, 75, 70, 78, 74],
    assetClass: 'crypto',
    mode: 'sentiment',
  });
  console.log('    result:', JSON.stringify(result));

  // All R_i = 1.0, equal weights = 0.2 each
  // weightedSum = 0.2*(72+75+70+78+74) = 0.2*369 = 73.8
  // mean = 73.8, variance of [72,75,70,78,74]:
  //   deviations: -1.8, 1.2, -3.8, 4.2, 0.2
  //   variance = (3.24+1.44+14.44+17.64+0.04)/5 = 36.8/5 = 7.36
  //   sigma = sqrt(7.36) ≈ 2.713
  // score = 73.8 / 2.713 ≈ 27.20
  assert(result.score > 20, `score should be > 20 (got ${result.score})`);
  assert(result.score <= 100, `score should be <= 100 (got ${result.score})`);
  assert(result.label === 'Moderate Bullish' || result.label === 'High Conviction Bullish',
    `label should be bullish (got ${result.label})`);
  assert(result.variance > 0, `variance should be > 0 (got ${result.variance})`);
  assert(result.variance < 10, `variance should reflect tight agreement (got ${result.variance})`);
});

// --- Test Case 2: High-disagreement mixed ---
console.log('\nTest Case 2: High-disagreement mixed');

test('high-disagreement mixed produces low score with high variance', () => {
  const result = calculateSCS({
    models: ['gpt-4', 'claude-3', 'gemini-pro', 'llama-3'],
    outputs: [-50, 60, -45, 55],
    assetClass: 'equities',
    mode: 'sentiment',
  });
  console.log('    result:', JSON.stringify(result));

  // Equal weights (all R_i = 1.0)
  // weightedSum = (-50+60-45+55)/4 = 20/4 = 5
  // mean = 5, deviations: -55, 55, -50, 50
  // variance = (3025+3025+2500+2500)/4 = 11050/4 = 2762.5
  // sigma = sqrt(2762.5) ≈ 52.56
  // score = 5 / 52.56 ≈ 0.095
  assert(result.score > -20 && result.score < 20,
    `score should be near zero (got ${result.score})`);
  assert(result.label === 'Neutral / Low Conviction',
    `label should be Neutral / Low Conviction (got ${result.label})`);
  assert(result.variance > 40, `variance should be high (got ${result.variance})`);
});

// --- Test Case 3: Single-model edge case ---
console.log('\nTest Case 3: Single-model edge case');

test('single model uses floor sigma of 0.01', () => {
  const result = calculateSCS({
    models: ['gpt-4'],
    outputs: [80],
    assetClass: 'crypto',
    mode: 'sentiment',
  });
  console.log('    result:', JSON.stringify(result));

  // Single model: R_i = 1.0, weight = 1.0
  // weightedSum = 80, sigma = max(0, 0.01) = 0.01
  // raw score = 80 / 0.01 = 8000, clamped to 100
  assert(result.score === 100, `score should be clamped to 100 (got ${result.score})`);
  assert(result.label === 'High Conviction Bullish',
    `label should be High Conviction Bullish (got ${result.label})`);
  assert(result.variance === 0.01, `variance should be floored to 0.01 (got ${result.variance})`);
});

// --- Test Case 4: Confidence mode ---
console.log('\nTest Case 4: Confidence mode');

test('confidence mode clamps to [0, 100] and uses confidence labels', () => {
  const result = calculateSCS({
    models: ['gpt-4', 'claude-3'],
    outputs: [50, 55],
    assetClass: 'crypto',
    mode: 'confidence',
  });
  console.log('    result:', JSON.stringify(result));

  // weightedSum = 52.5, sigma = sqrt(6.25) = 2.5
  // score = 52.5 / 2.5 = 21.0
  assert(result.score >= 0, `confidence score should be >= 0 (got ${result.score})`);
  assert(result.score <= 100, `confidence score should be <= 100 (got ${result.score})`);
  assert(
    result.label === 'High Confidence' || result.label === 'Moderate Confidence' || result.label === 'Low Confidence',
    `label should be a confidence label (got ${result.label})`
  );
});

// --- Test Case 5: Negative single model in confidence mode ---
console.log('\nTest Case 5: Negative single model in confidence mode');

test('confidence mode clamps negative scores to 0', () => {
  const result = calculateSCS({
    models: ['gpt-4'],
    outputs: [-30],
    assetClass: 'crypto',
    mode: 'confidence',
  });
  console.log('    result:', JSON.stringify(result));

  assert(result.score === 0, `score should be clamped to 0 (got ${result.score})`);
  assert(result.label === 'Low Confidence', `label should be Low Confidence (got ${result.label})`);
});

// Cleanup
closeDb();
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

console.log('\n=== All SCS tests completed ===\n');
