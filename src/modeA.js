'use strict';

const { assembleDataPack } = require('./rawDataPack');
const { queryModels } = require('./modelQueryEngine');
const { calculateSCS } = require('./scs');

// ---------------------------------------------------------------------------
// System Prompts
// ---------------------------------------------------------------------------

const BULL_CATALYST_SCOUT_SYSTEM = `You are the Bull Catalyst Scout, a specialized financial analyst focused on identifying bullish catalysts, upside drivers, and positive momentum signals. Analyze the provided asset data pack with a constructive lens. Identify growth catalysts, adoption signals, positive macro tailwinds, and underappreciated strengths.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no code fences, no commentary:
{
  "direction": "bull",
  "score": <integer from 1 to 100, where 100 = maximum bullish conviction>,
  "keyPoints": [<3-5 concise strings identifying specific bullish catalysts>],
  "semanticProximityKeywords": [<5-8 single-word or short-phrase keywords relevant to bullish thesis>],
  "signalStrength": "<one of: absent | weak | moderate | strong>"
}

Rules:
- score MUST be a positive integer between 1 and 100.
- keyPoints must contain 3 to 5 specific, evidence-grounded observations from the data.
- signalStrength reflects how clearly the bullish signal emerges from the data.
- Do NOT hedge or present bearish counterpoints — that is the other agent's job.`;

const BEAR_RISK_AUDITOR_SYSTEM = `You are the Bear Risk Auditor, a specialized financial analyst focused on identifying downside risks, bearish signals, structural weaknesses, and red flags. Analyze the provided asset data pack with a critical, risk-focused lens. Surface valuation concerns, negative momentum, macro headwinds, and fragility indicators.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no code fences, no commentary:
{
  "direction": "bear",
  "score": <integer from -100 to -1, where -100 = maximum bearish conviction>,
  "keyPoints": [<3-5 concise strings identifying specific bearish risks>],
  "semanticProximityKeywords": [<5-8 single-word or short-phrase keywords relevant to bearish thesis>],
  "signalStrength": "<one of: absent | weak | moderate | strong>"
}

Rules:
- score MUST be a negative integer between -100 and -1.
- keyPoints must contain 3 to 5 specific, evidence-grounded observations from the data.
- signalStrength reflects how clearly the bearish signal emerges from the data.
- Do NOT hedge or present bullish counterpoints — that is the other agent's job.`;

const SEMANTIC_ARBITER_SYSTEM = `You are the Semantic Arbiter, a neutral meta-analyst that synthesizes competing bullish and bearish analyses into a balanced conviction assessment. You receive a Bull Catalyst Scout report and a Bear Risk Auditor report, and must weigh the strength, specificity, and evidence quality of each.

You MUST respond with ONLY valid JSON matching this exact schema — no markdown, no code fences, no commentary:
{
  "scsScore": <number from -100 to 100, your synthesized conviction score>,
  "bullPct": <number 0-100, percentage weight assigned to the bull thesis>,
  "bearPct": <number 0-100, percentage weight assigned to the bear thesis>,
  "synthesisSummary": "<2-4 sentence synthesis explaining the balance of evidence>",
  "baselineTruths": [<2-4 factual statements both sides would agree on>]
}

Rules:
- bullPct + bearPct must equal 100.
- scsScore should reflect the net directional conviction after weighing both sides.
- baselineTruths are objective, non-directional facts grounded in the data.
- Be precise and avoid generic statements.`;

const BULL_FOLLOWUP_SYSTEM = `You are the Bull Catalyst Scout performing a follow-up verification pass. You have already submitted your initial analysis. Now provide ONE additional verifying data point that strengthens or refines your bullish thesis.

Respond with ONLY valid JSON — no markdown, no code fences:
{
  "additionalPoint": "<one specific verifying observation>",
  "revisedSignalStrength": "<one of: absent | weak | moderate | strong>"
}`;

const BEAR_FOLLOWUP_SYSTEM = `You are the Bear Risk Auditor performing a follow-up verification pass. You have already submitted your initial analysis. Now provide ONE additional verifying data point that strengthens or refines your bearish thesis.

Respond with ONLY valid JSON — no markdown, no code fences:
{
  "additionalPoint": "<one specific verifying observation>",
  "revisedSignalStrength": "<one of: absent | weak | moderate | strong>"
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the user prompt for an agent, embedding the full data pack as context.
 */
function buildAgentPrompt(systemPrompt, dataPack) {
  return `${systemPrompt}\n\n--- ASSET DATA PACK ---\n${JSON.stringify(dataPack, null, 2)}\n--- END DATA PACK ---\n\nAnalyze this data and respond with the required JSON.`;
}

/**
 * Build the Arbiter prompt from bull and bear reports.
 */
function buildArbiterPrompt(bullReport, bearReport, supplementary) {
  let content = `${SEMANTIC_ARBITER_SYSTEM}\n\n--- BULL CATALYST SCOUT REPORT ---\n${JSON.stringify(bullReport, null, 2)}\n--- END BULL REPORT ---\n\n--- BEAR RISK AUDITOR REPORT ---\n${JSON.stringify(bearReport, null, 2)}\n--- END BEAR REPORT ---`;

  if (supplementary) {
    content += `\n\n--- SUPPLEMENTARY BULL DATA ---\n${JSON.stringify(supplementary.bull, null, 2)}\n--- END SUPPLEMENTARY BULL ---\n\n--- SUPPLEMENTARY BEAR DATA ---\n${JSON.stringify(supplementary.bear, null, 2)}\n--- END SUPPLEMENTARY BEAR ---`;
  }

  content += '\n\nSynthesize these reports and respond with the required JSON.';
  return content;
}

/**
 * Build a follow-up prompt for recursive research.
 */
function buildFollowupPrompt(systemPrompt, dataPack, initialReport) {
  return `${systemPrompt}\n\n--- ORIGINAL DATA PACK ---\n${JSON.stringify(dataPack, null, 2)}\n--- END DATA PACK ---\n\n--- YOUR INITIAL REPORT ---\n${JSON.stringify(initialReport, null, 2)}\n--- END INITIAL REPORT ---\n\nProvide your follow-up verification point.`;
}

/**
 * Parse a structured JSON response from an agent. The output may be a
 * pre-parsed object (from a test handler) or a raw JSON string.
 */
function parseAgentResponse(output) {
  if (output !== null && typeof output === 'object') return output;
  if (typeof output === 'string') {
    // Strip markdown fences if present
    const cleaned = output.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    return JSON.parse(cleaned);
  }
  throw new Error(`Unexpected agent output type: ${typeof output}`);
}

// ---------------------------------------------------------------------------
// Variance threshold for semantic decay warning
// ---------------------------------------------------------------------------
const DECAY_VARIANCE_THRESHOLD = 40;

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run Mode A: Three-Agent Bullish/Bearish Debate.
 *
 * @param {object} params
 * @param {string} params.ticker - Asset ticker (e.g. "BTC", "AAPL")
 * @param {string} params.assetClass - 'crypto' or 'equity'
 * @param {string} [params.timeframe='1W'] - Analysis timeframe
 * @param {string} params.primaryModel - Model identifier (e.g. "openai/gpt-5.2-chat")
 * @param {Function} [params._handlerOverride] - Test hook to override model handler
 * @returns {Promise<object>} Full Mode A result object
 */
async function runModeA({ ticker, assetClass, timeframe = '1W', primaryModel, _handlerOverride }) {
  if (!ticker) throw new Error('ticker is required');
  if (!assetClass) throw new Error('assetClass is required');
  if (!primaryModel) throw new Error('primaryModel is required');

  // ── Step 1: Assemble the shared data pack ──────────────────────────
  const dataPack = await assembleDataPack({ ticker, assetClass, timeframe });

  // ── Step 2: Fire Bull and Bear agents in parallel ──────────────────
  const bullPrompt = buildAgentPrompt(BULL_CATALYST_SCOUT_SYSTEM, dataPack);
  const bearPrompt = buildAgentPrompt(BEAR_RISK_AUDITOR_SYSTEM, dataPack);

  const [bullQueryResult, bearQueryResult] = await Promise.all([
    queryModels({
      models: [primaryModel],
      prompt: bullPrompt,
      assetClass,
      timeframe,
      _handlerOverride,
    }),
    queryModels({
      models: [primaryModel],
      prompt: bearPrompt,
      assetClass,
      timeframe,
      _handlerOverride,
    }),
  ]);

  if (bullQueryResult.results.length === 0) throw new Error('Bull agent returned no results');
  if (bearQueryResult.results.length === 0) throw new Error('Bear agent returned no results');

  const bullReport = parseAgentResponse(bullQueryResult.results[0].output);
  const bearReport = parseAgentResponse(bearQueryResult.results[0].output);

  // Collect excluded models from all queries
  let allExcluded = [
    ...bullQueryResult.excluded,
    ...bearQueryResult.excluded,
  ];

  // ── Step 3: Semantic Arbiter — initial pass ────────────────────────
  const arbiterPrompt = buildArbiterPrompt(bullReport, bearReport);
  const arbiterQueryResult = await queryModels({
    models: [primaryModel],
    prompt: arbiterPrompt,
    assetClass,
    timeframe,
    _handlerOverride,
  });

  if (arbiterQueryResult.results.length === 0) throw new Error('Arbiter returned no results');
  allExcluded = allExcluded.concat(arbiterQueryResult.excluded);

  let arbiterReport = parseAgentResponse(arbiterQueryResult.results[0].output);

  // ── Step 4: Recursive research if spread > 60 (capped at depth 1) ─
  const spread = Math.abs(bullReport.score - bearReport.score);
  let recursiveResearchTriggered = false;

  if (spread > 60) {
    recursiveResearchTriggered = true;

    // Fire follow-up prompts in parallel
    const bullFollowupPrompt = buildFollowupPrompt(BULL_FOLLOWUP_SYSTEM, dataPack, bullReport);
    const bearFollowupPrompt = buildFollowupPrompt(BEAR_FOLLOWUP_SYSTEM, dataPack, bearReport);

    const [bullFollowup, bearFollowup] = await Promise.all([
      queryModels({
        models: [primaryModel],
        prompt: bullFollowupPrompt,
        assetClass,
        timeframe,
        _handlerOverride,
      }),
      queryModels({
        models: [primaryModel],
        prompt: bearFollowupPrompt,
        assetClass,
        timeframe,
        _handlerOverride,
      }),
    ]);

    allExcluded = allExcluded.concat(bullFollowup.excluded, bearFollowup.excluded);

    const bullSupp = bullFollowup.results.length > 0
      ? parseAgentResponse(bullFollowup.results[0].output)
      : null;
    const bearSupp = bearFollowup.results.length > 0
      ? parseAgentResponse(bearFollowup.results[0].output)
      : null;

    // Second Arbiter pass with supplementary data
    const arbiterPrompt2 = buildArbiterPrompt(bullReport, bearReport, {
      bull: bullSupp,
      bear: bearSupp,
    });

    const arbiterResult2 = await queryModels({
      models: [primaryModel],
      prompt: arbiterPrompt2,
      assetClass,
      timeframe,
      _handlerOverride,
    });

    allExcluded = allExcluded.concat(arbiterResult2.excluded);

    if (arbiterResult2.results.length > 0) {
      arbiterReport = parseAgentResponse(arbiterResult2.results[0].output);
    }
  }

  // ── Step 5: Pipe through calculateSCS ──────────────────────────────
  // Use the arbiter's scsScore as one "model output" alongside the
  // raw bull and bear scores to produce a weighted SCS result.
  const scsModels = [
    `${primaryModel}/bull`,
    `${primaryModel}/bear`,
    `${primaryModel}/arbiter`,
  ];
  const scsOutputs = [bullReport.score, bearReport.score, arbiterReport.scsScore];

  const scsResult = calculateSCS({
    models: scsModels,
    outputs: scsOutputs,
    assetClass,
    mode: 'sentiment',
  });

  // ── Step 6: Assemble return object ─────────────────────────────────
  // Merge semantic proximity keywords from both agents
  const semanticProximityKeywords = [
    ...(bullReport.semanticProximityKeywords || []),
    ...(bearReport.semanticProximityKeywords || []),
  ];

  // Semantic decay warning: flag when output variance is high
  const semanticDecayWarning = scsResult.variance > DECAY_VARIANCE_THRESHOLD;

  // Deduplicate excluded
  const excludedNames = new Set();
  const excluded = allExcluded.filter(e => {
    if (excludedNames.has(e.modelName)) return false;
    excludedNames.add(e.modelName);
    return true;
  });

  return {
    scsScore: scsResult.score,
    label: scsResult.label,
    bullPct: arbiterReport.bullPct,
    bearPct: arbiterReport.bearPct,
    synthesisSummary: arbiterReport.synthesisSummary,
    semanticProximityKeywords,
    semanticDecayWarning,
    recursiveResearchTriggered,
    excluded,
    dataFreshness: dataPack.data_freshness_timestamp,
  };
}

module.exports = { runModeA };
