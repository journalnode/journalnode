const fs = require('fs');
const path = require('path');
const { filterOutliers, trimmedMean, stabilityCoefficient, logOutlierEvent } = require('./outlierFilter');

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

console.log('\n=== Outlier Filter Tests ===\n');

// --- Test Case 1: Clean array with no outliers ---
console.log('Test Case 1: Clean array with no outliers');

test('clean array produces empty outliers list', () => {
  const result = filterOutliers([10, 11, 12, 10, 11]);
  console.log('    result:', JSON.stringify(result));

  assert(result.outliers.length === 0, `expected 0 outliers, got ${result.outliers.length}`);
  assert(result.clean.length === 5, `expected 5 clean values, got ${result.clean.length}`);
  assert(typeof result.mean === 'number', 'mean should be a number');
  assert(typeof result.stdDev === 'number', 'stdDev should be a number');
});

// --- Test Case 2: Array with one obvious outlier ---
console.log('\nTest Case 2: Array with one obvious outlier');

test('obvious outlier is flagged with index and deviation', () => {
  // Use enough values so the single outlier doesn't dominate mean/stdDev
  const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 100];
  const result = filterOutliers(values);
  console.log('    result:', JSON.stringify(result));

  assert(result.outliers.length === 1, `expected 1 outlier, got ${result.outliers.length}`);
  assert(result.outliers[0].value === 100, `outlier value should be 100, got ${result.outliers[0].value}`);
  assert(result.outliers[0].originalIndex === 9, `outlier index should be 9, got ${result.outliers[0].originalIndex}`);
  assert(result.outliers[0].deviationDistance > 2, `deviation should be > 2, got ${result.outliers[0].deviationDistance}`);
  assert(result.clean.length === 9, `expected 9 clean values, got ${result.clean.length}`);
});

// --- Test Case 3: trimmedMean edge case with fewer than 4 values ---
console.log('\nTest Case 3: trimmedMean edge case (fewer than 4 values)');

test('trimmedMean with fewer than 4 values returns simple mean', () => {
  const result = trimmedMean([5, 10, 15]);
  console.log('    result:', result);

  // Simple mean of [5, 10, 15] = 10
  assert(result === 10, `expected 10, got ${result}`);

  // Also verify normal trimmed mean works
  const trimmed = trimmedMean([1, 2, 3, 4, 5, 6, 7, 8]);
  console.log('    trimmedMean([1..8]):', trimmed);
  // sorted: [1,2,3,4,5,6,7,8], quarter=2, trimmed: [3,4,5,6], mean = 4.5
  assert(trimmed === 4.5, `expected 4.5, got ${trimmed}`);

  // Edge: empty array
  const empty = trimmedMean([]);
  assert(empty === 0, `expected 0 for empty array, got ${empty}`);
});

// --- Test Case 4: stabilityCoefficient verified against manual CV ---
console.log('\nTest Case 4: stabilityCoefficient manual CV verification');

test('CV matches hand-calculated value', () => {
  // values: [100, 100, 100, 100, 100] => mean=100, stdDev=0, cv=0 => HIGH_STABILITY
  const perfect = stabilityCoefficient([100, 100, 100, 100, 100]);
  console.log('    perfect stability:', JSON.stringify(perfect));
  assert(perfect.cv === 0, `expected cv=0, got ${perfect.cv}`);
  assert(perfect.rating === 'HIGH_STABILITY', `expected HIGH_STABILITY, got ${perfect.rating}`);

  // values: [10, 20, 30, 40, 50]
  // mean = 30, variance = ((20^2 + 10^2 + 0 + 10^2 + 20^2) / 5) = 1000/5 = 200
  // stdDev = sqrt(200) ≈ 14.1421
  // cv = (14.1421 / 30) * 100 ≈ 47.14
  const spread = stabilityCoefficient([10, 20, 30, 40, 50]);
  console.log('    spread result:', JSON.stringify(spread));

  const expectedCv = (Math.sqrt(200) / 30) * 100;
  const diff = Math.abs(spread.cv - expectedCv);
  assert(diff < 0.01, `cv should be ~${expectedCv.toFixed(4)}, got ${spread.cv}`);
  assert(spread.rating === 'LOW_RELIABILITY', `expected LOW_RELIABILITY, got ${spread.rating}`);

  // Moderate case: values [90, 95, 100, 105, 110]
  // mean=100, variance = (100+25+0+25+100)/5 = 50, stdDev = sqrt(50) ≈ 7.071
  // cv = (7.071 / 100) * 100 ≈ 7.071 => HIGH_STABILITY
  const moderate = stabilityCoefficient([90, 95, 100, 105, 110]);
  console.log('    moderate result:', JSON.stringify(moderate));
  assert(moderate.rating === 'HIGH_STABILITY', `expected HIGH_STABILITY, got ${moderate.rating}`);
});

console.log('\n=== All outlier filter tests completed ===\n');
