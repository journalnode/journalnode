const { StringSelectMenuBuilder, ActionRowBuilder, AttachmentBuilder } = require('discord.js');
const { callModel } = require('../openrouter');
const { MODELS, getModelById, getVisionModels } = require('../models');

// Pending interactions waiting for model selection
const pendingAnalysis = new Map();

// ─── Chart helpers via QuickChart.io ───

async function fetchChart(config) {
  const url = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(config))}&w=600&h=400&bkg=white`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`QuickChart failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function pieChart(title, bullishCount, bearishCount) {
  return {
    type: 'pie',
    data: {
      labels: [`Bullish (${bullishCount})`, `Bearish (${bearishCount})`],
      datasets: [{ data: [bullishCount, bearishCount], backgroundColor: ['#22c55e', '#ef4444'] }],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      plugins: { datalabels: { color: '#fff', font: { size: 14, weight: 'bold' }, formatter: (v, ctx) => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); return Math.round(v / total * 100) + '%'; } } },
    },
  };
}

function barChart(title, labels, values, yLabel) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: yLabel || 'Estimate', data: values, backgroundColor: '#6366f1' }],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      scales: { yAxes: [{ ticks: { beginAtZero: false } }] },
      plugins: { datalabels: { anchor: 'end', align: 'top', font: { size: 10 } } },
    },
  };
}

function barChartWithStats(title, labels, values, mean, median) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Estimate', data: values, backgroundColor: '#6366f1' }],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      scales: { yAxes: [{ ticks: { beginAtZero: false } }] },
      annotation: {
        annotations: [
          { type: 'line', mode: 'horizontal', scaleID: 'y-axis-0', value: mean, borderColor: '#f59e0b', borderWidth: 2, label: { enabled: true, content: `Mean: ${formatNum(mean)}`, position: 'left' } },
          { type: 'line', mode: 'horizontal', scaleID: 'y-axis-0', value: median, borderColor: '#06b6d4', borderWidth: 2, label: { enabled: true, content: `Median: ${formatNum(median)}`, position: 'right' } },
        ],
      },
    },
  };
}

function longShortBar(title, labels, longs, shorts) {
  return {
    type: 'bar',
    data: {
      labels: ['Long', 'Short'],
      datasets: [{ data: [longs, shorts], backgroundColor: ['#22c55e', '#ef4444'] }],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      scales: { yAxes: [{ ticks: { beginAtZero: true, stepSize: 1 } }] },
      plugins: { datalabels: { font: { size: 14, weight: 'bold' } } },
    },
  };
}

function formatNum(n) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

function parseNumber(text) {
  // Extract a number from LLM response — handles $1.5T, $500B, $10M, etc.
  const cleaned = text.replace(/,/g, '');
  const trillionMatch = cleaned.match(/\$?([\d.]+)\s*[Tt](?:rillion)?/);
  if (trillionMatch) return parseFloat(trillionMatch[1]) * 1e12;
  const billionMatch = cleaned.match(/\$?([\d.]+)\s*[Bb](?:illion)?/);
  if (billionMatch) return parseFloat(billionMatch[1]) * 1e9;
  const millionMatch = cleaned.match(/\$?([\d.]+)\s*[Mm](?:illion)?/);
  if (millionMatch) return parseFloat(millionMatch[1]) * 1e6;
  const numMatch = cleaned.match(/\$?([\d.]+)/);
  if (numMatch) return parseFloat(numMatch[1]);
  return null;
}

function parseSentiment(text) {
  const lower = text.toLowerCase();
  if (lower.includes('bullish')) return 'bullish';
  if (lower.includes('bearish')) return 'bearish';
  return null;
}

function parseDirection(text) {
  const lower = text.toLowerCase();
  if (lower.includes('long')) return 'long';
  if (lower.includes('short')) return 'short';
  return null;
}

// ─── Prompts ───

function bullishPrompt(asset, horizon) {
  return `You are a financial analyst. The user wants to know if you are bullish or bearish on "${asset}" over the next ${horizon}. Consider fundamentals, market conditions, sentiment, and technical factors. You MUST respond with EXACTLY one word on the first line: either "BULLISH" or "BEARISH". Then on the next line, give a one-sentence explanation.`;
}

function valuationPrompt(asset, targetTime) {
  return `You are a financial analyst. Estimate the total market capitalization of "${asset}" by ${targetTime}. Consider growth trends, adoption, competitive landscape, and macro factors. You MUST respond with EXACTLY one value on the first line in this format: $X.XXT or $X.XXB or $X.XXM (e.g. "$2.5T" or "$750B"). Then on the next line, give a one-sentence explanation.`;
}

function technicalPrompt(timeframe) {
  return `You are a technical analyst. The user has provided a candlestick chart on the ${timeframe} timeframe. Based solely on the price action, chart patterns, support/resistance, indicators, and market structure visible in the chart, give your trading recommendation. You MUST respond with EXACTLY one word on the first line: either "LONG" or "SHORT". Then on the next line, give a one-sentence explanation of the key technical factors.`;
}

// ─── Model select menu builder ───

function buildModelSelectMenu(customId, maxValues, visionOnly) {
  const modelList = visionOnly ? getVisionModels() : MODELS;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(`Select up to ${maxValues} model(s)`)
    .setMinValues(1)
    .setMaxValues(maxValues)
    .addOptions(modelList.map(m => ({
      label: m.name,
      value: m.id,
      description: m.id,
    })));
  return new ActionRowBuilder().addComponents(menu);
}

// ─── Mode handlers ───

async function runBullish(interaction, asset, horizon) {
  await interaction.editReply(`Querying all ${MODELS.length} models on **${asset}** (${horizon})... this may take a moment.`);

  const systemPrompt = bullishPrompt(asset, horizon);
  const userMsg = `Asset: ${asset}\nTime horizon: ${horizon}\n\nAre you bullish or bearish?`;

  const results = await Promise.allSettled(
    MODELS.map(async (model) => {
      const response = await callModel(model.id, systemPrompt, userMsg, { maxTokens: 200 });
      const sentiment = parseSentiment(response);
      return { model: model.name, modelId: model.id, sentiment, response: response.slice(0, 150) };
    })
  );

  let bullish = 0, bearish = 0;
  const details = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.sentiment) {
      if (r.value.sentiment === 'bullish') bullish++;
      else bearish++;
      details.push(r.value);
    } else if (r.status === 'fulfilled') {
      details.push({ ...r.value, sentiment: 'unclear' });
    } else {
      details.push({ model: 'Unknown', sentiment: 'error', response: r.reason?.message || 'Failed' });
    }
  }

  const chartBuf = await fetchChart(pieChart(`${asset} — Bullish vs Bearish (${horizon})`, bullish, bearish));
  const file = new AttachmentBuilder(chartBuf, { name: 'sentiment.png' });

  const lines = [
    `**━━━ BULLISH OR BEARISH ━━━**`,
    `**Asset:** ${asset} | **Horizon:** ${horizon}`,
    `**Result:** ${bullish} Bullish / ${bearish} Bearish / ${details.length - bullish - bearish} Unclear`,
    '',
  ];

  for (const d of details) {
    const emoji = d.sentiment === 'bullish' ? '🟢' : d.sentiment === 'bearish' ? '🔴' : '⚪';
    lines.push(`${emoji} **${d.model}:** ${d.response.split('\n').slice(0, 2).join(' ').slice(0, 100)}`);
  }

  const text = lines.join('\n').slice(0, 1900);
  await interaction.editReply({ content: text, files: [file] });
}

async function runMultiVal(interaction, asset, target, modelIds) {
  await interaction.editReply(`Querying ${modelIds.length} models for **${asset}** valuation by **${target}**...`);

  const systemPrompt = valuationPrompt(asset, target);
  const userMsg = `Asset: ${asset}\nTarget: ${target}\n\nWhat is your market cap estimate?`;

  const results = await Promise.allSettled(
    modelIds.map(async (id) => {
      const model = getModelById(id);
      const response = await callModel(id, systemPrompt, userMsg, { maxTokens: 200 });
      const value = parseNumber(response);
      return { model: model?.name || id, value, response: response.slice(0, 150) };
    })
  );

  const labels = [], values = [], details = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.value) {
      labels.push(r.value.model);
      values.push(r.value.value);
      details.push(r.value);
    } else if (r.status === 'fulfilled') {
      details.push({ ...r.value, value: null });
    }
  }

  const chartBuf = await fetchChart(barChart(`${asset} Market Cap Estimates — ${target}`, labels, values, 'Market Cap'));
  const file = new AttachmentBuilder(chartBuf, { name: 'multival.png' });

  const lines = [
    `**━━━ MULTI-VALUATION ━━━**`,
    `**Asset:** ${asset} | **Target:** ${target}`,
    '',
  ];

  for (const d of details) {
    lines.push(`**${d.model}:** ${d.value ? formatNum(d.value) : 'N/A'} — ${d.response.split('\n').slice(1).join(' ').slice(0, 80)}`);
  }

  const text = lines.join('\n').slice(0, 1900);
  await interaction.editReply({ content: text, files: [file] });
}

async function runSoloVal(interaction, asset, target, modelId, runs) {
  const model = getModelById(modelId);
  const modelName = model?.name || modelId;
  await interaction.editReply(`Running ${runs} valuation(s) with **${modelName}** for **${asset}** by **${target}**...`);

  const systemPrompt = valuationPrompt(asset, target);
  const userMsg = `Asset: ${asset}\nTarget: ${target}\n\nWhat is your market cap estimate?`;

  const results = await Promise.allSettled(
    Array.from({ length: runs }, (_, i) =>
      callModel(modelId, systemPrompt, userMsg, { maxTokens: 200 })
    )
  );

  const labels = [], values = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      const val = parseNumber(results[i].value);
      if (val) {
        labels.push(`Run ${i + 1}`);
        values.push(val);
      }
    }
  }

  if (values.length === 0) {
    await interaction.editReply(`No valid estimates returned from ${modelName}. Please try again.`);
    return;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  const chartBuf = await fetchChart(barChartWithStats(`${asset} — ${modelName} (${runs} runs) — ${target}`, labels, values, mean, median));
  const file = new AttachmentBuilder(chartBuf, { name: 'soloval.png' });

  const lines = [
    `**━━━ SOLO-VALUATION ━━━**`,
    `**Asset:** ${asset} | **Target:** ${target} | **Model:** ${modelName}`,
    `**Runs:** ${values.length} | **Mean:** ${formatNum(mean)} | **Median:** ${formatNum(median)}`,
    '',
  ];
  values.forEach((v, i) => lines.push(`Run ${i + 1}: ${formatNum(v)}`));

  const text = lines.join('\n').slice(0, 1900);
  await interaction.editReply({ content: text, files: [file] });
}

async function runTechnical(interaction, timeframe, imageUrl, modelIds) {
  await interaction.editReply(`Querying ${modelIds.length} models for technical analysis (${timeframe})...`);

  const systemPrompt = technicalPrompt(timeframe);
  const userMsg = `Timeframe: ${timeframe}\n\nAnalyze this chart and give your LONG or SHORT recommendation.`;

  const results = await Promise.allSettled(
    modelIds.map(async (id) => {
      const model = getModelById(id);
      const response = await callModel(id, systemPrompt, userMsg, { imageUrl, maxTokens: 200 });
      const direction = parseDirection(response);
      return { model: model?.name || id, direction, response: response.slice(0, 150) };
    })
  );

  let longs = 0, shorts = 0;
  const details = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.direction) {
      if (r.value.direction === 'long') longs++;
      else shorts++;
      details.push(r.value);
    } else if (r.status === 'fulfilled') {
      details.push({ ...r.value, direction: 'unclear' });
    } else {
      details.push({ model: 'Unknown', direction: 'error', response: r.reason?.message || 'Failed' });
    }
  }

  const chartBuf = await fetchChart(longShortBar(`Technical Analysis — ${timeframe}`, [], longs, shorts));
  const file = new AttachmentBuilder(chartBuf, { name: 'technical.png' });

  const lines = [
    `**━━━ TECHNICAL ANALYST ━━━**`,
    `**Timeframe:** ${timeframe}`,
    `**Result:** ${longs} Long / ${shorts} Short / ${details.length - longs - shorts} Unclear`,
    '',
  ];

  for (const d of details) {
    const emoji = d.direction === 'long' ? '🟢' : d.direction === 'short' ? '🔴' : '⚪';
    lines.push(`${emoji} **${d.model}:** ${d.response.split('\n').slice(0, 2).join(' ').slice(0, 100)}`);
  }

  const text = lines.join('\n').slice(0, 1900);
  await interaction.editReply({ content: text, files: [file] });
}

// ─── Main command ───

module.exports = {
  name: 'analyze',
  description: 'LLM-powered market analysis — bullish/bearish, valuations, and technical analysis.',
  needsEntries: false,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'bullish') {
      const asset = interaction.options.getString('asset');
      const horizon = interaction.options.getString('horizon');
      await runBullish(interaction, asset, horizon);

    } else if (sub === 'soloval') {
      const asset = interaction.options.getString('asset');
      const target = interaction.options.getString('target');
      const modelId = interaction.options.getString('model');
      const runs = interaction.options.getInteger('runs') || 3;
      await runSoloVal(interaction, asset, target, modelId, runs);

    } else if (sub === 'multival') {
      const asset = interaction.options.getString('asset');
      const target = interaction.options.getString('target');
      // Store context, show model picker
      pendingAnalysis.set(interaction.user.id, { mode: 'multival', asset, target, interactionToken: interaction.token, channelId: interaction.channelId });
      const row = buildModelSelectMenu('analyze_model_select', 8, false);
      await interaction.editReply({ content: `Select up to 8 models for **${asset}** valuation by **${target}**:`, components: [row] });

    } else if (sub === 'technical') {
      const timeframe = interaction.options.getString('timeframe');
      const screenshot = interaction.options.getAttachment('screenshot');
      if (!screenshot || !screenshot.contentType?.startsWith('image/')) {
        await interaction.editReply('Please attach a chart screenshot (image file).');
        return;
      }
      pendingAnalysis.set(interaction.user.id, { mode: 'technical', timeframe, imageUrl: screenshot.url, interactionToken: interaction.token, channelId: interaction.channelId });
      const row = buildModelSelectMenu('analyze_model_select', 8, true);
      await interaction.editReply({ content: `Select up to 8 models for technical analysis (${timeframe}):`, components: [row] });
    }
  },

  // Handle model selection from StringSelectMenu
  async handleSelectMenu(interaction) {
    const userId = interaction.user.id;
    const pending = pendingAnalysis.get(userId);
    if (!pending) {
      await interaction.reply({ content: 'No pending analysis found. Please run `/analyze` again.', flags: 64 });
      return;
    }
    pendingAnalysis.delete(userId);

    const selectedModels = interaction.values;
    // Acknowledge and defer — this will be a new reply since the select menu is a component interaction
    await interaction.deferUpdate();

    if (pending.mode === 'multival') {
      await runMultiVal(interaction, pending.asset, pending.target, selectedModels);
    } else if (pending.mode === 'technical') {
      await runTechnical(interaction, pending.timeframe, pending.imageUrl, selectedModels);
    }
  },

  pendingAnalysis,
};
