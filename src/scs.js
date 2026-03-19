const { getModelReliability } = require('./modelReliability');

/**
 * Calculate Semantic Conviction Score from multiple model outputs.
 *
 * @param {object} params
 * @param {string[]} params.models - model name strings
 * @param {number[]} params.outputs - numeric scores from each model
 * @param {string} params.assetClass - asset class for reliability lookup
 * @param {string} [params.mode='sentiment'] - 'sentiment' or 'confidence'
 * @returns {{ score: number, label: string, variance: number }}
 */
function calculateSCS({ models, outputs, assetClass, mode = 'sentiment' }) {
  if (!models || !outputs || models.length === 0 || outputs.length === 0) {
    throw new Error('models and outputs must be non-empty arrays');
  }
  if (models.length !== outputs.length) {
    throw new Error('models and outputs must have the same length');
  }

  const n = models.length;

  // Retrieve R_i for each model and compute normalized weights
  const reliabilities = models.map(m => getModelReliability(m, assetClass));
  const sumR = reliabilities.reduce((a, b) => a + b, 0);
  const weights = reliabilities.map(r => r / sumR);

  // Weighted sum
  const weightedSum = weights.reduce((sum, w, i) => sum + w * outputs[i], 0);

  // Standard deviation of raw outputs, floored at 0.01
  const mean = outputs.reduce((a, b) => a + b, 0) / n;
  const varianceRaw = outputs.reduce((sum, s) => sum + (s - mean) ** 2, 0) / n;
  const sigmaVal = Math.max(Math.sqrt(varianceRaw), 0.01);

  // Raw score
  let score = weightedSum / sigmaVal;

  // Clamp based on mode
  if (mode === 'confidence') {
    score = Math.max(0, Math.min(100, score));
  } else {
    score = Math.max(-100, Math.min(100, score));
  }

  // Label derivation
  let label;
  if (mode === 'confidence') {
    if (score >= 70) label = 'High Confidence';
    else if (score >= 40) label = 'Moderate Confidence';
    else label = 'Low Confidence';
  } else {
    if (score >= 60) label = 'High Conviction Bullish';
    else if (score >= 20) label = 'Moderate Bullish';
    else if (score > -20) label = 'Neutral / Low Conviction';
    else if (score > -60) label = 'Moderate Bearish';
    else label = 'High Conviction Bearish';
  }

  return { score, label, variance: sigmaVal };
}

module.exports = { calculateSCS };
