'use strict';

const { assembleDataPack } = require('./rawDataPack');
const { queryModels } = require('./modelQueryEngine');
const { stabilityCoefficient } = require('./outlierFilter');

// ---------------------------------------------------------------------------
// Temperature ladder for Monte Carlo runs
// ---------------------------------------------------------------------------
const TEMPERATURE_LADDER = [0.2, 0.3, 0.45, 0.6, 0.7];

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

function buildValuationPrompt(dataPack, targetDate) {
  return `You are a Solo Valuation Analyst. Given the asset data below, estimate the fair market capitalization for this asset${targetDate ? ` as of ${targetDate}` : ''}.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no code fences, no commentary:
{
  "estimatedMarketCapBillions": <number>,
  "reasoning": "<2-4 sentence valuation reasoning>"
}

Rules:
- estimatedMarketCapBillions must be a positive number in USD billions.
- reasoning must reference concrete data points from the provided pack.
- Do NOT include any text outside the JSON object.

--- ASSET DATA PACK ---
${JSON.stringify(dataPack, null, 2)}
--- END DATA PACK ---

Analyze this data and respond with the required JSON.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAgentResponse(output) {
  if (output !== null && typeof output === 'object') return output;
  if (typeof output === 'string') {
    const cleaned = output.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    return JSON.parse(cleaned);
  }
  throw new Error(`Unexpected agent output type: ${typeof output}`);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function computeDriftDirection(estimates) {
  let directionChanges = 0;
  let lastDirection = null;

  for (let i = 1; i < estimates.length; i++) {
    const diff = estimates[i] - estimates[i - 1];
    if (diff === 0) continue;
    const direction = diff > 0 ? 'up' : 'down';
    if (lastDirection && direction !== lastDirection) {
      directionChanges++;
    }
    lastDirection = direction;
  }

  if (directionChanges > 1) return 'oscillating';

  const overall = estimates[estimates.length - 1] - estimates[0];
  if (overall > 0) return 'upward';
  if (overall < 0) return 'downward';
  if (directionChanges === 0) return 'flat';
  return 'oscillating';
}

function confusionSummaryFromCV(cv) {
  if (cv < 5) return 'High Conviction \u2014 outputs clustered tightly across all temperature settings';
  if (cv <= 15) return 'Moderate Conviction \u2014 some variance but within acceptable range';
  if (cv <= 30) return 'Low Conviction \u2014 model shows meaningful uncertainty';
  return 'Unreliable \u2014 high drift detected, do not use this output for position sizing';
}

function stabilityBadgeFromCV(cv) {
  if (cv <= 15) return 'HIGH_STABILITY';
  return 'LOW_RELIABILITY';
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run Mode C: Stochastic Stress Test (Temperature-Varied Monte Carlo).
 *
 * Fires a single model 5 times sequentially across the temperature ladder
 * [0.2, 0.3, 0.45, 0.6, 0.7] and analyses variance across runs.
 *
 * @param {object} params
 * @param {string} params.ticker - Asset ticker (e.g. "AAPL", "BTC")
 * @param {string} params.assetClass - 'crypto' or 'equity'
 * @param {string} [params.targetDate] - Target date for valuation
 * @param {string} params.selectedModel - Single model identifier string
 * @param {Function} [params._handlerOverride] - Test hook to override model handler
 * @returns {Promise<object>} Full Mode C result object
 */
async function runModeC({ ticker, assetClass, targetDate, selectedModel, _handlerOverride }) {
  if (!ticker) throw new Error('ticker is required');
  if (!assetClass) throw new Error('assetClass is required');
  if (!selectedModel) throw new Error('selectedModel is required');

  // Step 1: Assemble shared data pack
  const dataPack = await assembleDataPack({ ticker, assetClass });
  const prompt = buildValuationPrompt(dataPack, targetDate);

  // Step 2: Fire 5 sequential calls across the temperature ladder
  let temperatureSupported = true;
  const runs = [];

  for (let i = 0; i < TEMPERATURE_LADDER.length; i++) {
    const temperature = TEMPERATURE_LADDER[i];

    const result = await queryModels({
      models: [selectedModel],
      prompt,
      assetClass,
      temperature,
      _handlerOverride,
    });

    if (result.results.length === 0) {
      throw new Error(`Model ${selectedModel} failed on run ${i + 1} (temperature ${temperature})`);
    }

    const parsed = parseAgentResponse(result.results[0].output);
    runs.push({
      run: i + 1,
      temperature,
      estimatedMarketCapBillions: parsed.estimatedMarketCapBillions,
      reasoning: parsed.reasoning,
    });
  }

  // Step 3: Compute statistics
  const estimates = runs.map(r => r.estimatedMarketCapBillions);
  const meanVal = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const variance = estimates.reduce((sum, v) => sum + (v - meanVal) ** 2, 0) / estimates.length;
  const stdDevVal = Math.sqrt(variance);

  const { cv, rating } = stabilityCoefficient(estimates);

  // Step 4: Confidence zone (25th and 75th percentile)
  const confidenceZone = {
    low: percentile(estimates, 0.25),
    high: percentile(estimates, 0.75),
  };

  // Step 5: Drift direction
  const driftDirection = computeDriftDirection(estimates);

  // Step 6: Confusion summary and stability badge
  const confusionSummary = confusionSummaryFromCV(cv);
  const stabilityBadge = stabilityBadgeFromCV(cv);

  return {
    runs,
    stats: {
      mean: meanVal,
      median: median(estimates),
      stdDev: stdDevVal,
      cv,
      rating,
    },
    confidenceZone,
    driftDirection,
    confusionSummary,
    stabilityBadge,
    temperatureSupported,
    dataFreshness: dataPack.data_freshness_timestamp,
  };
}

module.exports = { runModeC };
