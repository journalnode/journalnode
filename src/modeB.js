'use strict';

const { assembleDataPack } = require('./rawDataPack');
const { queryModels } = require('./modelQueryEngine');
const { filterOutliers, trimmedMean } = require('./outlierFilter');
const { getModelReliability } = require('./modelReliability');

// ---------------------------------------------------------------------------
// System Prompts
// ---------------------------------------------------------------------------

const COORDINATOR_SYSTEM_EQUITY = `You are a Peer Group Coordinator Agent. Given a ticker and its asset data, identify the top 4 closest publicly-traded peers by industry, market cap, and revenue growth.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no code fences, no commentary:
{
  "peerGroup": [
    { "ticker": "<string>", "marketCap": <number in billions>, "rationale": "<1 sentence>" }
  ]
}

Rules:
- Return exactly 4 peers.
- Peers must be real, publicly-traded companies in the same or adjacent sector.
- marketCap is in USD billions.
- rationale must explain why this peer is comparable (industry overlap, revenue scale, growth profile).`;

const COORDINATOR_SYSTEM_CRYPTO = `You are a Peer Group Coordinator Agent. Given a crypto asset and its data, identify the top 4 closest crypto peers by TVL (total value locked) and market cap.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no code fences, no commentary:
{
  "peerGroup": [
    { "ticker": "<string>", "marketCap": <number in billions>, "rationale": "<1 sentence>" }
  ]
}

Rules:
- Return exactly 4 peers.
- Peers must be real crypto assets with comparable TVL and market cap.
- marketCap is in USD billions.
- rationale must explain why this peer is comparable (TVL range, market cap, protocol type).`;

function buildRelativeValuationPrompt(dataPack, peerGroup) {
  return `You are a Relative Valuation Specialist. Given the target asset data and its peer group, apply EV/Revenue and P/E multiples logic to estimate a fair market cap for the target. Determine whether the target trades at a premium or discount relative to its peers and justify your estimate.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no code fences, no commentary:
{
  "estimatedMarketCapBillions": <number>,
  "thesis": "<2-4 sentence valuation thesis>"
}

Rules:
- estimatedMarketCapBillions must be a positive number.
- thesis must reference specific peer multiples and the premium/discount logic.
- Do NOT include any text outside the JSON object.

--- ASSET DATA PACK ---
${JSON.stringify(dataPack, null, 2)}
--- END DATA PACK ---

--- PEER GROUP ---
${JSON.stringify(peerGroup, null, 2)}
--- END PEER GROUP ---

Analyze this data and respond with the required JSON.`;
}

const LOGIC_SCORE_PROMPT = `You previously provided a valuation estimate. Now assess the mathematical rigor of your own justification. Rate the rigor on a scale of 1–10 where 10 means every number is traceable to a concrete comparable and 1 means the estimate was largely speculative.

You MUST respond with ONLY valid JSON — no markdown, no code fences:
{
  "logicScore": <integer 1-10>,
  "reasoning": "<1-2 sentences explaining your self-assessment>"
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a structured JSON response from an agent. The output may be a
 * pre-parsed object (from a test handler) or a raw JSON string.
 */
function parseAgentResponse(output) {
  if (output !== null && typeof output === 'object') return output;
  if (typeof output === 'string') {
    const cleaned = output.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    return JSON.parse(cleaned);
  }
  throw new Error(`Unexpected agent output type: ${typeof output}`);
}

/**
 * Compute the interquartile range (Q1 to Q3) of an array of numbers.
 */
function interquartileRange(values) {
  if (!values || values.length === 0) return { low: 0, high: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const q1Idx = Math.floor(sorted.length * 0.25);
  const q3Idx = Math.floor(sorted.length * 0.75);
  return { low: sorted[q1Idx], high: sorted[q3Idx] };
}

/**
 * Compute weighted trimmed mean: applies trimmedMean logic but weights
 * each value by its model's reliability score R_i.
 */
function weightedTrimmedMean(values, weights) {
  if (!values || values.length === 0) return 0;

  // Pair values with weights and sort by value
  const pairs = values.map((v, i) => ({ v, w: weights[i] || 1 }));
  pairs.sort((a, b) => a.v - b.v);

  // Trim top and bottom quarter if enough values
  let trimmed = pairs;
  if (pairs.length >= 4) {
    const quarter = Math.floor(pairs.length / 4);
    trimmed = pairs.slice(quarter, pairs.length - quarter);
  }

  const totalWeight = trimmed.reduce((sum, p) => sum + p.w, 0);
  if (totalWeight === 0) return trimmedMean(values);
  return trimmed.reduce((sum, p) => sum + p.v * p.w, 0) / totalWeight;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run Mode B: Peer-Anchored Multi-Valuation.
 *
 * @param {object} params
 * @param {string} params.ticker - Asset ticker (e.g. "AAPL", "BTC")
 * @param {string} params.assetClass - 'crypto' or 'equity'
 * @param {string} [params.targetDate] - Target date for valuation
 * @param {string[]} params.selectedModels - Up to 8 model identifiers
 * @param {Function} [params._handlerOverride] - Test hook to override model handler
 * @returns {Promise<object>} Full Mode B result object
 */
async function runModeB({ ticker, assetClass, targetDate, selectedModels, _handlerOverride }) {
  if (!ticker) throw new Error('ticker is required');
  if (!assetClass) throw new Error('assetClass is required');
  if (!selectedModels || selectedModels.length === 0) throw new Error('selectedModels is required');

  // ── Step 1: Assemble the shared data pack ──────────────────────────
  const dataPack = await assembleDataPack({ ticker, assetClass });

  // ── Step 2: Coordinator Agent — identify peer group ────────────────
  const coordinatorPrompt = assetClass === 'crypto'
    ? `${COORDINATOR_SYSTEM_CRYPTO}\n\n--- ASSET DATA PACK ---\n${JSON.stringify(dataPack, null, 2)}\n--- END DATA PACK ---\n\nIdentify the top 4 peers for ${ticker} and respond with the required JSON.`
    : `${COORDINATOR_SYSTEM_EQUITY}\n\n--- ASSET DATA PACK ---\n${JSON.stringify(dataPack, null, 2)}\n--- END DATA PACK ---\n\nIdentify the top 4 peers for ${ticker} and respond with the required JSON.`;

  const coordinatorResult = await queryModels({
    models: [selectedModels[0]],
    prompt: coordinatorPrompt,
    assetClass,
    _handlerOverride,
  });

  if (coordinatorResult.results.length === 0) {
    throw new Error('Coordinator Agent returned no results');
  }

  const coordinatorResponse = parseAgentResponse(coordinatorResult.results[0].output);
  const peerGroup = coordinatorResponse.peerGroup;

  // ── Step 3: Fire all models in parallel — Relative Valuation ───────
  const valuationPrompt = buildRelativeValuationPrompt(dataPack, peerGroup);

  const valuationResult = await queryModels({
    models: selectedModels,
    prompt: valuationPrompt,
    assetClass,
    _handlerOverride,
  });

  // Parse each model's response
  const modelResponses = valuationResult.results.map(r => {
    const parsed = parseAgentResponse(r.output);
    return {
      modelName: r.modelName,
      estimate: parsed.estimatedMarketCapBillions,
      thesis: parsed.thesis,
    };
  });

  // ── Step 4: Detect outliers at 1 stddev — fire Logic Score prompts ─
  const estimates = modelResponses.map(m => m.estimate);
  const mean = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const variance = estimates.reduce((sum, v) => sum + (v - mean) ** 2, 0) / estimates.length;
  const stdDev = Math.sqrt(variance);

  // Flag models outside 1 stddev
  const flaggedIndices = new Set();
  for (let i = 0; i < estimates.length; i++) {
    const deviation = Math.abs(estimates[i] - mean) / (stdDev || 1);
    if (deviation > 1) flaggedIndices.add(i);
  }

  // Fire Logic Score prompts only for flagged models
  const logicScoreResults = new Map();
  if (flaggedIndices.size > 0) {
    const flaggedModels = [];
    for (const idx of flaggedIndices) {
      flaggedModels.push(modelResponses[idx].modelName);
    }

    const logicScoreQueryResult = await queryModels({
      models: flaggedModels,
      prompt: LOGIC_SCORE_PROMPT,
      assetClass,
      _handlerOverride,
    });

    for (const r of logicScoreQueryResult.results) {
      const parsed = parseAgentResponse(r.output);
      logicScoreResults.set(r.modelName, parsed.logicScore);
    }
  }

  // ── Step 5: Filter outliers, compute VAC ───────────────────────────
  const outlierResult = filterOutliers(estimates, 2);

  // Determine which models are outliers (threshold 2)
  const outlierValues = new Set(outlierResult.outliers.map(o => o.originalIndex));

  // Build model results array
  const models = modelResponses.map((m, i) => ({
    modelName: m.modelName,
    estimate: m.estimate,
    logicScore: logicScoreResults.get(m.modelName) || null,
    outlier: outlierValues.has(i),
  }));

  // Compute weighted trimmed mean on clean values
  const cleanModels = modelResponses.filter((_, i) => !outlierValues.has(i));
  const cleanValues = cleanModels.map(m => m.estimate);
  const cleanWeights = cleanModels.map(m => getModelReliability(m.modelName, assetClass));

  const vac = weightedTrimmedMean(cleanValues, cleanWeights);

  // Consensus zone = IQR of non-outlier estimates
  const consensusZone = interquartileRange(cleanValues);

  // Build excluded list from query failures + outlier-excluded models
  const excluded = [
    ...valuationResult.excluded,
    ...outlierResult.outliers.map(o => ({
      modelName: modelResponses[o.originalIndex].modelName,
      reason: `outlier (z-score: ${o.deviationDistance.toFixed(2)})`,
    })),
  ];

  return {
    vac,
    consensusZone,
    models,
    peerGroup,
    dataFreshness: dataPack.data_freshness_timestamp,
    excluded,
  };
}

module.exports = { runModeB };
