const { StringSelectMenuBuilder, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { callModel, chat: llmChat } = require('../openrouter');
const { MODELS, getModelById, getVisionModels } = require('../models');
const { getTradeByTradeId, addTrade } = require('../tradeStore');
const { saveAnalysis } = require('../analysisStore');
const { sendPFT, getBalance } = require('../wallet');
const { getActiveWallet, getWalletSeed } = require('../walletStore');

const pendingAnalysis = new Map();

// ─── PFT Micro-Payment Constants ───

const JOURNAL_NODE_WALLET = 'rLnrtLSQdtmWgTiY3o6NNWKpb43RsvZ1yW';
const LLM_FEE_PFT = '1';
const PFT_EXPLORER = 'https://explorer.testnet.postfiat.org/transactions';

// ─── Payment Collection ───

async function collectPayment(interaction, modeName) {
  const userId = interaction.user.id;

  const active = getActiveWallet(userId);
  if (!active) {
    const embed = new EmbedBuilder()
      .setTitle('Wallet Required')
      .setColor(0xef4444)
      .setDescription(
        'You need an active wallet to use LLM analysis.\n' +
        'Use `/postfiat` to create one, or `/wallets import` to import an existing wallet.'
      );
    await interaction.editReply({ embeds: [embed], components: [] });
    return null;
  }

  const balance = await getBalance(active.address);
  if (balance === null || parseFloat(balance) < parseFloat(LLM_FEE_PFT)) {
    const embed = new EmbedBuilder()
      .setTitle('Insufficient Balance')
      .setColor(0xef4444)
      .setDescription(
        `You need at least **${LLM_FEE_PFT} PFT** to run this analysis.\n\n` +
        `**Your balance:** ${balance ?? '0 (not activated)'} PFT\n` +
        `**Wallet:** \`${active.address}\``
      );
    await interaction.editReply({ embeds: [embed], components: [] });
    return null;
  }

  const memo = `Journal Node - ${modeName}`;

  const confirmEmbed = new EmbedBuilder()
    .setTitle('LLM Analysis — Payment Required')
    .setColor(0xf59e0b)
    .setDescription(
      `**Mode:** ${modeName}\n` +
      `**Fee:** ${LLM_FEE_PFT} PFT\n` +
      `**From:** \`${active.address}\`\n` +
      `**To:** \`${JOURNAL_NODE_WALLET}\`\n` +
      `**Memo:** ${memo}\n` +
      `**Your Balance:** ${balance} PFT\n\n` +
      'Click **Confirm & Pay** to proceed with the analysis.'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('llma_pay_confirm').setLabel(`Confirm & Pay ${LLM_FEE_PFT} PFT`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('llma_pay_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

  let btnInteraction;
  try {
    const msg = await interaction.fetchReply();
    btnInteraction = await msg.awaitMessageComponent({
      filter: (i) => i.user.id === userId && (i.customId === 'llma_pay_confirm' || i.customId === 'llma_pay_cancel'),
      time: 60000,
    });
  } catch {
    const timeoutEmbed = new EmbedBuilder()
      .setTitle('Payment Timed Out')
      .setColor(0xef4444)
      .setDescription('Payment confirmation timed out. Run `/llmanalyze` again to start over.');
    await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    return null;
  }

  if (btnInteraction.customId === 'llma_pay_cancel') {
    await btnInteraction.update({
      embeds: [new EmbedBuilder().setTitle('Analysis Cancelled').setColor(0x6b7280).setDescription('Payment was cancelled.')],
      components: [],
    });
    return null;
  }

  await btnInteraction.update({
    embeds: [new EmbedBuilder().setTitle('Processing Payment...').setColor(0xf59e0b).setDescription(`Sending ${LLM_FEE_PFT} PFT to Journal Node wallet...`)],
    components: [],
  });

  try {
    const seed = getWalletSeed(userId, active.address);
    if (!seed) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle('Wallet Error').setColor(0xef4444).setDescription('Could not retrieve your wallet credentials. Try `/wallets set-active` to reset.')],
      });
      return null;
    }

    const result = await sendPFT(seed, JOURNAL_NODE_WALLET, LLM_FEE_PFT, memo);
    const txUrl = `${PFT_EXPLORER}/${result.txHash}`;

    const confirmedEmbed = new EmbedBuilder()
      .setTitle('Payment Confirmed')
      .setColor(0x22c55e)
      .setDescription(
        `**Amount:** ${LLM_FEE_PFT} PFT\n` +
        `**From:** \`${result.from}\`\n` +
        `**To:** \`${result.to}\`\n` +
        `**Memo:** ${memo}\n` +
        `**Transaction:** [View on Explorer](${txUrl})\n\n` +
        `Starting **${modeName}** analysis...`
      );
    await interaction.followUp({ embeds: [confirmedEmbed] });

    return { txHash: result.txHash, from: result.from, txUrl };
  } catch (err) {
    console.error(`[llmanalyze] Payment failed:`, err.message);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('Payment Failed').setColor(0xef4444).setDescription(`Transaction failed: ${err.message}\n\nPlease try again.`)],
    });
    return null;
  }
}

// ─── B.O.B. Thesis Ingestion ───

const BOB_USERNAME = '__jollyadvisorbot__';

async function findBobThesis(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  // Find latest thesis from B.O.B. — must be substantial (not just "Generating thesis...")
  const thesis = messages.find(msg =>
    msg.author.username === BOB_USERNAME &&
    msg.content.includes('Thesis') &&
    msg.content.length > 200
  );
  return thesis || null;
}

async function parseBobThesis(thesisContent) {
  const prompt = `You are a trading thesis parser. Extract structured fields from the thesis below. Respond with ONLY valid JSON, no markdown fences, no other text.

Required JSON format:
{"asset":"primary asset or sector","direction":"LONG or SHORT","confidence":"HIGH, MEDIUM, or LOW","timeframe":"investment timeframe or Not specified","summary":"1-2 sentence thesis summary"}`;

  const response = await llmChat(prompt, thesisContent);
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not extract structured data from thesis');
  return JSON.parse(jsonMatch[0]);
}

function buildBobPanel(parsed, thesisDate) {
  const dirEmoji = parsed.direction === 'SHORT' ? '📉' : '📈';
  const embed = new EmbedBuilder()
    .setTitle('B.O.B. Thesis — Ingestion Confirmed')
    .setColor(0x3b82f6)
    .setDescription(
      `**Date:** ${thesisDate}\n` +
      `**Asset:** ${parsed.asset}\n` +
      `**Direction:** ${dirEmoji} ${parsed.direction}\n` +
      `**Confidence:** ${parsed.confidence}\n` +
      `**Timeframe:** ${parsed.timeframe || 'Not specified'}\n\n` +
      `**Summary:** ${parsed.summary}\n\n` +
      'Run the thesis through LLM analysis, view the full ingestion, or create a trade ticket:'
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('llma_bob_bb').setLabel('A) Bullish/Bearish').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('llma_bob_mv').setLabel('B) Multi-Val').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('llma_bob_sv').setLabel('C) Solo-Val').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('llma_bob_ta').setLabel('D) Technical').setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('llma_bob_view').setLabel('View Full Thesis').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('llma_bob_trade').setLabel('Create Trade Ticket').setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

// ─── Chart helpers via QuickChart.io ───

async function fetchChart(config, opts = {}) {
  const { width = 600, height = 400, bkg = 'white' } = opts;
  const url = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(config))}&w=${width}&h=${height}&bkg=${encodeURIComponent(bkg)}&devicePixelRatio=1`;
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

async function runBullish(interaction, assetDescription, horizon, tradeId, paymentTx) {
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
    if (paymentTx) desc += `**Payment:** [View TX](${paymentTx.txUrl}) (${LLM_FEE_PFT} PFT)\n`;

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

  // Persist analysis result
  if (tradeId) {
    saveAnalysis(interaction.user.id, {
      tradeId,
      mode: 'bullish',
      asset: assetDescription,
      horizon,
      result: { bullishCount, bearishCount, details },
    });
  }
}

// ─── Mode: Multi-Valuation — up to 8 models, progressive embed ───

async function runMultiVal(interaction, asset, target, modelIds, tradeId, paymentTx) {
  const systemPrompt = valuationPrompt(asset, target);
  const userMsg = `Asset: ${asset}\nTarget: ${target}\n\nWhat is your market cap estimate?`;

  const details = [];

  const buildEmbed = (complete = false) => {
    const embed = new EmbedBuilder()
      .setTitle('Multi-Valuation — Results')
      .setColor(0x6366f1);

    let desc = `**Asset:** ${asset}\n**Target:** ${target}\n`;
    if (paymentTx) desc += `**Payment:** [View TX](${paymentTx.txUrl}) (${LLM_FEE_PFT} PFT)\n`;

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

  if (tradeId) {
    saveAnalysis(interaction.user.id, {
      tradeId,
      mode: 'multival',
      asset,
      target,
      result: { details },
    });
  }
}

// ─── Mode: Solo-Valuation — 1 model, N runs, progressive embed ───

async function runSoloVal(interaction, asset, target, modelId, runs, tradeId, paymentTx) {
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
    if (paymentTx) desc += `**Payment:** [View TX](${paymentTx.txUrl}) (${LLM_FEE_PFT} PFT)\n`;

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

  if (tradeId) {
    saveAnalysis(interaction.user.id, {
      tradeId,
      mode: 'soloval',
      asset,
      target,
      model: modelName,
      result: { mean, median, runResults: values },
    });
  }
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

  const leftW = 430, rightW = 470, chartH = 350;
  const [leftRaw, rightRaw] = await Promise.all([
    fetchChart(consensusConfig, { width: leftW, height: chartH, bkg: '#000000' }),
    fetchChart(breakdownConfig, { width: rightW, height: chartH, bkg: '#000000' }),
  ]);

  // Force-resize to exact dimensions (QuickChart may return different pixel ratio)
  const leftBuf = await sharp(leftRaw).resize(leftW, chartH).png().toBuffer();
  const rightBuf = await sharp(rightRaw).resize(rightW, chartH).png().toBuffer();

  const totalW = leftW + rightW;
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
      { input: rightBuf, top: titleH, left: leftW },
    ])
    .png()
    .toBuffer();

  return combined;
}

// ─── Mode: Technical Analyst — vision models, progressive embed ───

async function runTechnical(interaction, timeframe, imageUrl, modelIds, tradeId, paymentTx) {
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
    if (paymentTx) desc += `**Payment:** [View TX](${paymentTx.txUrl}) (${LLM_FEE_PFT} PFT)\n`;

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
  try {
    const combinedBuf = await buildCombinedTechnicalChart(timeframe, details, longCount, shortCount);
    const file = new AttachmentBuilder(combinedBuf, { name: 'technical.png' });
    await interaction.followUp({ files: [file] });
  } catch (chartErr) {
    console.error('Chart generation error:', chartErr);
    await interaction.followUp({ content: `Chart generation failed: ${chartErr.message}` });
  }

  if (tradeId) {
    saveAnalysis(interaction.user.id, {
      tradeId,
      mode: 'technical',
      timeframe,
      result: { longCount, shortCount, details },
    });
  }
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
        'Pick a mode (each analysis costs **1 PFT**):\n\n' +
        '**A) Bullish or Bearish** — Pitch an asset to all 18 models. Pie chart.\n' +
        '**B) Multi-Valuation** — Pick up to 8 models for market cap estimates. Bar chart.\n' +
        '**C) Solo-Valuation** — Run 1 model up to 5 times to test consistency. Bar chart.\n' +
        '**D) Technical Analyst** — Vision models analyze your chart screenshot. Long/Short.\n' +
        '**E) B.O.B. Thesis** — Ingest the latest B.O.B. trading thesis for analysis.'
      );

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('llma_bullish').setLabel('A) Bullish or Bearish').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('llma_multival').setLabel('B) Multi-Valuation').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('llma_soloval').setLabel('C) Solo-Valuation').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('llma_technical').setLabel('D) Technical Analyst').setStyle(ButtonStyle.Danger),
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('llma_bob').setLabel('E) B.O.B. Thesis').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('llma_info').setLabel('?').setStyle(ButtonStyle.Primary),
    );

    await interaction.editReply({ embeds: [embed], components: [row1, row2] });
  },

  // Handle button clicks
  async handleButton(interaction) {
    const id = interaction.customId;

    // Payment buttons are handled by collectPayment's awaitMessageComponent
    if (id === 'llma_pay_confirm' || id === 'llma_pay_cancel') return;

    if (id === 'llma_info') {
      const modelList = MODELS.map((m, i) => `${i + 1}. **${m.name}** — \`${m.id}\`${m.vision ? ' 👁' : ''}`).join('\n');
      await interaction.reply({
        content: `**18 Models queried by LLM Analyzer:**\n\n${modelList}\n\n👁 = supports vision/image analysis`,
        flags: 64,
      });
      return;
    }

    if (id === 'llma_bullish') {
      // Pre-populate from trade context if available
      const pending = pendingAnalysis.get(interaction.user.id) || {};
      let prefill = '';
      let prefillHorizon = '';
      if (pending.tradeId) {
        const trade = getTradeByTradeId(interaction.user.id, pending.tradeId);
        if (trade) {
          prefill = `${trade.direction} ${trade.asset} @ ${trade.entry} → ${trade.target}. ${trade.emotionReasoning}`.slice(0, 500);
          prefillHorizon = trade.timeframe;
        }
      }

      const assetInput = new TextInputBuilder()
        .setCustomId('asset')
        .setLabel('Describe the asset briefly')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('e.g. Ethereum is a smart contract platform with growing DeFi adoption...')
        .setRequired(true)
        .setMaxLength(500);
      if (prefill) assetInput.setValue(prefill);

      const horizonInput = new TextInputBuilder()
        .setCustomId('horizon')
        .setLabel('Time horizon (e.g. 3 months, EOY 2026)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      if (prefillHorizon) horizonInput.setValue(prefillHorizon);

      const modal = new ModalBuilder()
        .setCustomId('llma_bullish_modal')
        .setTitle('Bullish or Bearish')
        .addComponents(
          new ActionRowBuilder().addComponents(assetInput),
          new ActionRowBuilder().addComponents(horizonInput),
        );
      await interaction.showModal(modal);

    } else if (id === 'llma_multival') {
      const pending = pendingAnalysis.get(interaction.user.id) || {};
      let prefillAsset = '';
      if (pending.tradeId) {
        const trade = getTradeByTradeId(interaction.user.id, pending.tradeId);
        if (trade) prefillAsset = trade.asset;
      }

      const assetInput = new TextInputBuilder().setCustomId('asset').setLabel('Asset (e.g. BTC, ETH, AAPL)').setStyle(TextInputStyle.Short).setRequired(true);
      if (prefillAsset) assetInput.setValue(prefillAsset);

      const modal = new ModalBuilder()
        .setCustomId('llma_multival_modal')
        .setTitle('Multi-Valuation')
        .addComponents(
          new ActionRowBuilder().addComponents(assetInput),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('target').setLabel('Target (e.g. Q3 2026, EOY 2027)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
        );
      await interaction.showModal(modal);

    } else if (id === 'llma_soloval') {
      const pending = pendingAnalysis.get(interaction.user.id) || {};
      let prefillAsset = '';
      if (pending.tradeId) {
        const trade = getTradeByTradeId(interaction.user.id, pending.tradeId);
        if (trade) prefillAsset = trade.asset;
      }

      const assetInput = new TextInputBuilder().setCustomId('asset').setLabel('Asset (e.g. BTC, ETH, AAPL)').setStyle(TextInputStyle.Short).setRequired(true);
      if (prefillAsset) assetInput.setValue(prefillAsset);

      const modal = new ModalBuilder()
        .setCustomId('llma_soloval_modal')
        .setTitle('Solo-Valuation')
        .addComponents(
          new ActionRowBuilder().addComponents(assetInput),
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
      const pending = pendingAnalysis.get(interaction.user.id) || {};
      pendingAnalysis.set(interaction.user.id, { mode: 'technical_select', tradeId: pending.tradeId || null });
      const row = buildModelSelectMenu('llmanalyze_model_select', 8, true);
      await interaction.reply({ content: 'Technical Analyst — Select up to 8 vision-capable models:', components: [row], flags: 64 });

    // ─── B.O.B. Thesis Handlers ───

    } else if (id === 'llma_bob') {
      await interaction.deferReply();

      const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId);
      const thesisMsg = await findBobThesis(channel);

      if (!thesisMsg) {
        const embed = new EmbedBuilder()
          .setTitle('B.O.B. Thesis — Not Found')
          .setColor(0xef4444)
          .setDescription(
            'No B.O.B. thesis was found in recent messages.\n\n' +
            'Make sure a thesis from **B.O.B.** (`__jollyadvisorbot__`) has been posted in this channel.'
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const parsingEmbed = new EmbedBuilder()
        .setTitle('B.O.B. Thesis — Parsing...')
        .setColor(0xf59e0b)
        .setDescription('Analyzing thesis content with LLM...');
      await interaction.editReply({ embeds: [parsingEmbed] });

      try {
        const parsed = await parseBobThesis(thesisMsg.content);
        const dateMatch = thesisMsg.content.match(/(?:Daily\s+)?Thesis\s*[—–\-]\s*(.+?)(?:\n|\*)/i);
        const thesisDate = dateMatch ? dateMatch[1].trim() : thesisMsg.createdAt.toLocaleDateString('en-US', { dateStyle: 'medium' });

        pendingAnalysis.set(interaction.user.id, {
          bobThesis: { ...parsed, fullText: thesisMsg.content, messageId: thesisMsg.id },
          bobThesisDate: thesisDate,
        });

        const panel = buildBobPanel(parsed, thesisDate);
        await interaction.editReply(panel);
      } catch (err) {
        console.error('[B.O.B.] Thesis parsing failed:', err);
        const embed = new EmbedBuilder()
          .setTitle('B.O.B. Thesis — Parse Error')
          .setColor(0xef4444)
          .setDescription(`Failed to parse the thesis: ${err.message}\n\nPlease try again.`);
        await interaction.editReply({ embeds: [embed] });
      }

    } else if (id === 'llma_bob_bb') {
      const pending = pendingAnalysis.get(interaction.user.id);
      if (!pending?.bobThesis) {
        await interaction.reply({ content: 'No B.O.B. thesis found. Run `/llmanalyze` → B.O.B. again.', flags: 64 });
        return;
      }
      const thesis = pending.bobThesis;
      await interaction.deferReply();

      const paymentTx = await collectPayment(interaction, 'Bullish or Bearish');
      if (!paymentTx) return;

      const assetDesc = `B.O.B. Trading Thesis: ${thesis.summary}\n\nFull thesis:\n${thesis.fullText}`.slice(0, 500);
      const horizon = thesis.timeframe || 'As described in thesis';
      await runBullish(interaction, assetDesc, horizon, null, paymentTx);

    } else if (id === 'llma_bob_mv') {
      const pending = pendingAnalysis.get(interaction.user.id);
      if (!pending?.bobThesis) {
        await interaction.reply({ content: 'No B.O.B. thesis found. Run `/llmanalyze` → B.O.B. again.', flags: 64 });
        return;
      }
      const thesis = pending.bobThesis;
      // Store mode so handleModalSubmit picks it up
      pendingAnalysis.set(interaction.user.id, { ...pending, mode: 'bob_multival_prefill' });

      const assetInput = new TextInputBuilder().setCustomId('asset').setLabel('Asset (e.g. BTC, ETH, AAPL)').setStyle(TextInputStyle.Short).setRequired(true).setValue(thesis.asset.slice(0, 50));
      const targetInput = new TextInputBuilder().setCustomId('target').setLabel('Target (e.g. Q3 2026, EOY 2027)').setStyle(TextInputStyle.Short).setRequired(true);
      if (thesis.timeframe && thesis.timeframe !== 'Not specified') targetInput.setValue(thesis.timeframe.slice(0, 50));

      const modal = new ModalBuilder()
        .setCustomId('llma_multival_modal')
        .setTitle('Multi-Valuation (B.O.B.)')
        .addComponents(
          new ActionRowBuilder().addComponents(assetInput),
          new ActionRowBuilder().addComponents(targetInput),
        );
      await interaction.showModal(modal);

    } else if (id === 'llma_bob_sv') {
      const pending = pendingAnalysis.get(interaction.user.id);
      if (!pending?.bobThesis) {
        await interaction.reply({ content: 'No B.O.B. thesis found. Run `/llmanalyze` → B.O.B. again.', flags: 64 });
        return;
      }
      const thesis = pending.bobThesis;
      pendingAnalysis.set(interaction.user.id, { ...pending, mode: 'bob_soloval_prefill' });

      const assetInput = new TextInputBuilder().setCustomId('asset').setLabel('Asset (e.g. BTC, ETH, AAPL)').setStyle(TextInputStyle.Short).setRequired(true).setValue(thesis.asset.slice(0, 50));
      const targetInput = new TextInputBuilder().setCustomId('target').setLabel('Target (e.g. Q3 2026, EOY 2027)').setStyle(TextInputStyle.Short).setRequired(true);
      if (thesis.timeframe && thesis.timeframe !== 'Not specified') targetInput.setValue(thesis.timeframe.slice(0, 50));

      const modal = new ModalBuilder()
        .setCustomId('llma_soloval_modal')
        .setTitle('Solo-Valuation (B.O.B.)')
        .addComponents(
          new ActionRowBuilder().addComponents(assetInput),
          new ActionRowBuilder().addComponents(targetInput),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('runs').setLabel('Number of runs (1-5, default 3)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('3')
          ),
        );
      await interaction.showModal(modal);

    } else if (id === 'llma_bob_ta') {
      const pending = pendingAnalysis.get(interaction.user.id);
      if (!pending?.bobThesis) {
        await interaction.reply({ content: 'No B.O.B. thesis found. Run `/llmanalyze` → B.O.B. again.', flags: 64 });
        return;
      }
      pendingAnalysis.set(interaction.user.id, { ...pending, mode: 'technical_select' });
      const row = buildModelSelectMenu('llmanalyze_model_select', 8, true);
      await interaction.reply({ content: 'Technical Analyst (B.O.B.) — Select up to 8 vision-capable models:', components: [row], flags: 64 });

    } else if (id === 'llma_bob_view') {
      const pending = pendingAnalysis.get(interaction.user.id);
      if (!pending?.bobThesis) return;
      const thesis = pending.bobThesis;

      const embed = new EmbedBuilder()
        .setTitle('B.O.B. Thesis — Full Ingestion')
        .setColor(0x3b82f6)
        .addFields(
          { name: 'Asset', value: thesis.asset, inline: true },
          { name: 'Direction', value: thesis.direction, inline: true },
          { name: 'Confidence', value: thesis.confidence, inline: true },
          { name: 'Timeframe', value: thesis.timeframe || 'Not specified', inline: true },
          { name: 'Summary', value: thesis.summary },
          { name: 'Full Thesis', value: thesis.fullText.slice(0, 1024) },
        );
      if (thesis.fullText.length > 1024) {
        embed.addFields({ name: 'Full Thesis (cont.)', value: thesis.fullText.slice(1024, 2048) });
      }

      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('llma_bob_back').setLabel('Back to Options').setStyle(ButtonStyle.Secondary),
      );
      await interaction.update({ embeds: [embed], components: [backRow] });

    } else if (id === 'llma_bob_back') {
      const pending = pendingAnalysis.get(interaction.user.id);
      if (!pending?.bobThesis) return;
      const panel = buildBobPanel(pending.bobThesis, pending.bobThesisDate);
      await interaction.update(panel);

    } else if (id === 'llma_bob_trade') {
      const pending = pendingAnalysis.get(interaction.user.id);
      if (!pending?.bobThesis) {
        await interaction.reply({ content: 'No B.O.B. thesis found. Run `/llmanalyze` → B.O.B. again.', flags: 64 });
        return;
      }
      const thesis = pending.bobThesis;
      const dirLabel = thesis.direction === 'SHORT' ? 'SHORT' : 'LONG';

      const modal = new ModalBuilder()
        .setCustomId('llma_bob_trade_modal')
        .setTitle(`Trade from B.O.B. — ${dirLabel}`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('asset').setLabel('Asset / Ticker').setStyle(TextInputStyle.Short).setRequired(true).setValue(thesis.asset.slice(0, 50)).setMaxLength(50)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('entry').setLabel('Entry Price').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 64500').setMaxLength(30)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('target').setLabel('Target Price').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 72000').setMaxLength(30)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('timeframe').setLabel('Timeframe').setStyle(TextInputStyle.Short).setRequired(true).setValue((thesis.timeframe || '').slice(0, 30)).setMaxLength(30)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('emotion_reasoning').setLabel('Emotion (1-10) & Reasoning').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(`B.O.B. Thesis: ${thesis.summary}`.slice(0, 500)).setMaxLength(500)
          ),
        );
      await interaction.showModal(modal);
    }
  },

  // Handle modal submissions
  async handleModalSubmit(interaction) {
    const id = interaction.customId;

    if (id === 'llma_bullish_modal') {
      const asset = interaction.fields.getTextInputValue('asset');
      const horizon = interaction.fields.getTextInputValue('horizon');
      const existing = pendingAnalysis.get(interaction.user.id) || {};
      const tradeId = existing.tradeId || null;
      pendingAnalysis.delete(interaction.user.id);
      await interaction.deferReply();

      const paymentTx = await collectPayment(interaction, 'Bullish or Bearish');
      if (!paymentTx) return;

      await runBullish(interaction, asset, horizon, tradeId, paymentTx);

    } else if (id === 'llma_multival_modal') {
      const asset = interaction.fields.getTextInputValue('asset');
      const target = interaction.fields.getTextInputValue('target');
      const existing = pendingAnalysis.get(interaction.user.id) || {};
      pendingAnalysis.set(interaction.user.id, { ...existing, mode: 'multival', asset, target, tradeId: existing.tradeId || null });
      await interaction.deferReply();
      const row = buildModelSelectMenu('llmanalyze_model_select', 8, false);
      await interaction.editReply({ content: `Select up to 8 models for **${asset}** valuation by **${target}**:`, components: [row] });

    } else if (id === 'llma_soloval_modal') {
      const asset = interaction.fields.getTextInputValue('asset');
      const target = interaction.fields.getTextInputValue('target');
      const runsStr = interaction.fields.getTextInputValue('runs');
      const runs = Math.min(5, Math.max(1, parseInt(runsStr) || 3));
      const existing = pendingAnalysis.get(interaction.user.id) || {};
      pendingAnalysis.set(interaction.user.id, { ...existing, mode: 'soloval', asset, target, runs, tradeId: existing.tradeId || null });
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
      const tradeId = existing.tradeId || null;
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

      let imageUrl;
      try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        imageUrl = collected.first().attachments.filter(a => a.contentType?.startsWith('image/')).first().url;
      } catch (err) {
        const timeoutEmbed = new EmbedBuilder()
          .setTitle('Technical Analyst')
          .setColor(0xef4444)
          .setDescription('No chart image received within 60 seconds. Please try `/llmanalyze` again.');
        await interaction.editReply({ embeds: [timeoutEmbed] });
        return;
      }

      const paymentTx = await collectPayment(interaction, 'Technical Analyst');
      if (!paymentTx) return;

      try {
        await runTechnical(interaction, timeframe, imageUrl, models, tradeId, paymentTx);
      } catch (err) {
        console.error('Technical Analyst error:', err);
        const errorEmbed = new EmbedBuilder()
          .setTitle('Technical Analyst — Error')
          .setColor(0xef4444)
          .setDescription(`An error occurred generating the analysis chart. Please try again.\n\n\`${err.message}\``);
        await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
      }

    } else if (id === 'llma_bob_trade_modal') {
      const existing = pendingAnalysis.get(interaction.user.id);
      if (!existing?.bobThesis) {
        await interaction.reply({ content: 'No B.O.B. thesis found. Please run `/llmanalyze` → B.O.B. again.', flags: 64 });
        return;
      }

      const thesis = existing.bobThesis;
      const direction = thesis.direction === 'SHORT' ? 'Short' : 'Long';
      const asset = interaction.fields.getTextInputValue('asset');
      const entry = interaction.fields.getTextInputValue('entry');
      const target = interaction.fields.getTextInputValue('target');
      const timeframe = interaction.fields.getTextInputValue('timeframe');
      const emotionReasoning = interaction.fields.getTextInputValue('emotion_reasoning');
      const username = interaction.user.username;

      const trade = addTrade(interaction.user.id, {
        asset,
        direction,
        entry,
        target,
        timeframe,
        emotionReasoning,
        screenshotUrl: null,
        username,
      });

      console.log(`[B.O.B. Trade] ${username} logged trade #${trade.id}: ${direction} ${asset} @ ${entry} → ${target}`);

      const dirEmoji = direction.toLowerCase() === 'long' ? '📈' : '📉';
      const embed = new EmbedBuilder()
        .setTitle(`TRADE TICKET #${trade.id}`)
        .setColor(direction.toLowerCase() === 'long' ? 0x22c55e : 0xef4444)
        .setDescription(
          `**Trade ID:** \`${trade.tradeId}\`\n` +
          `**Trader:** ${username}\n` +
          `**Asset:** ${asset}\n` +
          `**Direction:** ${dirEmoji} ${direction.toUpperCase()}\n` +
          `**Entry:** ${entry}\n` +
          `**Target:** ${target}\n` +
          `**Timeframe:** ${timeframe}\n\n` +
          `**Emotion & Reasoning:**\n${emotionReasoning}\n\n` +
          `**Source:** B.O.B. Thesis\n` +
          `**Logged:** ${new Date(trade.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`trade_llma_${trade.tradeId}`)
          .setLabel('Run LLM Analysis')
          .setEmoji('🔍')
          .setStyle(ButtonStyle.Primary),
      );

      await interaction.reply({ embeds: [embed], components: [row] });
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
      pendingAnalysis.set(userId, { ...pending, mode: 'technical_ready', models: selectedModels, tradeId: pending.tradeId || null });
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
      const paymentTx = await collectPayment(interaction, 'Multi-Valuation');
      if (!paymentTx) return;
      await runMultiVal(interaction, pending.asset, pending.target, selectedModels, pending.tradeId, paymentTx);
    } else if (pending.mode === 'soloval') {
      const paymentTx = await collectPayment(interaction, 'Solo-Valuation');
      if (!paymentTx) return;
      await runSoloVal(interaction, pending.asset, pending.target, selectedModels[0], pending.runs, pending.tradeId, paymentTx);
    }
  },

  // Handle "Run LLM Analysis" button from a trade ticket
  async handleTradeButton(interaction) {
    const tradeId = interaction.customId.replace('trade_llma_', '');
    const userId = interaction.user.id;
    const trade = getTradeByTradeId(userId, tradeId);

    if (!trade) {
      await interaction.reply({ content: 'Trade not found. You can only analyze your own trades.', flags: 64 });
      return;
    }

    // Store tradeId in pendingAnalysis so it flows through the entire analysis pipeline
    pendingAnalysis.set(userId, { tradeId });

    // Build asset description from trade context for pre-population
    const assetDesc = `${trade.asset} — ${trade.direction} @ ${trade.entry} → ${trade.target} (${trade.timeframe})`;

    const embed = new EmbedBuilder()
      .setTitle('LLM Analysis — Trade Linked')
      .setColor(0x3b82f6)
      .setDescription(
        `**Trade #${trade.id}:** ${trade.direction} ${trade.asset} @ ${trade.entry} → ${trade.target}\n\n` +
        'Pick an analysis mode (each analysis costs **1 PFT**):\n\n' +
        '**A) Bullish or Bearish** — All 18 models vote on your thesis.\n' +
        '**B) Multi-Valuation** — Up to 8 models estimate market cap.\n' +
        '**C) Solo-Valuation** — 1 model, multiple runs for consistency.\n' +
        '**D) Technical Analyst** — Vision models analyze a chart screenshot.'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('llma_bullish').setLabel('A) Bullish or Bearish').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('llma_multival').setLabel('B) Multi-Valuation').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('llma_soloval').setLabel('C) Solo-Valuation').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('llma_technical').setLabel('D) Technical Analyst').setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
  },

  pendingAnalysis,
};
