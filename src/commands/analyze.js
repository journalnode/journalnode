const { StringSelectMenuBuilder, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { callModel } = require('../openrouter');
const { MODELS, getModelById, getVisionModels } = require('../models');

const pendingAnalysis = new Map();

// ─── Chart helpers via QuickChart.io ───

async function fetchChart(config, opts = {}) {
  const { width = 600, height = 400, bkg = 'white' } = opts;
  const url = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(config))}&w=${width}&h=${height}&bkg=${encodeURIComponent(bkg)}`;
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
      plugins: { datalabels: { color: '#fff', font: { size: 14, weight: 'bold' }, formatter: (v, ctx) => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); return total === 0 ? '' : Math.round(v / total * 100) + '%'; } } },
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

function longShortBar(title, longs, shorts) {
  return {
    type: 'bar',
    data: {
      labels: ['Long', 'Short'],
      datasets: [{ data: [longs, shorts], backgroundColor: ['#22c55e', '#ef4444'] }],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      legend: { display: false },
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

function bullishPrompt(assetDescription, horizon) {
  return `You are a financial analyst evaluating an investment pitch. Here is the user's description of the asset:\n\n"${assetDescription}"\n\nOver the next ${horizon}, are you bullish or bearish? Consider the pitch's merits, fundamentals, market conditions, and risks. You MUST respond with EXACTLY one word on the first line: either "BULLISH" or "BEARISH". Then on the next line, give a one-sentence explanation.`;
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

// ─── Helper: extract explanation from LLM response ───

function extractExplanation(response) {
  return response.split('\n').filter(l => l.trim()).slice(1).join(' ').slice(0, 80);
}

// ─── Mode: Bullish or Bearish — all 18 models, progressive embed ───

async function runBullish(interaction, assetDescription, horizon) {
  const systemPrompt = bullishPrompt(assetDescription, horizon);
  const userMsg = `${assetDescription}\n\nTime horizon: ${horizon}\n\nAre you bullish or bearish?`;

  const details = [];
  let bullishCount = 0, bearishCount = 0;

  const buildEmbed = (complete = false) => {
    const responded = details.length;
    const unclear = responded - bullishCount - bearishCount;
    const embed = new EmbedBuilder()
      .setTitle('Bullish or Bearish — Results')
      .setColor(0x9b59b6);

    let desc = `**User Query:** ${assetDescription.slice(0, 200)}${assetDescription.length > 200 ? '...' : ''}\n`;
    desc += `**Horizon:** ${horizon}\n`;

    if (complete) {
      desc += `**Result:** ${bullishCount} Bullish / ${bearishCount} Bearish${unclear > 0 ? ` / ${unclear} Unclear` : ''}\n`;
    } else {
      desc += `**Progress:** ${responded}/${MODELS.length} models responded...\n`;
    }
    desc += '\n';

    for (const d of details) {
      const emoji = d.sentiment === 'bullish' ? '🟢' : d.sentiment === 'bearish' ? '🔴' : '⚪';
      desc += `${emoji} **${d.model}:** ${d.sentiment.toUpperCase()}\n`;
    }

    embed.setDescription(desc.slice(0, 4090));
    return embed;
  };

  // Show initial loading embed
  await interaction.editReply({ embeds: [buildEmbed()], components: [] });

  // Fire all model calls
  const promises = MODELS.map(async (model) => {
    try {
      const response = await callModel(model.id, systemPrompt, userMsg, { maxTokens: 200 });
      const sentiment = parseSentiment(response);
      if (sentiment === 'bullish') bullishCount++;
      else if (sentiment === 'bearish') bearishCount++;
      details.push({ model: model.name, sentiment: sentiment || 'unclear', explanation: extractExplanation(response) });
    } catch (err) {
      details.push({ model: model.name, sentiment: 'error', explanation: '' });
    }
  });

  // Progress update loop — edit embed every 3 seconds as results stream in
  const allDone = Promise.all(promises);
  let prevCount = 0;
  while (true) {
    const done = await Promise.race([
      allDone.then(() => true),
      new Promise(r => setTimeout(() => r(false), 3000)),
    ]);
    if (details.length > prevCount) {
      prevCount = details.length;
      await interaction.editReply({ embeds: [buildEmbed()] }).catch(() => {});
    }
    if (done) break;
  }

  // Final update with chart
  const chartBuf = await fetchChart(pieChart('Bullish vs Bearish', bullishCount, bearishCount));
  const file = new AttachmentBuilder(chartBuf, { name: 'sentiment.png' });
  const finalEmbed = buildEmbed(true);
  finalEmbed.setImage('attachment://sentiment.png');
  await interaction.editReply({ embeds: [finalEmbed], files: [file] });
}

// ─── Mode: Multi-Valuation — up to 8 models, progressive embed ───

async function runMultiVal(interaction, asset, target, modelIds) {
  const systemPrompt = valuationPrompt(asset, target);
  const userMsg = `Asset: ${asset}\nTarget: ${target}\n\nWhat is your market cap estimate?`;

  const details = [];

  const buildEmbed = (complete = false) => {
    const embed = new EmbedBuilder()
      .setTitle('Multi-Valuation — Results')
      .setColor(0x6366f1);

    let desc = `**Asset:** ${asset}\n**Target:** ${target}\n`;

    if (complete) {
      const validValues = details.filter(d => d.value).map(d => d.value);
      if (validValues.length > 0) {
        const avg = validValues.reduce((a, b) => a + b, 0) / validValues.length;
        desc += `**Avg Estimate:** ${formatNum(avg)} (${details.filter(d => d.value).length} models)\n`;
      }
    } else {
      desc += `**Progress:** ${details.length}/${modelIds.length} models responded...\n`;
    }
    desc += '\n';

    for (const d of details) {
      desc += `📊 **${d.model}:** ${d.value ? formatNum(d.value) : 'N/A'}${d.explanation ? '  ' + d.explanation : ''}\n`;
    }

    embed.setDescription(desc.slice(0, 4090));
    return embed;
  };

  await interaction.editReply({ embeds: [buildEmbed()], components: [] });

  const promises = modelIds.map(async (id) => {
    const model = getModelById(id);
    try {
      const response = await callModel(id, systemPrompt, userMsg, { maxTokens: 200 });
      const value = parseNumber(response);
      details.push({ model: model?.name || id, value, explanation: extractExplanation(response) });
    } catch (err) {
      details.push({ model: model?.name || id, value: null, explanation: '' });
    }
  });

  const allDone = Promise.all(promises);
  let prevCount = 0;
  while (true) {
    const done = await Promise.race([
      allDone.then(() => true),
      new Promise(r => setTimeout(() => r(false), 3000)),
    ]);
    if (details.length > prevCount) {
      prevCount = details.length;
      await interaction.editReply({ embeds: [buildEmbed()] }).catch(() => {});
    }
    if (done) break;
  }

  const labels = [], values = [];
  for (const d of details) {
    if (d.value) { labels.push(d.model); values.push(d.value); }
  }

  const chartBuf = await fetchChart(barChart(`Market Cap Estimates — ${target}`, labels, values, 'Market Cap'));
  const file = new AttachmentBuilder(chartBuf, { name: 'multival.png' });
  const finalEmbed = buildEmbed(true);
  finalEmbed.setImage('attachment://multival.png');
  await interaction.editReply({ embeds: [finalEmbed], files: [file] });
}

// ─── Mode: Solo-Valuation — 1 model, N runs, progressive embed ───

async function runSoloVal(interaction, asset, target, modelId, runs) {
  const model = getModelById(modelId);
  const modelName = model?.name || modelId;
  const systemPrompt = valuationPrompt(asset, target);
  const userMsg = `Asset: ${asset}\nTarget: ${target}\n\nWhat is your market cap estimate?`;

  const runResults = [];

  const buildEmbed = (complete = false, mean = 0, median = 0) => {
    const embed = new EmbedBuilder()
      .setTitle('Solo-Valuation — Results')
      .setColor(0x6366f1);

    let desc = `**Asset:** ${asset}\n**Target:** ${target}\n**Model:** ${modelName}\n`;

    if (complete && runResults.length > 0) {
      desc += `**Mean:** ${formatNum(mean)} | **Median:** ${formatNum(median)}\n`;
    } else {
      desc += `**Progress:** ${runResults.length}/${runs} runs completed...\n`;
    }
    desc += '\n';

    runResults.forEach((v, i) => {
      desc += `Run ${i + 1}: ${v ? formatNum(v) : 'N/A'}\n`;
    });

    embed.setDescription(desc.slice(0, 4090));
    return embed;
  };

  await interaction.editReply({ embeds: [buildEmbed()], components: [] });

  const promises = Array.from({ length: runs }, async (_, i) => {
    try {
      const response = await callModel(modelId, systemPrompt, userMsg, { maxTokens: 200 });
      const val = parseNumber(response);
      runResults.push(val);
    } catch (err) {
      runResults.push(null);
    }
  });

  const allDone = Promise.all(promises);
  let prevCount = 0;
  while (true) {
    const done = await Promise.race([
      allDone.then(() => true),
      new Promise(r => setTimeout(() => r(false), 2000)),
    ]);
    if (runResults.length > prevCount) {
      prevCount = runResults.length;
      await interaction.editReply({ embeds: [buildEmbed()] }).catch(() => {});
    }
    if (done) break;
  }

  const values = runResults.filter(v => v !== null);
  if (values.length === 0) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('Solo-Valuation — Results')
      .setColor(0xef4444)
      .setDescription(`No valid estimates returned from **${modelName}**. Please try again.`);
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const labels = values.map((_, i) => `Run ${i + 1}`);
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  const chartBuf = await fetchChart(barChartWithStats(`${modelName} — ${runs} runs — ${target}`, labels, values, mean, median));
  const file = new AttachmentBuilder(chartBuf, { name: 'soloval.png' });
  const finalEmbed = buildEmbed(true, mean, median);
  finalEmbed.setImage('attachment://soloval.png');
  await interaction.editReply({ embeds: [finalEmbed], files: [file] });
}

function technicalBreakdownChart(title, details, longCount, shortCount) {
  const validDetails = details.filter(d => d.direction === 'long' || d.direction === 'short');
  const names = validDetails.map(d => d.model);
  const data = validDetails.map(d => d.direction === 'long' ? 1 : -1);
  const colors = validDetails.map(d => d.direction === 'long' ? '#22c55e' : '#ef4444');

  return {
    type: 'horizontalBar',
    data: {
      labels: names,
      datasets: [{
        data,
        backgroundColor: colors,
      }],
    },
    options: {
      title: { display: true, text: `${title}  |  Long: ${longCount}  Short: ${shortCount}`, fontSize: 14 },
      legend: { display: false },
      scales: {
        xAxes: [{ display: false, ticks: { min: -1.5, max: 1.5 } }],
        yAxes: [{ ticks: { fontSize: 11 } }],
      },
    },
  };
}

// ─── Combined dual-chart image for Technical Analyst ───

async function buildCombinedTechnicalChart(timeframe, details, longCount, shortCount) {
  const sharp = require('sharp');

  // Left chart: Consensus vertical bar (Long vs Short counts)
  const consensusConfig = {
    type: 'bar',
    data: {
      labels: ['LONG', 'SHORT'],
      datasets: [{ data: [longCount, shortCount], backgroundColor: ['#22c55e', '#ef4444'] }],
    },
    options: {
      title: { display: true, text: 'Consensus', fontSize: 16, fontColor: '#ffffff' },
      legend: { display: false },
      scales: {
        yAxes: [{
          scaleLabel: { display: true, labelString: 'Number of Models', fontColor: '#aaaaaa' },
          ticks: { beginAtZero: true, stepSize: 1, fontColor: '#cccccc' },
          gridLines: { color: '#333333' },
        }],
        xAxes: [{ ticks: { fontColor: '#cccccc' }, gridLines: { color: '#333333' } }],
      },
      plugins: { datalabels: { color: '#ffffff', font: { size: 16, weight: 'bold' }, anchor: 'end', align: 'top' } },
    },
  };

  // Right chart: Model Breakdown horizontal bar (per-model Long/Short)
  const validDetails = details.filter(d => d.direction === 'long' || d.direction === 'short');
  const breakdownConfig = {
    type: 'horizontalBar',
    data: {
      labels: validDetails.map(d => d.model),
      datasets: [{
        data: validDetails.map(d => d.direction === 'long' ? 1 : -1),
        backgroundColor: validDetails.map(d => d.direction === 'long' ? '#22c55e' : '#ef4444'),
      }],
    },
    options: {
      title: { display: true, text: 'Model Breakdown', fontSize: 16, fontColor: '#ffffff' },
      legend: { display: false },
      scales: {
        xAxes: [{ display: false, ticks: { min: -1.5, max: 1.5 } }],
        yAxes: [{ ticks: { fontSize: 11, fontColor: '#cccccc' }, gridLines: { color: '#333333' } }],
      },
    },
  };

  const chartW = 430, chartH = 350;
  const [leftBuf, rightBuf] = await Promise.all([
    fetchChart(consensusConfig, { width: chartW, height: chartH, bkg: '#000000' }),
    fetchChart(breakdownConfig, { width: chartW + 40, height: chartH, bkg: '#000000' }),
  ]);

  const totalW = chartW + chartW + 40;
  const titleH = 45;
  const totalH = titleH + chartH;

  // Title via SVG overlay
  const safeTimeframe = timeframe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const titleSvg = Buffer.from(
    `<svg width="${totalW}" height="${titleH}">` +
    `<text x="${totalW / 2}" y="32" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="white" text-anchor="middle">Technical Analysis: ${safeTimeframe}</text>` +
    `</svg>`
  );

  const combined = await sharp({
    create: { width: totalW, height: totalH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([
      { input: titleSvg, top: 0, left: 0 },
      { input: leftBuf, top: titleH, left: 0 },
      { input: rightBuf, top: titleH, left: chartW },
    ])
    .png()
    .toBuffer();

  return combined;
}

// ─── Mode: Technical Analyst — vision models, progressive embed ───

async function runTechnical(interaction, timeframe, imageUrl, modelIds) {
  const systemPrompt = technicalPrompt(timeframe);
  const userMsg = `Timeframe: ${timeframe}\n\nAnalyze this chart and give your LONG or SHORT recommendation.`;

  const details = [];
  let longCount = 0, shortCount = 0;

  const buildEmbed = (complete = false) => {
    const responded = details.length;
    const noResponse = responded - longCount - shortCount;

    const embed = new EmbedBuilder()
      .setTitle(`Technical Analyst — ${timeframe} Chart`)
      .setColor(0xef4444);

    let desc = '';

    if (complete) {
      const total = longCount + shortCount;
      const longPct = total > 0 ? Math.round(longCount / total * 100) : 0;
      const shortPct = total > 0 ? Math.round(shortCount / total * 100) : 0;

      desc += '**Consensus**\n';
      desc += `**LONG:** ${longCount} models (${longPct}%)\n`;
      desc += `**SHORT:** ${shortCount} models (${shortPct}%)\n`;
      if (noResponse > 0) desc += `**No Response:** ${noResponse}\n`;
      desc += '\n';

      const longModels = details.filter(d => d.direction === 'long').map(d => d.model);
      const shortModels = details.filter(d => d.direction === 'short').map(d => d.model);
      if (longModels.length > 0) desc += `**LONG (${longModels.length})**\n${longModels.join(', ')}\n\n`;
      if (shortModels.length > 0) desc += `**SHORT (${shortModels.length})**\n${shortModels.join(', ')}\n`;
    } else {
      desc += `**Progress:** ${responded}/${modelIds.length} models responded...\n\n`;
      for (const d of details) {
        const emoji = d.direction === 'long' ? '🟢' : d.direction === 'short' ? '🔴' : '⚪';
        desc += `${emoji} **${d.model}:** ${d.direction.toUpperCase()}\n`;
      }
    }

    embed.setDescription(desc.slice(0, 4090));
    return embed;
  };

  await interaction.editReply({ embeds: [buildEmbed()], components: [] });

  const promises = modelIds.map(async (id) => {
    const model = getModelById(id);
    try {
      const response = await callModel(id, systemPrompt, userMsg, { imageUrl, maxTokens: 200 });
      const direction = parseDirection(response);
      if (direction === 'long') longCount++;
      else if (direction === 'short') shortCount++;
      details.push({ model: model?.name || id, direction: direction || 'unclear' });
    } catch (err) {
      details.push({ model: model?.name || id, direction: 'error' });
    }
  });

  const allDone = Promise.all(promises);
  let prevCount = 0;
  while (true) {
    const done = await Promise.race([
      allDone.then(() => true),
      new Promise(r => setTimeout(() => r(false), 3000)),
    ]);
    if (details.length > prevCount) {
      prevCount = details.length;
      await interaction.editReply({ embeds: [buildEmbed()] }).catch(() => {});
    }
    if (done) break;
  }

  // Final embed — no chart embedded
  const finalEmbed = buildEmbed(true);
  await interaction.editReply({ embeds: [finalEmbed] });

  // Send combined dual-chart image as a separate followUp
  const combinedBuf = await buildCombinedTechnicalChart(timeframe, details, longCount, shortCount);
  const file = new AttachmentBuilder(combinedBuf, { name: 'technical.png' });
  await interaction.followUp({ files: [file] });
}

// ─── Main command ───

module.exports = {
  name: 'llmanalyze',
  description: 'LLM-powered market analysis — bullish/bearish, valuations, and technical analysis.',
  needsEntries: false,

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('LLM Market Analyzer')
      .setDescription(
        'Pick a mode:\n\n' +
        '**A) Bullish or Bearish** — Pitch an asset to all 18 models. Pie chart.\n' +
        '**B) Multi-Valuation** — Pick up to 8 models for market cap estimates. Bar chart.\n' +
        '**C) Solo-Valuation** — Run 1 model up to 5 times to test consistency. Bar chart.\n' +
        '**D) Technical Analyst** — Vision models analyze your chart screenshot. Long/Short.'
      );

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('llma_bullish').setLabel('A) Bullish or Bearish').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('llma_multival').setLabel('B) Multi-Valuation').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('llma_soloval').setLabel('C) Solo-Valuation').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('llma_technical').setLabel('D) Technical Analyst').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('llma_info').setLabel('?').setStyle(ButtonStyle.Primary),
    );

    await interaction.editReply({ embeds: [embed], components: [row1] });
  },

  // Handle button clicks
  async handleButton(interaction) {
    const id = interaction.customId;

    if (id === 'llma_info') {
      const modelList = MODELS.map((m, i) => `${i + 1}. **${m.name}** — \`${m.id}\`${m.vision ? ' 👁' : ''}`).join('\n');
      await interaction.reply({
        content: `**18 Models queried by LLM Analyzer:**\n\n${modelList}\n\n👁 = supports vision/image analysis`,
        flags: 64,
      });
      return;
    }

    if (id === 'llma_bullish') {
      const modal = new ModalBuilder()
        .setCustomId('llma_bullish_modal')
        .setTitle('Bullish or Bearish')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('asset')
              .setLabel('Describe the asset briefly')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('e.g. Ethereum is a smart contract platform with growing DeFi adoption...')
              .setRequired(true)
              .setMaxLength(500)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('horizon')
              .setLabel('Time horizon (e.g. 3 months, EOY 2026)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
        );
      await interaction.showModal(modal);

    } else if (id === 'llma_multival') {
      const modal = new ModalBuilder()
        .setCustomId('llma_multival_modal')
        .setTitle('Multi-Valuation')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('asset').setLabel('Asset (e.g. BTC, ETH, AAPL)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('target').setLabel('Target (e.g. Q3 2026, EOY 2027)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
        );
      await interaction.showModal(modal);

    } else if (id === 'llma_soloval') {
      const modal = new ModalBuilder()
        .setCustomId('llma_soloval_modal')
        .setTitle('Solo-Valuation')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('asset').setLabel('Asset (e.g. BTC, ETH, AAPL)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('target').setLabel('Target (e.g. Q3 2026, EOY 2027)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('runs').setLabel('Number of runs (1-5, default 3)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('3')
          ),
        );
      await interaction.showModal(modal);

    } else if (id === 'llma_technical') {
      // Show vision model select — screenshot will be uploaded later in channel
      pendingAnalysis.set(interaction.user.id, { mode: 'technical_select' });
      const row = buildModelSelectMenu('llmanalyze_model_select', 8, true);
      await interaction.reply({ content: 'Technical Analyst — Select up to 8 vision-capable models:', components: [row], flags: 64 });
    }
  },

  // Handle modal submissions
  async handleModalSubmit(interaction) {
    const id = interaction.customId;

    if (id === 'llma_bullish_modal') {
      const asset = interaction.fields.getTextInputValue('asset');
      const horizon = interaction.fields.getTextInputValue('horizon');
      await interaction.deferReply();
      await runBullish(interaction, asset, horizon);

    } else if (id === 'llma_multival_modal') {
      const asset = interaction.fields.getTextInputValue('asset');
      const target = interaction.fields.getTextInputValue('target');
      const existing = pendingAnalysis.get(interaction.user.id) || {};
      pendingAnalysis.set(interaction.user.id, { ...existing, mode: 'multival', asset, target });
      await interaction.deferReply();
      const row = buildModelSelectMenu('llmanalyze_model_select', 8, false);
      await interaction.editReply({ content: `Select up to 8 models for **${asset}** valuation by **${target}**:`, components: [row] });

    } else if (id === 'llma_soloval_modal') {
      const asset = interaction.fields.getTextInputValue('asset');
      const target = interaction.fields.getTextInputValue('target');
      const runsStr = interaction.fields.getTextInputValue('runs');
      const runs = Math.min(5, Math.max(1, parseInt(runsStr) || 3));
      const existing = pendingAnalysis.get(interaction.user.id) || {};
      pendingAnalysis.set(interaction.user.id, { ...existing, mode: 'soloval', asset, target, runs });
      await interaction.deferReply();
      const row = buildModelSelectMenu('llmanalyze_model_select', 1, false);
      await interaction.editReply({ content: `Select a model for **${asset}** solo-valuation (${runs} runs) by **${target}**:`, components: [row] });

    } else if (id === 'llma_technical_modal') {
      const timeframe = interaction.fields.getTextInputValue('timeframe');
      const existing = pendingAnalysis.get(interaction.user.id);
      if (!existing?.models) {
        await interaction.reply({ content: 'No model selection found. Please try `/llmanalyze` again.', flags: 64 });
        return;
      }
      const models = existing.models;
      const modelNames = models.map(mid => getModelById(mid)?.name || mid).join(', ');
      pendingAnalysis.delete(interaction.user.id);

      await interaction.deferReply();

      const waitEmbed = new EmbedBuilder()
        .setTitle('Technical Analyst')
        .setColor(0xef4444)
        .setDescription(
          `**Timeframe:** ${timeframe}\n` +
          `**Models:** ${modelNames}\n\n` +
          'Please upload your candlestick chart image now.\n' +
          'Send it as a message in this channel within 60 seconds.'
        );
      await interaction.editReply({ embeds: [waitEmbed] });

      // Wait for user to post an image in the channel
      const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId);
      const filter = (msg) => msg.author.id === interaction.user.id && msg.attachments.some(a => a.contentType?.startsWith('image/'));

      try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const imageUrl = collected.first().attachments.filter(a => a.contentType?.startsWith('image/')).first().url;
        await runTechnical(interaction, timeframe, imageUrl, models);
      } catch (err) {
        const timeoutEmbed = new EmbedBuilder()
          .setTitle('Technical Analyst')
          .setColor(0xef4444)
          .setDescription('No chart image received within 60 seconds. Please try `/llmanalyze` again.');
        await interaction.editReply({ embeds: [timeoutEmbed] });
      }
    }
  },

  // Handle model selection from StringSelectMenu
  async handleSelectMenu(interaction) {
    const userId = interaction.user.id;
    const pending = pendingAnalysis.get(userId);
    if (!pending) {
      await interaction.reply({ content: 'No pending analysis found. Please run `/llmanalyze` again.', flags: 64 });
      return;
    }

    const selectedModels = interaction.values;

    // Technical flow: show timeframe modal (don't defer — modals must be immediate)
    if (pending.mode === 'technical_select') {
      pendingAnalysis.set(userId, { ...pending, mode: 'technical_ready', models: selectedModels });
      const modal = new ModalBuilder()
        .setCustomId('llma_technical_modal')
        .setTitle('Technical Analyst')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('timeframe').setLabel('Chart timeframe (e.g. 4H, Daily, 1W)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
        );
      await interaction.showModal(modal);
      return;
    }

    // Other modes: defer and process
    pendingAnalysis.delete(userId);
    await interaction.deferUpdate();

    if (pending.mode === 'multival') {
      await runMultiVal(interaction, pending.asset, pending.target, selectedModels);
    } else if (pending.mode === 'soloval') {
      await runSoloVal(interaction, pending.asset, pending.target, selectedModels[0], pending.runs);
    }
  },

  pendingAnalysis,
};
