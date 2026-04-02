const { chat, chatWithMessages } = require('./openrouter');

const TEMPERATURE_LADDER = [0.2, 0.3, 0.45, 0.6, 0.7];

const HARSH_JUDGE_BLOCK = `You are implementing the canonical March 31, 2026 Journal Node methodology for LLM-optimized crypto analysis.

You are demanding, skeptical, and allergic to fake precision.
- Do not reward weak theses with flattering language.
- Distinguish evidence from framing.
- Treat missing data as missing data, not as an invitation to hallucinate.
- Keep outputs compact enough to be rendered in Discord.
- Return only valid JSON with double-quoted keys and string values where needed.`;

const DATA_GROUNDING_BLOCK = `DIMENSION 1 — DATA GROUNDING SCORING RULES:

1. For every quantified claim in the thesis, classify it as VERIFIABLE, PLAUSIBLE, or UNVERIFIABLE.
2. UNVERIFIABLE claims receive zero credit toward Data Grounding.
3. PLAUSIBLE claims count at half weight.
4. Cited sources are not automatically verified.
5. State the classification before assigning any data-grounding conclusion.`;

function buildContext(request) {
  const lines = [
    `Asset: ${request.asset}`,
    `Trade thesis: ${request.thesis}`,
  ];

  if (request.timeframe) lines.push(`Time horizon: ${request.timeframe}`);
  if (typeof request.currentPrice === 'number') lines.push(`Current price: ${request.currentPrice}`);
  if (typeof request.marketCap === 'number') lines.push(`Current market cap USD: ${request.marketCap}`);
  if (request.supportingData) lines.push(`Supporting data / notes:\n${request.supportingData}`);
  if (request.chartImageUrl) lines.push('Chart image: attached separately for vision-capable analysis.');

  lines.push('If a required fact is missing, say so explicitly and downgrade confidence.');
  return lines.join('\n\n');
}

function safeJsonParse(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model did not return JSON.');
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

async function parseJsonWithRepair(rawText) {
  try {
    return safeJsonParse(rawText);
  } catch (err) {
    const repaired = await chat(
      'You repair malformed model output into valid JSON. Return only valid JSON.',
      `Convert the following text into valid JSON without adding commentary:\n\n${rawText}`,
      { maxTokens: 1600, temperature: 0 }
    );
    return safeJsonParse(repaired);
  }
}

function clampNumber(value, min, max, fallback = min) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function quartile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[Math.min(base + 1, sorted.length - 1)];
  return sorted[base] + rest * (next - sorted[base]);
}

function standardDeviation(values, meanValue) {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, value) => sum + ((value - meanValue) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

async function runBullBearMode(request) {
  const prompt = `${HARSH_JUDGE_BLOCK}

Mode: A — Three-Agent Bullish/Bearish Debate.

Simulate three roles:
- Bull Catalyst Scout
- Bear Risk Auditor
- Semantic Arbiter

Use the whitepaper rules:
- Produce a net SCS-style arbiter score from -100 to 100.
- Bull and bear conviction scores are 0 to 100.
- Flag semantic decay when the evidence is too mixed, too vague, or too dependent on missing data.
- Trigger recursive research when the bull/bear spread is greater than 60.
- Mention how this mode feeds Consensus Alignment and Thesis Coherence.
- Apply the anti-sycophancy stance: the arbiter must adjudicate, not split the difference diplomatically.

${DATA_GROUNDING_BLOCK}

Return JSON with this shape:
{
  "bullScore": 0,
  "bearScore": 0,
  "arbiterScore": 0,
  "semanticDecay": true,
  "recursiveResearch": false,
  "debateWinner": "bullish|bearish|neutral",
  "dataGrounding": [{"claim":"", "classification":"VERIFIABLE|PLAUSIBLE|UNVERIFIABLE"}],
  "bullPoints": ["", "", ""],
  "bearPoints": ["", "", ""],
  "arbiterSummary": "",
  "consensusAlignmentNote": "",
  "thesisCoherenceNote": "",
  "riskFlags": ["", ""],
  "confidenceLabel": "LOW|MEDIUM|HIGH"
}`;

  const raw = await chat(prompt, buildContext(request), { maxTokens: 1400, temperature: 0.35 });
  const parsed = await parseJsonWithRepair(raw);
  const bullScore = clampNumber(parsed.bullScore, 0, 100, 50);
  const bearScore = clampNumber(parsed.bearScore, 0, 100, 50);
  const arbiterScore = clampNumber(parsed.arbiterScore, -100, 100, 0);
  const spread = Math.abs(bullScore - bearScore);
  const semanticDecay = Boolean(parsed.semanticDecay) || (Math.abs(arbiterScore) < 15 && spread < 20);
  const recursiveResearch = Boolean(parsed.recursiveResearch) || spread > 60;

  const summary = [
    `Beta Mode A | ${parsed.debateWinner || 'neutral'} | Arbiter SCS ${arbiterScore >= 0 ? '+' : ''}${arbiterScore}`,
    `Bull ${bullScore}/100 vs Bear ${bearScore}/100 | Spread ${spread} | Semantic decay ${semanticDecay ? 'ON' : 'OFF'} | Recursive research ${recursiveResearch ? 'YES' : 'NO'}`,
    '',
    '**Bull Catalyst Scout**',
    ...((parsed.bullPoints || []).slice(0, 4).map(point => `- ${point}`)),
    '',
    '**Bear Risk Auditor**',
    ...((parsed.bearPoints || []).slice(0, 4).map(point => `- ${point}`)),
    '',
    `**Arbiter** ${parsed.arbiterSummary || 'No arbiter summary returned.'}`,
    `**CTS Hooks** Consensus Alignment: ${parsed.consensusAlignmentNote || 'No note.'}`,
    `**CTS Hooks** Thesis Coherence: ${parsed.thesisCoherenceNote || 'No note.'}`,
  ];

  if (Array.isArray(parsed.riskFlags) && parsed.riskFlags.length) {
    summary.push(`**Risk Flags** ${parsed.riskFlags.slice(0, 3).join(' | ')}`);
  }

  if (Array.isArray(parsed.dataGrounding) && parsed.dataGrounding.length) {
    const claims = parsed.dataGrounding
      .slice(0, 4)
      .map(item => `${item.classification}: ${item.claim}`)
      .join(' | ');
    summary.push(`**Data Grounding** ${claims}`);
  }

  return {
    title: 'Bullish/Bearish v2',
    description: summary.join('\n'),
  };
}

async function runMultiValuationMode(request) {
  const prompt = `${HARSH_JUDGE_BLOCK}

Mode: B — Peer-Anchored Multi-Valuation.

Simulate a valuation panel using these personas:
- Howard Marks
- Seth Klarman
- Stanley Druckenmiller
- Michael Platt
- George Soros

Requirements:
- Each analyst gives a fair market cap estimate in USD and a confidence score from 0 to 1.
- Use peer anchoring and margin-of-safety thinking.
- Admit uncertainty when the thesis lacks hard numbers.
- Do not manufacture consensus.
- Mention how the output affects Data Grounding and Risk Identification.

${DATA_GROUNDING_BLOCK}

Return JSON:
{
  "estimates": [
    {"analyst":"", "fairMarketCapUsd":0, "confidence":0.0, "stance":"undervalued|fair|overvalued", "rationale":""}
  ],
  "consensusSummary": "",
  "dataGroundingNote": "",
  "riskIdentificationNote": "",
  "uncertaintyDrivers": ["", ""]
}`;

  const raw = await chat(prompt, buildContext(request), { maxTokens: 1500, temperature: 0.3 });
  const parsed = await parseJsonWithRepair(raw);
  const estimates = Array.isArray(parsed.estimates) ? parsed.estimates
    .map(item => ({
      analyst: item.analyst || 'Unknown',
      fairMarketCapUsd: Number(item.fairMarketCapUsd),
      confidence: clampNumber(item.confidence, 0.05, 1, 0.5),
      stance: item.stance || 'fair',
      rationale: item.rationale || '',
    }))
    .filter(item => Number.isFinite(item.fairMarketCapUsd) && item.fairMarketCapUsd > 0) : [];

  if (estimates.length === 0) {
    throw new Error('Multi-valuation mode returned no usable estimates.');
  }

  const sorted = [...estimates].sort((a, b) => a.fairMarketCapUsd - b.fairMarketCapUsd);
  const trimmed = sorted.length > 4 ? sorted.slice(1, -1) : sorted;
  const totalWeight = trimmed.reduce((sum, item) => sum + item.confidence, 0) || 1;
  const vac = trimmed.reduce((sum, item) => sum + (item.fairMarketCapUsd * item.confidence), 0) / totalWeight;
  const allValues = sorted.map(item => item.fairMarketCapUsd);
  const q1 = quartile(allValues, 0.25);
  const q3 = quartile(allValues, 0.75);
  const medianValue = median(allValues);
  const zoneWidthPct = medianValue === 0 ? 0 : ((q3 - q1) / medianValue) * 100;
  const uncertaintyLabel = zoneWidthPct <= 25 ? 'TIGHT' : zoneWidthPct <= 60 ? 'MODERATE' : 'WIDE';
  const valuationGap = Number.isFinite(request.marketCap)
    ? ((vac - request.marketCap) / request.marketCap) * 100
    : null;

  const estimateLines = sorted
    .slice(0, 5)
    .map(item => `- ${item.analyst}: ${formatUsd(item.fairMarketCapUsd)} | conf ${item.confidence.toFixed(2)} | ${item.stance}`)
    .join('\n');

  const summary = [
    `Beta Mode B | VAC ${formatUsd(vac)} | Consensus zone ${formatUsd(q1)} to ${formatUsd(q3)} | ${uncertaintyLabel} uncertainty`,
    valuationGap === null
      ? 'Current market cap not provided, so valuation gap cannot be quantified.'
      : `Current market cap ${formatUsd(request.marketCap)} | Gap vs VAC ${valuationGap >= 0 ? '+' : ''}${valuationGap.toFixed(1)}%`,
    '',
    '**Panel Estimates**',
    estimateLines,
    '',
    `**Consensus** ${parsed.consensusSummary || 'No consensus summary returned.'}`,
    `**CTS Hooks** Data Grounding: ${parsed.dataGroundingNote || 'No note.'}`,
    `**CTS Hooks** Risk Identification: ${parsed.riskIdentificationNote || 'No note.'}`,
  ];

  if (Array.isArray(parsed.uncertaintyDrivers) && parsed.uncertaintyDrivers.length) {
    summary.push(`**Uncertainty Drivers** ${parsed.uncertaintyDrivers.slice(0, 3).join(' | ')}`);
  }

  return {
    title: 'Multi-Valuation v2',
    description: summary.join('\n'),
  };
}

async function runStressTestMode(request) {
  const prompt = `${HARSH_JUDGE_BLOCK}

Mode: C — Stochastic Stress Test.

You are testing whether the thesis conviction survives temperature variation.

Return JSON:
{
  "direction": "bullish|bearish|neutral",
  "convictionScore": 0,
  "keyUncertainty": "",
  "stabilityNote": "",
  "riskTrigger": ""
}

Rules:
- convictionScore is from -100 to 100.
- Keep reasoning concise.
- Do not anchor to prior outputs; evaluate this run independently.`;

  const runs = [];
  for (const temperature of TEMPERATURE_LADDER) {
    const raw = await chat(prompt, buildContext(request), { maxTokens: 500, temperature });
    const parsed = await parseJsonWithRepair(raw);
    runs.push({
      temperature,
      direction: parsed.direction || 'neutral',
      convictionScore: clampNumber(parsed.convictionScore, -100, 100, 0),
      keyUncertainty: parsed.keyUncertainty || '',
      stabilityNote: parsed.stabilityNote || '',
      riskTrigger: parsed.riskTrigger || '',
    });
  }

  const scores = runs.map(run => run.convictionScore);
  const meanScore = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const sigma = standardDeviation(scores, meanScore);
  const cv = (sigma / Math.max(Math.abs(meanScore), 0.01)) * 100;
  const stability = cv <= 15 ? 'HIGH_STABILITY' : cv <= 30 ? 'MEDIUM_STABILITY' : 'LOW_RELIABILITY';
  const lowTemp = runs[0].convictionScore;
  const highTemp = runs[runs.length - 1].convictionScore;
  let drift = 'stable';
  if (highTemp - lowTemp >= 15) drift = 'more bullish at higher temperature';
  if (highTemp - lowTemp <= -15) drift = 'more bearish / less trusting at higher temperature';

  const ladder = runs
    .map(run => `- T=${run.temperature.toFixed(2)} | ${run.direction} | score ${run.convictionScore >= 0 ? '+' : ''}${run.convictionScore}`)
    .join('\n');

  const uncertainties = runs
    .map(run => run.keyUncertainty)
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ');

  const summary = [
    `Beta Mode C | Mean conviction ${meanScore >= 0 ? '+' : ''}${meanScore.toFixed(1)} | CV ${cv.toFixed(1)} | ${stability}`,
    `Directional drift: ${drift}`,
    '',
    '**Temperature Ladder**',
    ladder,
    '',
    `**Interpretation** A low CV means the thesis survives perturbation away from default agreeableness. A high CV means the apparent conviction may be prompt-sensitive or sycophantic.`,
  ];

  if (uncertainties) {
    summary.push(`**Recurring Uncertainty** ${uncertainties}`);
  }

  return {
    title: 'Stress Test v2',
    description: summary.join('\n'),
  };
}

async function runVisionPipelineMode(request) {
  const prompt = `${HARSH_JUDGE_BLOCK}

Mode: D — Vision Pipeline + Contrarian Trap Detector.

You are a technical analyst and contrarian trap detector.

Requirements:
- Read the chart image if one is attached. If no image exists, say that the signal is text-only and lower confidence.
- Determine the technical bias, setup quality, key levels, and timing quality.
- Estimate trapProbabilityScore from 0 to 100.
- Set divergentSignal=true when the trap warning materially conflicts with the apparent thesis direction.
- Mention how the output affects Timing/Catalyst Specificity and Risk Identification.
- Be suspicious of consensus and look for trap structures, exhaustion, or poor entry timing.

Return JSON:
{
  "technicalBias": "bullish|bearish|neutral",
  "setupQuality": 0,
  "trapProbabilityScore": 0,
  "trapType": "bull trap|bear trap|no clear trap",
  "divergentSignal": false,
  "timingAssessment": "",
  "timingCatalystNote": "",
  "riskIdentificationNote": "",
  "keyLevels": ["", ""],
  "riskSignals": ["", ""],
  "tradePlan": "",
  "confidenceLabel": "LOW|MEDIUM|HIGH"
}`;

  const userContent = [{ type: 'text', text: buildContext(request) }];
  if (request.chartImageUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: request.chartImageUrl },
    });
  }

  const raw = await chatWithMessages([
    { role: 'system', content: prompt },
    { role: 'user', content: userContent },
  ], { maxTokens: 1400, temperature: 0.25 });

  const parsed = await parseJsonWithRepair(raw);
  const trapProbability = clampNumber(parsed.trapProbabilityScore, 0, 100, 0);
  const setupQuality = clampNumber(parsed.setupQuality, 0, 100, 0);
  const summary = [
    `Beta Mode D | ${parsed.technicalBias || 'neutral'} bias | Setup ${setupQuality}/100 | Trap probability ${trapProbability}/100`,
    `Trap type: ${parsed.trapType || 'no clear trap'} | Divergent signal ${parsed.divergentSignal ? 'YES' : 'NO'} | Confidence ${parsed.confidenceLabel || 'MEDIUM'}`,
    '',
    `**Timing** ${parsed.timingAssessment || 'No timing assessment returned.'}`,
    `**CTS Hooks** Timing/Catalyst: ${parsed.timingCatalystNote || 'No note.'}`,
    `**CTS Hooks** Risk Identification: ${parsed.riskIdentificationNote || 'No note.'}`,
  ];

  if (Array.isArray(parsed.keyLevels) && parsed.keyLevels.length) {
    summary.push(`**Key Levels** ${parsed.keyLevels.slice(0, 4).join(' | ')}`);
  }
  if (Array.isArray(parsed.riskSignals) && parsed.riskSignals.length) {
    summary.push(`**Risk Signals** ${parsed.riskSignals.slice(0, 4).join(' | ')}`);
  }
  if (parsed.tradePlan) {
    summary.push(`**Trade Plan** ${parsed.tradePlan}`);
  }
  if (!request.chartImageUrl) {
    summary.push('**Vision Status** No chart image was attached, so this read is text-only beta mode rather than full vision mode.');
  }

  return {
    title: 'Vision Pipeline v2',
    description: summary.join('\n'),
  };
}

module.exports = {
  runBullBearMode,
  runMultiValuationMode,
  runStressTestMode,
  runVisionPipelineMode,
};
