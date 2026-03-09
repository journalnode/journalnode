const { StringSelectMenuBuilder, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { callModel } = require('../openrouter');
const { MODELS, getModelById } = require('../models');
const analyze = require('./analyze');

const {
  collectPayment,
  fetchChart,
  pieChart,
  barChart,
  formatNum,
  formatPrice,
  parseNumber,
  parsePrice,
  parseBothValues,
  parseOutputType,
  outputTypeLabel,
  parseSentiment,
  extractExplanation,
  buildModelSelectMenu,
  valuationPrompt,
  bullishPrompt,
  LLM_FEE_PFT,
} = analyze;

const pendingCompare = new Map();

// ─── Compare-specific chart helpers ───

function groupedBarChart(title, labels, values1, values2, label1, label2, yLabel) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: label1, data: values1, backgroundColor: '#6366f1' },
        { label: label2, data: values2, backgroundColor: '#f97316' },
      ],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      legend: { labels: { fontSize: 12 } },
      scales: { yAxes: [{ ticks: { beginAtZero: false }, scaleLabel: { display: !!yLabel, labelString: yLabel || '' } }] },
      plugins: { datalabels: { anchor: 'end', align: 'top', font: { size: 9 } } },
    },
  };
}

async function buildComparePieChart(asset1Label, bull1, bear1, asset2Label, bull2, bear2) {
  const sharp = require('sharp');

  const leftConfig = pieChart(asset1Label, bull1, bear1);
  const rightConfig = pieChart(asset2Label, bull2, bear2);

  const chartW = 450, chartH = 350;
  const [leftRaw, rightRaw] = await Promise.all([
    fetchChart(leftConfig, { width: chartW, height: chartH }),
    fetchChart(rightConfig, { width: chartW, height: chartH }),
  ]);

  const leftBuf = await sharp(leftRaw).resize(chartW, chartH).png().toBuffer();
  const rightBuf = await sharp(rightRaw).resize(chartW, chartH).png().toBuffer();

  const totalW = chartW * 2;
  const titleH = 45;
  const totalH = titleH + chartH;

  const safeA1 = asset1Label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeA2 = asset2Label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const titleSvg = Buffer.from(
    `<svg width="${totalW}" height="${titleH}">` +
    `<rect width="${totalW}" height="${titleH}" fill="white"/>` +
    `<text x="${totalW / 2}" y="32" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="black" text-anchor="middle">Compare: ${safeA1} vs ${safeA2}</text>` +
    `</svg>`
  );

  return sharp({
    create: { width: totalW, height: totalH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([
      { input: titleSvg, top: 0, left: 0 },
      { input: leftBuf, top: titleH, left: 0 },
      { input: rightBuf, top: titleH, left: chartW },
    ])
    .png()
    .toBuffer();
}

// ─── Helpers ───

function truncLabel(s, max = 30) {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function calcStats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  return { mean, median };
}

function buildUserMsg(asset, target, outputType) {
  if (outputType === 'both') return `Asset/Pitch: ${asset}\nTarget: ${target}\n\nProvide your market cap AND price target estimates.`;
  if (outputType === 'price') return `Asset/Pitch: ${asset}\nTarget: ${target}\n\nWhat is your price target estimate?`;
  return `Asset/Pitch: ${asset}\nTarget: ${target}\n\nWhat is your market cap estimate?`;
}

function parseResponse(response, outputType) {
  if (outputType === 'both') return parseBothValues(response);
  if (outputType === 'price') return { mcap: null, price: parsePrice(response) };
  return { mcap: parseNumber(response), price: null };
}

function fmtVal(d, outputType) {
  if (outputType === 'both') {
    const parts = [];
    if (d.mcap) parts.push(`MCap: ${formatNum(d.mcap)}`);
    if (d.price) parts.push(`Price: ${formatPrice(d.price)}`);
    return parts.length > 0 ? parts.join(' | ') : 'N/A';
  }
  if (outputType === 'price') return d.price ? formatPrice(d.price) : 'N/A';
  return d.mcap ? formatNum(d.mcap) : 'N/A';
}

// ─── Run: Compare Bullish/Bearish ───

async function runCompareBullish(interaction, asset1, asset2, horizon, paymentTx) {
  const details1 = [], details2 = [];
  let bull1 = 0, bear1 = 0, bull2 = 0, bear2 = 0;

  const a1 = truncLabel(asset1);
  const a2 = truncLabel(asset2);

  const buildEmbed = (complete = false) => {
    const embed = new EmbedBuilder()
      .setTitle('Compare — Bullish or Bearish')
      .setColor(0x9b59b6);

    let desc = `**Asset 1:** ${a1}\n**Asset 2:** ${a2}\n**Horizon:** ${horizon}\n`;
    if (paymentTx) desc += `**Payment:** [View TX](${paymentTx.txUrl}) (${LLM_FEE_PFT} PFT)\n`;
    desc += '\n';

    if (complete) {
      const total1 = bull1 + bear1;
      const total2 = bull2 + bear2;
      const pct1 = total1 > 0 ? Math.round(bull1 / total1 * 100) : 0;
      const pct2 = total2 > 0 ? Math.round(bull2 / total2 * 100) : 0;

      desc += `**${a1}:** ${bull1} Bullish / ${bear1} Bearish (${pct1}% bullish)\n`;
      desc += `**${a2}:** ${bull2} Bullish / ${bear2} Bearish (${pct2}% bullish)\n\n`;

      if (pct1 > pct2) desc += `**Verdict:** Models favor **${a1}** (${pct1}% vs ${pct2}% bullish)`;
      else if (pct2 > pct1) desc += `**Verdict:** Models favor **${a2}** (${pct2}% vs ${pct1}% bullish)`;
      else desc += `**Verdict:** Models are split evenly between both assets (${pct1}% bullish each)`;
    } else {
      desc += `**${a1}:** ${details1.length}/${MODELS.length} responded — ${bull1}B / ${bear1}Be\n`;
      desc += `**${a2}:** ${details2.length}/${MODELS.length} responded — ${bull2}B / ${bear2}Be\n`;
    }

    embed.setDescription(desc.slice(0, 4090));
    return embed;
  };

  await interaction.editReply({ embeds: [buildEmbed()], components: [] });

  const promises = MODELS.flatMap(model => [
    (async () => {
      try {
        const sys = bullishPrompt(asset1, horizon);
        const msg = `${asset1}\n\nTime horizon: ${horizon}\n\nAre you bullish or bearish?`;
        const response = await callModel(model.id, sys, msg, { maxTokens: 200 });
        const sentiment = parseSentiment(response);
        if (sentiment === 'bullish') bull1++;
        else if (sentiment === 'bearish') bear1++;
        details1.push({ model: model.name, sentiment: sentiment || 'unclear' });
      } catch {
        details1.push({ model: model.name, sentiment: 'error' });
      }
    })(),
    (async () => {
      try {
        const sys = bullishPrompt(asset2, horizon);
        const msg = `${asset2}\n\nTime horizon: ${horizon}\n\nAre you bullish or bearish?`;
        const response = await callModel(model.id, sys, msg, { maxTokens: 200 });
        const sentiment = parseSentiment(response);
        if (sentiment === 'bullish') bull2++;
        else if (sentiment === 'bearish') bear2++;
        details2.push({ model: model.name, sentiment: sentiment || 'unclear' });
      } catch {
        details2.push({ model: model.name, sentiment: 'error' });
      }
    })(),
  ]);

  const allDone = Promise.all(promises);
  let prevTotal = 0;
  while (true) {
    const done = await Promise.race([
      allDone.then(() => true),
      new Promise(r => setTimeout(() => r(false), 3000)),
    ]);
    const total = details1.length + details2.length;
    if (total > prevTotal) {
      prevTotal = total;
      await interaction.editReply({ embeds: [buildEmbed()] }).catch(() => {});
    }
    if (done) break;
  }

  // Generate merged pie chart
  try {
    const chartBuf = await buildComparePieChart(a1, bull1, bear1, a2, bull2, bear2);
    const file = new AttachmentBuilder(chartBuf, { name: 'compare.png' });
    const finalEmbed = buildEmbed(true);
    finalEmbed.setImage('attachment://compare.png');
    await interaction.editReply({ embeds: [finalEmbed], files: [file] });
  } catch (chartErr) {
    console.error('[compare] Pie chart error:', chartErr);
    await interaction.editReply({ embeds: [buildEmbed(true)] });
  }
}

// ─── Run: Compare Multi-Valuation ───

async function runCompareMultiVal(interaction, asset1, asset2, target, modelIds, paymentTx, outputType = 'mcap') {
  const details1 = [], details2 = [];
  const a1 = truncLabel(asset1);
  const a2 = truncLabel(asset2);

  const buildEmbed = (complete = false) => {
    const embed = new EmbedBuilder()
      .setTitle('Compare — Multi-Valuation')
      .setColor(0x6366f1);

    let desc = `**Asset 1:** ${a1}\n**Asset 2:** ${a2}\n**Target:** ${target}\n**Output:** ${outputTypeLabel(outputType)}\n`;
    if (paymentTx) desc += `**Payment:** [View TX](${paymentTx.txUrl}) (${LLM_FEE_PFT} PFT)\n`;
    desc += '\n';

    if (complete) {
      if (outputType === 'mcap' || outputType === 'both') {
        const m1 = details1.filter(d => d.mcap).map(d => d.mcap);
        const m2 = details2.filter(d => d.mcap).map(d => d.mcap);
        if (m1.length > 0) desc += `**${a1} Avg MCap:** ${formatNum(m1.reduce((a, b) => a + b, 0) / m1.length)}\n`;
        if (m2.length > 0) desc += `**${a2} Avg MCap:** ${formatNum(m2.reduce((a, b) => a + b, 0) / m2.length)}\n`;
      }
      if (outputType === 'price' || outputType === 'both') {
        const p1 = details1.filter(d => d.price).map(d => d.price);
        const p2 = details2.filter(d => d.price).map(d => d.price);
        if (p1.length > 0) desc += `**${a1} Avg Price:** ${formatPrice(p1.reduce((a, b) => a + b, 0) / p1.length)}\n`;
        if (p2.length > 0) desc += `**${a2} Avg Price:** ${formatPrice(p2.reduce((a, b) => a + b, 0) / p2.length)}\n`;
      }
      desc += '\n';
    } else {
      desc += `**Progress:** ${a1} ${details1.length}/${modelIds.length} | ${a2} ${details2.length}/${modelIds.length}\n\n`;
    }

    // Per-model breakdown
    for (const id of modelIds) {
      const model = getModelById(id);
      const name = model?.name || id;
      const d1 = details1.find(d => d.model === name);
      const d2 = details2.find(d => d.model === name);
      if (d1 || d2) {
        desc += `📊 **${name}:** ${d1 ? fmtVal(d1, outputType) : '⏳'} vs ${d2 ? fmtVal(d2, outputType) : '⏳'}\n`;
      }
    }

    embed.setDescription(desc.slice(0, 4090));
    return embed;
  };

  await interaction.editReply({ embeds: [buildEmbed()], components: [] });

  const promises = modelIds.flatMap(id => {
    const model = getModelById(id);
    const name = model?.name || id;
    return [
      (async () => {
        try {
          const sys = valuationPrompt(asset1, target, outputType);
          const response = await callModel(id, sys, buildUserMsg(asset1, target, outputType), { maxTokens: 300 });
          const parsed = parseResponse(response, outputType);
          details1.push({ model: name, ...parsed, explanation: extractExplanation(response) });
        } catch {
          details1.push({ model: name, mcap: null, price: null, explanation: '' });
        }
      })(),
      (async () => {
        try {
          const sys = valuationPrompt(asset2, target, outputType);
          const response = await callModel(id, sys, buildUserMsg(asset2, target, outputType), { maxTokens: 300 });
          const parsed = parseResponse(response, outputType);
          details2.push({ model: name, ...parsed, explanation: extractExplanation(response) });
        } catch {
          details2.push({ model: name, mcap: null, price: null, explanation: '' });
        }
      })(),
    ];
  });

  const allDone = Promise.all(promises);
  let prevTotal = 0;
  while (true) {
    const done = await Promise.race([
      allDone.then(() => true),
      new Promise(r => setTimeout(() => r(false), 3000)),
    ]);
    const total = details1.length + details2.length;
    if (total > prevTotal) {
      prevTotal = total;
      await interaction.editReply({ embeds: [buildEmbed()] }).catch(() => {});
    }
    if (done) break;
  }

  // Generate grouped bar chart(s)
  const files = [];
  const finalEmbed = buildEmbed(true);

  if (outputType === 'mcap' || outputType === 'both') {
    const labels = [], vals1 = [], vals2 = [];
    for (const id of modelIds) {
      const model = getModelById(id);
      const name = model?.name || id;
      const d1 = details1.find(d => d.model === name);
      const d2 = details2.find(d => d.model === name);
      if (d1?.mcap || d2?.mcap) {
        labels.push(name);
        vals1.push(d1?.mcap || 0);
        vals2.push(d2?.mcap || 0);
      }
    }
    if (labels.length > 0) {
      const config = groupedBarChart(`Market Cap Compare — ${target}`, labels, vals1, vals2, a1, a2, 'Market Cap');
      const chartBuf = await fetchChart(config, { width: 700, height: 400 });
      files.push(new AttachmentBuilder(chartBuf, { name: 'mcap_compare.png' }));
      finalEmbed.setImage('attachment://mcap_compare.png');
    }
  }

  if (outputType === 'price' || outputType === 'both') {
    const labels = [], vals1 = [], vals2 = [];
    for (const id of modelIds) {
      const model = getModelById(id);
      const name = model?.name || id;
      const d1 = details1.find(d => d.model === name);
      const d2 = details2.find(d => d.model === name);
      if (d1?.price || d2?.price) {
        labels.push(name);
        vals1.push(d1?.price || 0);
        vals2.push(d2?.price || 0);
      }
    }
    if (labels.length > 0) {
      const config = groupedBarChart(`Price Target Compare — ${target}`, labels, vals1, vals2, a1, a2, 'Price');
      const chartBuf = await fetchChart(config, { width: 700, height: 400 });
      files.push(new AttachmentBuilder(chartBuf, { name: 'price_compare.png' }));
      if (outputType === 'price') finalEmbed.setImage('attachment://price_compare.png');
    }
  }

  await interaction.editReply({ embeds: [finalEmbed], files });

  if (outputType === 'both' && files.length > 1) {
    await interaction.followUp({ files: [files[1]] }).catch(() => {});
  }
}

// ─── Run: Compare Solo-Valuation ───

async function runCompareSoloVal(interaction, asset1, asset2, target, modelId, runs, paymentTx, outputType = 'mcap') {
  const model = getModelById(modelId);
  const modelName = model?.name || modelId;
  const a1 = truncLabel(asset1);
  const a2 = truncLabel(asset2);

  const results1 = [], results2 = [];

  const buildEmbed = (complete = false, stats = null) => {
    const embed = new EmbedBuilder()
      .setTitle('Compare — Solo-Valuation')
      .setColor(0x6366f1);

    let desc = `**Asset 1:** ${a1}\n**Asset 2:** ${a2}\n**Target:** ${target}\n**Model:** ${modelName}\n**Output:** ${outputTypeLabel(outputType)}\n`;
    if (paymentTx) desc += `**Payment:** [View TX](${paymentTx.txUrl}) (${LLM_FEE_PFT} PFT)\n`;
    desc += '\n';

    if (complete && stats) {
      if (stats.mcap1) desc += `**${a1} MCap:** Mean ${formatNum(stats.mcap1.mean)} | Median ${formatNum(stats.mcap1.median)}\n`;
      if (stats.mcap2) desc += `**${a2} MCap:** Mean ${formatNum(stats.mcap2.mean)} | Median ${formatNum(stats.mcap2.median)}\n`;
      if (stats.price1) desc += `**${a1} Price:** Mean ${formatPrice(stats.price1.mean)} | Median ${formatPrice(stats.price1.median)}\n`;
      if (stats.price2) desc += `**${a2} Price:** Mean ${formatPrice(stats.price2.mean)} | Median ${formatPrice(stats.price2.median)}\n`;
    } else {
      desc += `**Progress:** ${a1} ${results1.length}/${runs} | ${a2} ${results2.length}/${runs}\n`;
    }
    desc += '\n';

    for (let i = 0; i < runs; i++) {
      const r1 = results1[i];
      const r2 = results2[i];
      const fmt = (r) => {
        if (!r) return '⏳';
        return fmtVal(r, outputType);
      };
      desc += `Run ${i + 1}: ${fmt(r1)} vs ${fmt(r2)}\n`;
    }

    embed.setDescription(desc.slice(0, 4090));
    return embed;
  };

  await interaction.editReply({ embeds: [buildEmbed()], components: [] });

  const promises = Array.from({ length: runs }, () => [
    (async () => {
      try {
        const sys = valuationPrompt(asset1, target, outputType);
        const response = await callModel(modelId, sys, buildUserMsg(asset1, target, outputType), { maxTokens: 300 });
        results1.push(parseResponse(response, outputType));
      } catch {
        results1.push({ mcap: null, price: null });
      }
    })(),
    (async () => {
      try {
        const sys = valuationPrompt(asset2, target, outputType);
        const response = await callModel(modelId, sys, buildUserMsg(asset2, target, outputType), { maxTokens: 300 });
        results2.push(parseResponse(response, outputType));
      } catch {
        results2.push({ mcap: null, price: null });
      }
    })(),
  ]).flat();

  const allDone = Promise.all(promises);
  let prevTotal = 0;
  while (true) {
    const done = await Promise.race([
      allDone.then(() => true),
      new Promise(r => setTimeout(() => r(false), 2000)),
    ]);
    const total = results1.length + results2.length;
    if (total > prevTotal) {
      prevTotal = total;
      await interaction.editReply({ embeds: [buildEmbed()] }).catch(() => {});
    }
    if (done) break;
  }

  const mcapVals1 = results1.map(r => r.mcap).filter(v => v !== null);
  const mcapVals2 = results2.map(r => r.mcap).filter(v => v !== null);
  const priceVals1 = results1.map(r => r.price).filter(v => v !== null);
  const priceVals2 = results2.map(r => r.price).filter(v => v !== null);

  const stats = {
    mcap1: mcapVals1.length > 0 ? calcStats(mcapVals1) : null,
    mcap2: mcapVals2.length > 0 ? calcStats(mcapVals2) : null,
    price1: priceVals1.length > 0 ? calcStats(priceVals1) : null,
    price2: priceVals2.length > 0 ? calcStats(priceVals2) : null,
  };

  const files = [];
  const finalEmbed = buildEmbed(true, stats);

  if (outputType === 'mcap' || outputType === 'both') {
    if (mcapVals1.length > 0 || mcapVals2.length > 0) {
      const maxLen = Math.max(mcapVals1.length, mcapVals2.length);
      const labels = Array.from({ length: maxLen }, (_, i) => `Run ${i + 1}`);
      const v1 = labels.map((_, i) => mcapVals1[i] || 0);
      const v2 = labels.map((_, i) => mcapVals2[i] || 0);
      const config = groupedBarChart(`${modelName} — MCap Compare — ${target}`, labels, v1, v2, a1, a2, 'Market Cap');
      const chartBuf = await fetchChart(config, { width: 700, height: 400 });
      files.push(new AttachmentBuilder(chartBuf, { name: 'mcap_compare.png' }));
      finalEmbed.setImage('attachment://mcap_compare.png');
    }
  }

  if (outputType === 'price' || outputType === 'both') {
    if (priceVals1.length > 0 || priceVals2.length > 0) {
      const maxLen = Math.max(priceVals1.length, priceVals2.length);
      const labels = Array.from({ length: maxLen }, (_, i) => `Run ${i + 1}`);
      const v1 = labels.map((_, i) => priceVals1[i] || 0);
      const v2 = labels.map((_, i) => priceVals2[i] || 0);
      const config = groupedBarChart(`${modelName} — Price Compare — ${target}`, labels, v1, v2, a1, a2, 'Price');
      const chartBuf = await fetchChart(config, { width: 700, height: 400 });
      files.push(new AttachmentBuilder(chartBuf, { name: 'price_compare.png' }));
      if (outputType === 'price') finalEmbed.setImage('attachment://price_compare.png');
    }
  }

  if (files.length === 0) {
    finalEmbed.setDescription(finalEmbed.data.description + '\n\n⚠️ No valid estimates were returned. Please try again.');
  }

  await interaction.editReply({ embeds: [finalEmbed], files });

  if (outputType === 'both' && files.length > 1) {
    await interaction.followUp({ files: [files[1]] }).catch(() => {});
  }
}

// ─── Main command ───

module.exports = {
  name: 'compare',
  description: 'Side-by-side LLM analysis comparing two assets — valuations, sentiment, pair trades.',
  needsEntries: false,
  publicReply: true,

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Asset Compare')
      .setColor(0x3b82f6)
      .setDescription(
        'Compare two assets side-by-side with LLM analysis (costs **1 PFT**):\n\n' +
        '**A) Bullish or Bearish** — All 18 models vote on each asset. Dual pie charts.\n' +
        '**B) Multi-Valuation** — Up to 8 models estimate values for both. Grouped bar chart.\n' +
        '**C) Solo-Valuation** — 1 model, multiple runs on both. Grouped bar chart.\n\n' +
        '*Supports market cap, price target, or both output types for B & C.*'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cmp_bullish').setLabel('A) Bullish or Bearish').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cmp_multival').setLabel('B) Multi-Valuation').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cmp_soloval').setLabel('C) Solo-Valuation').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  },

  async handleButton(interaction) {
    const id = interaction.customId;

    if (id === 'cmp_bullish') {
      const modal = new ModalBuilder()
        .setCustomId('cmp_bullish_modal')
        .setTitle('Compare — Bullish or Bearish')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('asset1').setLabel('Asset 1 (name or pitch)').setStyle(TextInputStyle.Paragraph).setPlaceholder('e.g. BTC or "Bitcoin is digital gold with institutional adoption..."').setRequired(true).setMaxLength(500)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('asset2').setLabel('Asset 2 (name or pitch)').setStyle(TextInputStyle.Paragraph).setPlaceholder('e.g. ETH or "Ethereum is a smart contract platform..."').setRequired(true).setMaxLength(500)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('horizon').setLabel('Time horizon (e.g. 3 months, EOY 2026)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
        );
      await interaction.showModal(modal);

    } else if (id === 'cmp_multival') {
      const modal = new ModalBuilder()
        .setCustomId('cmp_multival_modal')
        .setTitle('Compare — Multi-Valuation')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('asset1').setLabel('Asset 1 (name or pitch)').setStyle(TextInputStyle.Paragraph).setPlaceholder('e.g. BTC').setRequired(true).setMaxLength(500)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('asset2').setLabel('Asset 2 (name or pitch)').setStyle(TextInputStyle.Paragraph).setPlaceholder('e.g. ETH').setRequired(true).setMaxLength(500)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('target').setLabel('Target (e.g. Q3 2026, EOY 2027)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('output_type').setLabel('Output: mcap, price, or both (default: mcap)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('mcap')
          ),
        );
      await interaction.showModal(modal);

    } else if (id === 'cmp_soloval') {
      const modal = new ModalBuilder()
        .setCustomId('cmp_soloval_modal')
        .setTitle('Compare — Solo-Valuation')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('asset1').setLabel('Asset 1 (name or pitch)').setStyle(TextInputStyle.Paragraph).setPlaceholder('e.g. BTC').setRequired(true).setMaxLength(500)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('asset2').setLabel('Asset 2 (name or pitch)').setStyle(TextInputStyle.Paragraph).setPlaceholder('e.g. ETH').setRequired(true).setMaxLength(500)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('target').setLabel('Target (e.g. Q3 2026, EOY 2027)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('runs').setLabel('Number of runs (1-5, default 3)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('3')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('output_type').setLabel('Output: mcap, price, or both (default: mcap)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('mcap')
          ),
        );
      await interaction.showModal(modal);
    }
  },

  async handleModalSubmit(interaction) {
    const id = interaction.customId;

    if (id === 'cmp_bullish_modal') {
      const asset1 = interaction.fields.getTextInputValue('asset1');
      const asset2 = interaction.fields.getTextInputValue('asset2');
      const horizon = interaction.fields.getTextInputValue('horizon');
      await interaction.deferReply();

      const paymentTx = await collectPayment(interaction, 'Compare — Bullish/Bearish');
      if (!paymentTx) return;

      await runCompareBullish(interaction, asset1, asset2, horizon, paymentTx);

    } else if (id === 'cmp_multival_modal') {
      const asset1 = interaction.fields.getTextInputValue('asset1');
      const asset2 = interaction.fields.getTextInputValue('asset2');
      const target = interaction.fields.getTextInputValue('target');
      const outputTypeRaw = interaction.fields.getTextInputValue('output_type');
      const outputType = parseOutputType(outputTypeRaw);

      pendingCompare.set(interaction.user.id, { mode: 'multival', asset1, asset2, target, outputType });
      await interaction.deferReply();

      const label1 = truncLabel(asset1, 25);
      const label2 = truncLabel(asset2, 25);
      const row = buildModelSelectMenu('compare_model_select', 8, false);
      await interaction.editReply({ content: `Select up to 8 models for **${label1}** vs **${label2}** ${outputTypeLabel(outputType).toLowerCase()} by **${target}**:`, components: [row] });

    } else if (id === 'cmp_soloval_modal') {
      const asset1 = interaction.fields.getTextInputValue('asset1');
      const asset2 = interaction.fields.getTextInputValue('asset2');
      const target = interaction.fields.getTextInputValue('target');
      const runsStr = interaction.fields.getTextInputValue('runs');
      const runs = Math.min(5, Math.max(1, parseInt(runsStr) || 3));
      const outputTypeRaw = interaction.fields.getTextInputValue('output_type');
      const outputType = parseOutputType(outputTypeRaw);

      pendingCompare.set(interaction.user.id, { mode: 'soloval', asset1, asset2, target, runs, outputType });
      await interaction.deferReply();

      const label1 = truncLabel(asset1, 25);
      const label2 = truncLabel(asset2, 25);
      const row = buildModelSelectMenu('compare_model_select', 1, false);
      await interaction.editReply({ content: `Select a model for **${label1}** vs **${label2}** solo ${outputTypeLabel(outputType).toLowerCase()} (${runs} runs) by **${target}**:`, components: [row] });
    }
  },

  async handleSelectMenu(interaction) {
    const userId = interaction.user.id;
    const pending = pendingCompare.get(userId);
    if (!pending) {
      await interaction.reply({ content: 'No pending comparison found. Please run `/compare` again.', flags: 64 });
      return;
    }

    const selectedModels = interaction.values;
    pendingCompare.delete(userId);
    await interaction.deferUpdate();

    if (pending.mode === 'multival') {
      const paymentTx = await collectPayment(interaction, 'Compare — Multi-Valuation');
      if (!paymentTx) return;
      await runCompareMultiVal(interaction, pending.asset1, pending.asset2, pending.target, selectedModels, paymentTx, pending.outputType);
    } else if (pending.mode === 'soloval') {
      const paymentTx = await collectPayment(interaction, 'Compare — Solo-Valuation');
      if (!paymentTx) return;
      await runCompareSoloVal(interaction, pending.asset1, pending.asset2, pending.target, selectedModels[0], pending.runs, paymentTx, pending.outputType);
    }
  },

  pendingCompare,
};
