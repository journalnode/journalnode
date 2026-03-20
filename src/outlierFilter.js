const fs = require('fs');
const path = require('path');

const HALLUCINATION_LOG = path.join(__dirname, '..', 'data', 'hallucination_log.jsonl');

function filterOutliers(values, threshold = 2) {
  if (!values || values.length === 0) {
    return { clean: [], outliers: [], mean: 0, stdDev: 0 };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  const clean = [];
  const outliers = [];

  for (let i = 0; i < values.length; i++) {
    const deviationDistance = Math.abs(values[i] - mean) / (stdDev || 1);
    if (deviationDistance > threshold) {
      outliers.push({ value: values[i], originalIndex: i, deviationDistance });
    } else {
      clean.push(values[i]);
    }
  }

  return { clean, outliers, mean, stdDev };
}

function trimmedMean(values) {
  if (!values || values.length === 0) return 0;
  if (values.length < 4) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const quarter = Math.floor(sorted.length / 4);
  const trimmed = sorted.slice(quarter, sorted.length - quarter);
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

function stabilityCoefficient(values) {
  if (!values || values.length === 0) {
    return { cv: 0, rating: 'LOW_RELIABILITY' };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean === 0 ? Infinity : (stdDev / Math.abs(mean)) * 100;

  let rating;
  if (cv <= 15) rating = 'HIGH_STABILITY';
  else if (cv <= 30) rating = 'MODERATE';
  else rating = 'LOW_RELIABILITY';

  return { cv, rating };
}

function logOutlierEvent({ modelName, value, deviation, mode, ticker }) {
  const record = {
    timestamp: new Date().toISOString(),
    modelName,
    value,
    deviation,
    mode,
    ticker,
  };

  const dir = path.dirname(HALLUCINATION_LOG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(HALLUCINATION_LOG, JSON.stringify(record) + '\n');
}

module.exports = {
  filterOutliers,
  trimmedMean,
  stabilityCoefficient,
  logOutlierEvent,
};
