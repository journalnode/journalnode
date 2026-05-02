const { chat, chatWithMessages } = require('./openrouter');

const TEMPERATURE_LADDER = [0.2, 0.3, 0.45, 0.6, 0.7];

const HARSH_JUDGE_BLOCK = `You are scoring one crypto investment thesis using the Canonical Bullish/Bearish/Range Scoring Spec v2.0.1.

You are demanding, skeptical, and precise.
- A 70 means genuinely good.
- An 80+ means exceptional.
- A 90+ is rare and must survive skepticism review.
- Do not reward formatting more than substance.
- Do not confuse citation with verification.
- Do not hallucinate live verification when no live tool surface is present.
- Return only valid JSON with double-quoted keys and values where needed.`;

const DATA_GROUNDING_BLOCK = `DIMENSION 1 - DATA GROUNDING SCORING RULES:

1. For every quantified claim in the thesis, classify it as VERIFIABLE, PLAUSIBLE, PLAUSIBLE-SELFREPORTED, or UNVERIFIABLE.
2. UNVERIFIABLE claims receive zero credit toward Data Grounding.
3. PLAUSIBLE claims count at half weight.
4. PLAUSIBLE-SELFREPORTED claims count at quarter weight.
5. Cited sources are not automatically verified.`;

function buildContext(request) {
  const lines = [
    `Asset: ${request.asset}`,
    `Direction: ${request.direction || 'Not provided'}`,
    `Trade thesis: ${request.thesis}`,
  ];

  if (request.timeframe) lines.push(`Time horizon: ${request.timeframe}`);
  if (typeof request.rangeLower === 'number') lines.push(`Range lower bound: ${request.rangeLower}`);
  if (typeof request.rangeUpper === 'number') lines.push(`Range upper bound: ${request.rangeUpper}`);
  if (typeof request.currentPrice === 'number') lines.push(`Current price: ${request.currentPrice}`);
  if (typeof request.marketCap === 'number') lines.push(`Current market cap USD: ${request.marketCap}`);
  if (request.invalidation) lines.push(`Invalidation: ${request.invalidation}`);
  if (request.catalyst) lines.push(`Catalyst: ${request.catalyst}`);
  if (request.authorCounterCase) lines.push(`Author counter-case:\n${request.authorCounterCase}`);
  if (request.consensusBlock) lines.push(`Consensus block:\n${request.consensusBlock}`);
  if (request.supportingData) lines.push(`Supporting data / notes:\n${request.supportingData}`);
  if (request.chartImageUrl) lines.push('Chart image: attached separately for vision-capable analysis.');

  lines.push('This command does not provide a live verification tool surface to the model in-session.');
  lines.push('If a required fact is missing, say so explicitly and apply the relevant caps.');
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

function normalizeStringArray(value, limit = 4) {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean).slice(0, limit)
    : [];
}

function normalizeGroundingItems(value, limit = 8) {
  return Array.isArray(value)
    ? value
      .map(item => ({
        id: Number(item?.id) || null,
        claim: String(item?.claim || '').trim(),
        source: String(item?.source || '').trim() || 'Not provided',
        tier: String(item?.tier || '').trim().toUpperCase() || 'T4',
        loadBearing: Boolean(item?.loadBearing),
        classification: String(item?.classification || '').trim().toUpperCase() || 'UNVERIFIABLE',
      }))
      .filter(item => item.claim)
      .slice(0, limit)
    : [];
}

function normalizeVerificationRecords(value, limit = 8) {
  return Array.isArray(value)
    ? value
      .map(item => ({
        claimId: Number(item?.claimId) || null,
        claim: String(item?.claim || '').trim(),
        toolCalled: String(item?.toolCalled || '').trim() || 'none',
        sourceReturned: String(item?.sourceReturned || '').trim() || 'UNREACHED',
        tierReturned: String(item?.tierReturned || '').trim().toUpperCase() || 'UNREACHED',
        timestamp: String(item?.timestamp || '').trim() || 'unknown',
        match: Boolean(item?.match),
        qualified: Boolean(item?.qualified),
      }))
      .slice(0, limit)
    : [];
}

function normalizeCounterCase(value, limit = 6) {
  return Array.isArray(value)
    ? value
      .map(item => ({
        text: String(item?.text || item || '').trim(),
        strongest: Boolean(item?.strongest),
      }))
      .filter(item => item.text)
      .slice(0, limit)
    : [];
}

function normalizeDimensionScores(value = {}) {
  return {
    dataGrounding: clampNumber(value.dataGrounding, 0, 20, 0),
    thesisCoherence: clampNumber(value.thesisCoherence, 0, 20, 0),
    counterThesis: clampNumber(value.counterThesis, 0, 20, 0),
    riskIdentification: clampNumber(value.riskIdentification, 0, 20, 0),
    consensusEngagement: clampNumber(value.consensusEngagement, 0, 20, 0),
    timingCatalyst: clampNumber(value.timingCatalyst, 0, 20, 0),
    catalystSubscore: clampNumber(value.catalystSubscore, 0, 10, 0),
    whyNotPricedInSubscore: clampNumber(value.whyNotPricedInSubscore, 0, 10, 0),
  };
}

function normalizeTextMap(value = {}) {
  return {
    dataGrounding: String(value.dataGrounding || '').trim() || 'No note.',
    thesisCoherence: String(value.thesisCoherence || '').trim() || 'No note.',
    counterThesis: String(value.counterThesis || '').trim() || 'No note.',
    riskIdentification: String(value.riskIdentification || '').trim() || 'No note.',
    consensusEngagement: String(value.consensusEngagement || '').trim() || 'No note.',
    timingCatalyst: String(value.timingCatalyst || '').trim() || 'No note.',
  };
}

function normalizeStringList(value, limit = 6) {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean).slice(0, limit)
    : [];
}

function formatRangeBounds(request) {
  if (request.direction !== 'RANGE') return 'n/a';
  const lower = typeof request.rangeLower === 'number' ? request.rangeLower : 'missing';
  const upper = typeof request.rangeUpper === 'number' ? request.rangeUpper : 'missing';
  return `${lower} / ${upper}`;
}

function clipInline(value, max = 90) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function buildBullBearGistMarkdown({ request, analysis }) {
  const lines = [
    '## Bullish/Bearish/Range Thesis Score Report (v2.0.1)',
    '',
    `**Asset:** ${request.asset}`,
    `**Direction:** ${request.direction || 'Not provided'}`,
    `**Range Bounds:** ${formatRangeBounds(request)}`,
    `**Timeframe:** ${request.timeframe || 'Not provided'}`,
    `**Command Validity:** ${analysis.commandValidity}`,
    '',
    '### 1. Thesis Summary',
    analysis.thesisSummary,
    '',
    '### 2. Quantified Claim Classification',
    '| # | Claim | Source | Tier | Load-Bearing? | Label |',
    '|---|-------|--------|------|---------------|-------|',
  ];

  if (analysis.claimTable.length) {
    for (const item of analysis.claimTable) {
      lines.push(`| ${item.id ?? ''} | ${item.claim} | ${item.source} | ${item.tier} | ${item.loadBearing ? 'yes' : 'no'} | ${item.classification} |`);
    }
  } else {
    lines.push('| - | None extracted | - | - | - | - |');
  }

  lines.push(
    '',
    '### 3. Verification Records',
    '| # | Claim | Tool Called | Source Returned | Tier | Timestamp | Match? | Qualified? |',
    '|---|-------|-------------|-----------------|------|-----------|--------|------------|',
  );

  if (analysis.verificationRecords.length) {
    for (const item of analysis.verificationRecords) {
      lines.push(`| ${item.claimId ?? ''} | ${item.claim || ''} | ${item.toolCalled} | ${item.sourceReturned} | ${item.tierReturned} | ${item.timestamp} | ${item.match ? 'yes' : 'no'} | ${item.qualified ? 'yes' : 'no'} |`);
    }
  } else {
    lines.push('| - | No live verification records | none | UNREACHED | UNREACHED | unknown | no | no |');
  }

  lines.push('', '### 4. Judge-Generated Counter-Case');
  if (analysis.counterCase.length) {
    for (const item of analysis.counterCase) lines.push(`- ${item.strongest ? '*' : ''}${item.text}`);
  } else {
    lines.push('- No counter-case returned.');
  }

  lines.push(
    '',
    '### 5. Dimension Scores',
    '| Dimension | Score / 20 | Key Reason |',
    '|-----------|------------|------------|',
    `| Data Grounding | ${analysis.dimensionScores.dataGrounding} | ${analysis.keyReasons.dataGrounding} |`,
    `| Thesis Coherence (edge: ${analysis.edgeClass}) | ${analysis.dimensionScores.thesisCoherence} | ${analysis.keyReasons.thesisCoherence} |`,
    `| Counter-Thesis Coverage | ${analysis.dimensionScores.counterThesis} | ${analysis.keyReasons.counterThesis} |`,
    `| Risk Identification | ${analysis.dimensionScores.riskIdentification} | ${analysis.keyReasons.riskIdentification} |`,
    `| Consensus Engagement | ${analysis.dimensionScores.consensusEngagement} | ${analysis.keyReasons.consensusEngagement} |`,
    `| Timing & Catalyst (catalyst ${analysis.dimensionScores.catalystSubscore}/10 + why-not-priced-in ${analysis.dimensionScores.whyNotPricedInSubscore}/10) | ${analysis.dimensionScores.timingCatalyst} | ${analysis.keyReasons.timingCatalyst} |`,
    '',
    '### 6. Deduction Log',
    `- Data Grounding: ${analysis.deductionLog.dataGrounding}`,
    `- Thesis Coherence: ${analysis.deductionLog.thesisCoherence}`,
    `- Counter-Thesis Coverage: ${analysis.deductionLog.counterThesis}`,
    `- Risk Identification: ${analysis.deductionLog.riskIdentification}`,
    `- Consensus Engagement: ${analysis.deductionLog.consensusEngagement}`,
    `- Timing & Catalyst: ${analysis.deductionLog.timingCatalyst}`,
    '',
    '### 7. Caps Applied',
    `- Individual: ${analysis.capsApplied.individual}`,
    `- Global floor (missing structural elements: ${analysis.missingStructuralElements.length}): ${analysis.capsApplied.globalFloor}`,
    '',
    '### 8. Composite',
    `- BB_raw: ${analysis.composite.bbRaw} / 120`,
    `- BB_score: ${analysis.composite.bbScore} / 100`,
    `- Classification: ${analysis.composite.classification}`,
    '',
    '### 9. Skepticism Review (if applicable)',
    `- Triggered: ${analysis.skepticismReview.triggered ? 'yes' : 'no'}`,
    `- Adversarial summary: ${analysis.skepticismReview.adversarialSummary}`,
    `- Re-scored composite: ${analysis.skepticismReview.rescoredComposite}`,
    `- Final composite: ${analysis.skepticismReview.finalComposite}`,
    '',
    '### 10. Verdict',
    analysis.verdict,
    '',
    '### 11. Highest-Impact Fixes',
  );

  if (analysis.highestImpactFixes.length) {
    analysis.highestImpactFixes.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));
  } else {
    lines.push('1. No fixes returned.');
  }

  lines.push('', '### 12. Exceptional-Score Justifications (if any 18+)');
  if (analysis.exceptionalJustifications.length) {
    for (const item of analysis.exceptionalJustifications) lines.push(`- ${item}`);
  } else {
    lines.push('- None.');
  }

  lines.push(
    '',
    '### 13. Calibration Log Reference',
    `- thesis_id: ${analysis.calibrationLog.thesisId}`,
    `- settlement target date: ${analysis.calibrationLog.settlementTargetDate}`,
    `- VR-qualified ratio: ${analysis.calibrationLog.vrQualifiedRatio}`,
    '',
    '## Metadata',
    `- Generated: ${analysis.generatedAt}`,
    `- Asset: ${request.asset}`,
    `- Mode: Bullish/Bearish v2.0.1`,
    `- Time Horizon: ${request.timeframe || 'Not provided'}`,
    `- Current Price: ${typeof request.currentPrice === 'number' ? request.currentPrice : 'Not provided'}`,
    `- Market Cap: ${typeof request.marketCap === 'number' ? request.marketCap : 'Not provided'}`,
    '',
    '## Submitted Thesis',
    request.thesis,
  );

  if (request.supportingData) lines.push('', '## Supporting Data', request.supportingData);
  return lines.join('\n').trim();
}

async function runBullBearMode(request) {
  const prompt = `${HARSH_JUDGE_BLOCK}

Score the thesis as a single demanding judge under the fixed v2.0.1 process.

Important command constraint:
- No live verification tools are available to you in this session.
- You may classify stable historical facts as VERIFIABLE only when they are older than 6 months and high-confidence.
- Otherwise, any post-cutoff or current-market claim without a qualified live Verification Record must not be marked VERIFIABLE.
- Because no live verification tool surface exists here, you should normally apply the verification-related data-grounding caps when load-bearing claims depend on current data.

Return JSON with this exact shape:
{
  "commandValidity": "VALID|INPUT_INVALID",
  "missingFields": [""],
  "thesisSummary": "",
  "claimTable": [
    {"id":1,"claim":"","source":"","tier":"T0|T1|T2|T3|T4","loadBearing":true,"classification":"VERIFIABLE|PLAUSIBLE|PLAUSIBLE-SELFREPORTED|UNVERIFIABLE"}
  ],
  "verificationRecords": [
    {"claimId":1,"claim":"","toolCalled":"none","sourceReturned":"UNREACHED","tierReturned":"UNREACHED|T0|T1|T2|T3|T4","timestamp":"unknown","match":false,"qualified":false}
  ],
  "counterCase": [
    {"text":"","strongest":true}
  ],
  "dimensionScores": {
    "dataGrounding": 0,
    "thesisCoherence": 0,
    "counterThesis": 0,
    "riskIdentification": 0,
    "consensusEngagement": 0,
    "timingCatalyst": 0,
    "catalystSubscore": 0,
    "whyNotPricedInSubscore": 0
  },
  "edgeClass": "DIFFERENTIATED|CONVENTIONAL|RESTATEMENT|STALE",
  "keyReasons": {
    "dataGrounding": "",
    "thesisCoherence": "",
    "counterThesis": "",
    "riskIdentification": "",
    "consensusEngagement": "",
    "timingCatalyst": ""
  },
  "deductionLog": {
    "dataGrounding": "",
    "thesisCoherence": "",
    "counterThesis": "",
    "riskIdentification": "",
    "consensusEngagement": "",
    "timingCatalyst": ""
  },
  "capsApplied": {
    "individual": "",
    "globalFloor": ""
  },
  "missingStructuralElements": [""],
  "composite": {
    "bbRaw": 0,
    "bbScore": 0,
    "classification": "Exceptional|Strong|Competent|Developing|Weak|Unacceptable"
  },
  "skepticismReview": {
    "triggered": false,
    "adversarialSummary": "",
    "rescoredComposite": "n/a",
    "finalComposite": "n/a"
  },
  "verdict": "",
  "highestImpactFixes": ["", "", ""],
  "exceptionalJustifications": [""],
  "calibrationLog": {
    "thesisId": "",
    "settlementTargetDate": "",
    "vrQualifiedRatio": ""
  }
}`;

  const raw = await chat(prompt, buildContext(request), { maxTokens: 2200, temperature: 0.25 });
  const parsed = await parseJsonWithRepair(raw);
  const commandValidity = String(parsed.commandValidity || 'INPUT_INVALID').trim().toUpperCase();
  const claimTable = normalizeGroundingItems(parsed.claimTable);
  const verificationRecords = normalizeVerificationRecords(parsed.verificationRecords);
  const counterCase = normalizeCounterCase(parsed.counterCase);
  const dimensionScores = normalizeDimensionScores(parsed.dimensionScores);
  const keyReasons = normalizeTextMap(parsed.keyReasons);
  const deductionLog = normalizeTextMap(parsed.deductionLog);
  const missingStructuralElements = normalizeStringList(parsed.missingStructuralElements, 8);
  const highestImpactFixes = normalizeStringList(parsed.highestImpactFixes, 3);
  const exceptionalJustifications = normalizeStringList(parsed.exceptionalJustifications, 4);
  const bbRaw = clampNumber(parsed?.composite?.bbRaw, 0, 120, 0);
  const bbScore = clampNumber(parsed?.composite?.bbScore, 0, 100, Math.round((bbRaw / 120) * 100));
  const classification = String(parsed?.composite?.classification || 'Unacceptable').trim() || 'Unacceptable';
  const generatedAt = new Date().toISOString();
  const skepticismReview = {
    triggered: Boolean(parsed?.skepticismReview?.triggered),
    adversarialSummary: String(parsed?.skepticismReview?.adversarialSummary || '').trim() || 'n/a',
    rescoredComposite: String(parsed?.skepticismReview?.rescoredComposite ?? 'n/a'),
    finalComposite: String(parsed?.skepticismReview?.finalComposite ?? bbScore),
  };
  const capsApplied = {
    individual: String(parsed?.capsApplied?.individual || '').trim() || 'None stated.',
    globalFloor: String(parsed?.capsApplied?.globalFloor || '').trim() || 'None stated.',
  };
  const calibrationLog = {
    thesisId: String(parsed?.calibrationLog?.thesisId || '').trim() || 'n/a',
    settlementTargetDate: String(parsed?.calibrationLog?.settlementTargetDate || '').trim() || 'n/a',
    vrQualifiedRatio: String(parsed?.calibrationLog?.vrQualifiedRatio || '').trim() || '0 / 0',
  };
  const thesisSummary = String(parsed.thesisSummary || '').trim() || 'No thesis summary returned.';
  const verdict = String(parsed.verdict || '').trim() || 'No verdict returned.';
  const strongestCounter = counterCase.find(item => item.strongest)?.text || counterCase[0]?.text || 'No counter-case returned.';
  const oneLineSummary = `${request.asset}: ${bbScore}/100 ${classification} | ${request.direction || 'UNKNOWN'} | strongest counter: ${clipInline(strongestCounter)}`;

  const summary = [
    `Bull/Bear v2.0.1 | ${request.direction || 'UNKNOWN'} | ${bbScore}/100 ${classification}`,
    `Data ${dimensionScores.dataGrounding}/20 | Coherence ${dimensionScores.thesisCoherence}/20 | Counter ${dimensionScores.counterThesis}/20 | Risk ${dimensionScores.riskIdentification}/20 | Consensus ${dimensionScores.consensusEngagement}/20 | Timing ${dimensionScores.timingCatalyst}/20`,
    '',
    `**Validity** ${commandValidity}`,
    `**Summary** ${thesisSummary}`,
    `**Verdict** ${verdict}`,
    `**Strongest Counter** ${strongestCounter}`,
    `**Caps** ${capsApplied.individual}`,
  ];

  if (highestImpactFixes.length) summary.push(`**Top Fixes** ${highestImpactFixes.join(' | ')}`);

  const analysis = {
    generatedAt,
    commandValidity,
    thesisSummary,
    claimTable,
    verificationRecords,
    counterCase,
    dimensionScores,
    edgeClass: String(parsed.edgeClass || 'CONVENTIONAL').trim().toUpperCase(),
    keyReasons,
    deductionLog,
    capsApplied,
    missingStructuralElements,
    composite: {
      bbRaw,
      bbScore,
      classification,
    },
    skepticismReview,
    verdict,
    highestImpactFixes,
    exceptionalJustifications,
    calibrationLog,
  };
  const gistMarkdown = buildBullBearGistMarkdown({ request, analysis });

  return {
    title: 'Bullish/Bearish v2.0.1',
    description: summary.join('\n'),
    analysis,
    gist: {
      markdown: gistMarkdown,
      oneLineSummary,
    },
  };
}

async function runMultiValuationMode(request) {
  const prompt = `${HARSH_JUDGE_BLOCK}

Mode: B - Peer-Anchored Multi-Valuation.

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

Mode: C - Stochastic Stress Test.

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
    '**Interpretation** A low CV means the thesis survives perturbation away from default agreeableness. A high CV means the apparent conviction may be prompt-sensitive or sycophantic.',
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

Mode: D - Vision Pipeline + Contrarian Trap Detector.

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
