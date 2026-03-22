'use strict';

const fs = require('fs');
const path = require('path');
const { queryModels } = require('./modelQueryEngine');

// ---------------------------------------------------------------------------
// System Prompts
// ---------------------------------------------------------------------------

const VISION_PREPROCESSOR_SYSTEM = `You are a Visual Quantitative Analyst. Your task is to transcribe a chart image into structured data only. Return no prose, no trade recommendations, and no commentary.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no code fences, no commentary:
{
  "asset_context": { "ticker": "<string>", "timeframe": "<string>", "last_price": <number> },
  "recent_price_action": [{ "candle_index": <number>, "type": "<bullish|bearish|doji>", "volume": "<high|normal|low>" }],
  "technical_indicators": { "rsi": <number>, "ma_alignment": "<bullish|bearish|neutral>", "macd": "<bullish_cross|bearish_cross|neutral>" },
  "visual_structures": { "support_level": <number>, "resistance_level": <number>, "pattern_identified": "<string>" }
}

Rules:
- All fields are required. Use your best estimate from the chart.
- Do NOT include any text outside the JSON object.
- Do NOT provide trade recommendations or opinions.`;

function buildDownstreamModelPrompt(visionExtract, base64Image, ticker) {
  const dataSection = visionExtract
    ? `--- EXTRACTED CHART DATA ---\n${JSON.stringify(visionExtract, null, 2)}\n--- END CHART DATA ---`
    : `--- WARNING ---\nVision extraction failed. Analyze the chart image directly.\n--- END WARNING ---`;

  return `You are a Technical Analysis Agent. Analyze the following chart data for ${ticker} and provide your directional recommendation.

${dataSection}

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no code fences, no commentary:
{
  "recommendation": "<long|short|neutral>",
  "confidence": <integer 1-10>,
  "primaryReason": "<1 sentence>",
  "technicalJustification": "<1-2 sentences referencing specific technical signals>"
}

Rules:
- recommendation must be exactly one of: "long", "short", or "neutral".
- confidence must be an integer from 1 to 10.
- Do NOT include any text outside the JSON object.`;
}

const TRAP_DETECTOR_SYSTEM = `You are a Contrarian Trap Detector. Your task is to identify bull trap and bear trap signals in the provided chart data. Check for:
1. Price/volume divergence (price making new highs on declining volume or vice versa)
2. RSI exhaustion above 75 or below 25
3. Long upper wicks at resistance on long recommendations
4. Stop-run patterns (sharp moves that reverse quickly)

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no code fences, no commentary:
{
  "trapProbabilityScore": <integer 0-100>,
  "trapType": "<bull_trap|bear_trap|none>",
  "divergences": ["<string describing each divergence found>"]
}

Rules:
- trapProbabilityScore must be an integer from 0 to 100.
- trapType must be exactly one of: "bull_trap", "bear_trap", or "none".
- divergences is an array of strings; empty array if no divergences found.
- Do NOT include any text outside the JSON object.`;

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

function readAndEncodeImage(imagePath) {
  const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.resolve(imagePath);
  const buffer = fs.readFileSync(absolutePath);
  return buffer.toString('base64');
}

function determineMajority(voteTally) {
  if (voteTally.long >= voteTally.short && voteTally.long >= voteTally.neutral) return 'long';
  if (voteTally.short >= voteTally.long && voteTally.short >= voteTally.neutral) return 'short';
  return 'neutral';
}

function trapContradictsMajority(trapType, majority) {
  if (trapType === 'bull_trap' && majority === 'long') return true;
  if (trapType === 'bear_trap' && majority === 'short') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run Mode D: Vision Pipeline + Contrarian Trap Detector.
 *
 * @param {object} params
 * @param {string} params.imagePath - Local file path to chart screenshot (PNG/JPEG)
 * @param {string[]} params.selectedModels - Up to 8 model identifier strings
 * @param {string} params.ticker - Asset ticker (e.g. "BTC", "AAPL")
 * @param {Function} [params._visionHandler] - Test hook for vision model call
 * @param {Function} [params._modelHandler] - Test hook for downstream model calls
 * @param {Function} [params._trapHandler] - Test hook for trap detector call
 * @returns {Promise<object>} Full Mode D result object
 */
async function runModeD({ imagePath, selectedModels, ticker, _visionHandler, _modelHandler, _trapHandler }) {
  if (!imagePath) throw new Error('imagePath is required');
  if (!selectedModels || selectedModels.length === 0) throw new Error('selectedModels is required');
  if (!ticker) throw new Error('ticker is required');

  // ── Step 1: Read and base64-encode the image ──────────────────────
  const base64Image = readAndEncodeImage(imagePath);

  // ── Step 2: Vision Pre-Processor — extract structured data ────────
  let visionExtract = null;
  let visionExtractFailed = false;
  let visionRetryCount = 0;

  const visionPrompt = `${VISION_PREPROCESSOR_SYSTEM}\n\nAnalyze the provided chart image for ${ticker} and respond with the required JSON.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const visionResult = await queryModels({
      models: [selectedModels[0]],
      prompt: visionPrompt,
      _handlerOverride: _visionHandler,
    });

    if (visionResult.results.length === 0) {
      if (attempt === 0) {
        visionRetryCount++;
        continue;
      }
      visionExtractFailed = true;
      break;
    }

    try {
      visionExtract = parseAgentResponse(visionResult.results[0].output);
      break;
    } catch (_parseErr) {
      if (attempt === 0) {
        visionRetryCount++;
        continue;
      }
      visionExtractFailed = true;
    }
  }

  // ── Step 3: Fire downstream models + trap detector in parallel ────
  const downstreamPrompt = buildDownstreamModelPrompt(visionExtract, base64Image, ticker);

  const trapPrompt = `${TRAP_DETECTOR_SYSTEM}\n\n--- EXTRACTED CHART DATA ---\n${JSON.stringify(visionExtract, null, 2)}\n--- END CHART DATA ---\n\nAnalyze this data for trap signals and respond with the required JSON.`;

  const [modelQueryResult, trapQueryResult] = await Promise.all([
    queryModels({
      models: selectedModels,
      prompt: downstreamPrompt,
      _handlerOverride: _modelHandler,
    }),
    queryModels({
      models: ['trap-detector/contrarian-v1'],
      prompt: trapPrompt,
      _handlerOverride: _trapHandler,
    }),
  ]);

  // ── Step 4: Parse model responses ─────────────────────────────────
  const runs = modelQueryResult.results.map(r => {
    const parsed = parseAgentResponse(r.output);
    return {
      modelName: r.modelName,
      recommendation: parsed.recommendation,
      confidence: parsed.confidence,
      primaryReason: parsed.primaryReason,
      technicalJustification: parsed.technicalJustification,
    };
  });

  // ── Step 5: Parse trap detector response ──────────────────────────
  let trapDetector = { trapProbabilityScore: 0, trapType: 'none', divergences: [] };
  if (trapQueryResult.results.length > 0) {
    trapDetector = parseAgentResponse(trapQueryResult.results[0].output);
  }

  // ── Step 6: Compute vote tally and dissenting models ──────────────
  const voteTally = { long: 0, short: 0, neutral: 0 };
  for (const run of runs) {
    if (run.recommendation === 'long') voteTally.long++;
    else if (run.recommendation === 'short') voteTally.short++;
    else voteTally.neutral++;
  }

  const majority = determineMajority(voteTally);

  const dissentingModels = runs
    .filter(r => r.recommendation !== majority)
    .map(r => ({
      modelName: r.modelName,
      recommendation: r.recommendation,
      technicalJustification: r.technicalJustification,
    }));

  // ── Step 7: Determine divergent signal ────────────────────────────
  const divergentSignal =
    trapDetector.trapProbabilityScore > 70 &&
    trapContradictsMajority(trapDetector.trapType, majority);

  // ── Step 8: Build OHLC summary from vision extract ────────────────
  const ohlcSummary = visionExtract
    ? {
        lastPrice: visionExtract.asset_context.last_price,
        rsi: visionExtract.technical_indicators.rsi,
        maAlignment: visionExtract.technical_indicators.ma_alignment,
        patternIdentified: visionExtract.visual_structures.pattern_identified,
      }
    : { lastPrice: null, rsi: null, maAlignment: null, patternIdentified: null };

  // ── Step 9: Assemble and return ───────────────────────────────────
  const excluded = [
    ...modelQueryResult.excluded,
    ...trapQueryResult.excluded,
  ];

  return {
    visionExtract,
    runs,
    voteTally,
    dissentingModels,
    trapDetector,
    divergentSignal,
    ohlcSummary,
    visionExtractFailed,
    excluded,
    visionRetryCount,
  };
}

module.exports = { runModeD };
