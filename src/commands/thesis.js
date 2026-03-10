const { EmbedBuilder } = require('discord.js');
const { chat: llmChat } = require('../openrouter');
const { saveThesis } = require('../thesisStore');

// ─── B.O.B. Thesis Detection ───

const BOB_USERNAME = 'jollyadvisorbot';

function getBobText(msg) {
  if (msg.content && msg.content.length > 200) return msg.content;
  if (msg.embeds?.length > 0) {
    for (const embed of msg.embeds) {
      const text = [embed.title, embed.description, ...(embed.fields || []).map(f => `${f.name}\n${f.value}`)].filter(Boolean).join('\n');
      if (text.length > 200) return text;
    }
  }
  return null;
}

async function findBobThesis(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const thesis = messages.find(msg => {
    if (msg.author.username !== BOB_USERNAME) return false;
    const text = getBobText(msg);
    if (!text) return false;
    return /thesis/i.test(text);
  });
  return thesis || null;
}

/**
 * Fetch all B.O.B. thesis messages within a date range.
 * Scans channel history in batches (up to 500 messages) and filters by date.
 */
async function findBobThesesInRange(channel, startDate, endDate) {
  const theses = [];
  let lastId = null;
  const maxBatches = 5; // 500 messages max scan

  for (let i = 0; i < maxBatches; i++) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    for (const [, msg] of messages) {
      // Stop scanning if we've gone past the start date
      if (msg.createdAt < startDate) {
        return theses;
      }

      if (msg.author.username !== BOB_USERNAME) continue;
      if (msg.createdAt > endDate) continue;

      const text = getBobText(msg);
      if (!text) continue;
      if (!/thesis/i.test(text)) continue;

      theses.push({ message: msg, text });
    }

    lastId = messages.last()?.id;
    if (!lastId) break;
  }

  return theses;
}

// ─── Distillation Prompt (single thesis) ───

const DISTILL_PROMPT = `You are a trading thesis distillation engine. Your job is to extract structured, actionable data from raw trading thesis text.

Analyze the thesis below and extract the following fields. Respond with ONLY valid JSON — no markdown fences, no commentary, no other text.

Required JSON format:
{
  "asset": "The primary asset, ticker, or sector being discussed (e.g. NVDA, BTC, AI Semiconductors)",
  "direction": "LONG or SHORT",
  "timeframe": "The investment timeframe or catalyst window described (e.g. '6 weeks', 'Q2 2026 earnings', 'EOY 2027'). Use 'Not specified' only if truly absent.",
  "sizing": "How the author describes position sizing, instrument choice, or risk approach (e.g. 'Sizing into puts', 'Full position', 'Small starter'). Use 'Not specified' only if truly absent.",
  "catalyst": "The key catalyst or trigger event the thesis hinges on (e.g. 'Q2 earnings miss', 'ETF approval', 'Fed rate decision'). Use 'Not specified' only if truly absent.",
  "confidence": "HIGH, MEDIUM, or LOW — inferred from the author's conviction and language",
  "summary": "A 1-2 sentence distillation of the core thesis in your own words"
}

Be precise. Extract exactly what the author stated — do not hallucinate details. If the author implies a field but doesn't state it explicitly, make your best inference and note it.`;

// ─── Aggregate Analysis Prompt (multi-day) ───

const AGGREGATE_PROMPT = `You are a trading thesis aggregation and analysis engine. You will receive multiple B.O.B. Daily Theses spanning a date range. Your job is to produce a comprehensive aggregate analysis.

Analyze ALL the theses below and produce the following three sections. Respond with ONLY valid JSON — no markdown fences, no commentary, no other text.

Required JSON format:
{
  "assetSummary": {
    "assets": [
      {
        "ticker": "Asset ticker or name",
        "mentions": 1,
        "direction": "LONG, SHORT, or MIXED",
        "brief": "One-line summary of the thesis stance on this asset"
      }
    ],
    "overview": "2-3 sentence summary of the asset landscape across all theses"
  },
  "sentimentHeatmap": {
    "overallSentiment": "BULLISH, BEARISH, or MIXED",
    "bullishCount": 0,
    "bearishCount": 0,
    "neutralCount": 0,
    "dominantTheme": "The primary macro or market theme driving sentiment across these theses",
    "keyShifts": "Notable sentiment shifts or contradictions between theses over time (or 'None observed' if consistent)",
    "breakdown": [
      {
        "date": "Date of the thesis",
        "sentiment": "BULLISH or BEARISH",
        "keyAsset": "Primary asset discussed",
        "oneLiner": "One-sentence sentiment summary for that day"
      }
    ]
  },
  "aggregateView": {
    "investmentStyle": "Description of B.O.B.'s recurring investment approach, risk tolerance, and strategy patterns",
    "recurringThemes": ["Theme 1", "Theme 2"],
    "decisionPatterns": "Summary of how B.O.B. makes decisions — what triggers entries, how conviction is expressed, what catalysts are favored",
    "evolution": "How the thesis style or views have evolved over the timeframe (or 'Consistent approach' if no change)"
  }
}

Be thorough and precise. Base your analysis ONLY on the provided theses — do not hallucinate or assume information not present.`;

// ─── Helpers ───

function parseDate(dateStr) {
  // Accept YYYY-MM-DD format
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Single Thesis Execution (existing behavior) ───

async function executeSingle(interaction, channel) {
  const thesisMsg = await findBobThesis(channel);

  if (!thesisMsg) {
    const embed = new EmbedBuilder()
      .setTitle('B.O.B. Thesis — Not Found')
      .setColor(0xef4444)
      .setDescription(
        'No B.O.B. thesis was found in recent messages.\n\n' +
        'Make sure a thesis from **B.O.B.** (`jollyadvisorbot`) has been posted in this channel.'
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const thesisText = getBobText(thesisMsg);
  if (!thesisText) {
    const embed = new EmbedBuilder()
      .setTitle('B.O.B. Thesis — Empty')
      .setColor(0xef4444)
      .setDescription('Found a B.O.B. message but could not extract thesis text.');
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const parsingEmbed = new EmbedBuilder()
    .setTitle('B.O.B. Thesis — Distilling...')
    .setColor(0xf59e0b)
    .setDescription('Extracting structured data from thesis with LLM...');
  await interaction.editReply({ embeds: [parsingEmbed] });

  const dateMatch = thesisText.match(/(?:Daily\s+)?Thesis\s*[—–\-]\s*(.+?)(?:\n|\*)/i);
  const thesisDate = dateMatch
    ? dateMatch[1].trim()
    : thesisMsg.createdAt.toLocaleDateString('en-US', { dateStyle: 'medium' });

  let parsed;
  try {
    const response = await llmChat(DISTILL_PROMPT, thesisText, { maxTokens: 3000 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM did not return valid JSON');
    let jsonStr = jsonMatch[0]
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\x00-\x1F\x7F]/g, (c) => c === '\n' || c === '\r' || c === '\t' ? c : '');
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[/thesis] Distillation failed:', err);
    const errorEmbed = new EmbedBuilder()
      .setTitle('B.O.B. Thesis — Distillation Failed')
      .setColor(0xef4444)
      .setDescription(`Failed to extract structured data: ${err.message}\n\nPlease try again.`);
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const asset = parsed.asset || 'Unknown';
  const direction = (parsed.direction || '').toUpperCase();
  const timeframe = parsed.timeframe || 'Not specified';
  const sizing = parsed.sizing || 'Not specified';
  const catalyst = parsed.catalyst || 'Not specified';
  const confidence = (parsed.confidence || 'MEDIUM').toUpperCase();
  const summary = parsed.summary || 'No summary extracted.';

  try {
    saveThesis(interaction.user.id, {
      asset, direction, timeframe, sizing, catalyst, confidence, summary, thesisDate,
    });
  } catch (err) {
    console.error('[/thesis] Failed to save thesis to store:', err);
  }

  const dirEmoji = direction === 'SHORT' ? '📉' : '📈';
  const confEmoji = confidence === 'HIGH' ? '🔴' : confidence === 'LOW' ? '🟢' : '🟡';

  const embed = new EmbedBuilder()
    .setTitle('B.O.B. Thesis — Distilled')
    .setColor(direction === 'SHORT' ? 0xef4444 : 0x22c55e)
    .addFields(
      { name: 'Date', value: thesisDate, inline: true },
      { name: 'Asset', value: asset, inline: true },
      { name: 'Direction', value: `${dirEmoji} ${direction || 'UNKNOWN'}`, inline: true },
      { name: 'Timeframe', value: timeframe, inline: true },
      { name: 'Sizing', value: sizing, inline: true },
      { name: 'Confidence', value: `${confEmoji} ${confidence}`, inline: true },
      { name: 'Catalyst', value: catalyst },
      { name: 'Summary', value: summary },
    )
    .setFooter({ text: 'Distilled from B.O.B. (jollyadvisorbot) daily thesis' });

  await interaction.editReply({ embeds: [embed] });
}

// ─── Multi-Day Aggregate Execution ───

async function executeMultiDay(interaction, channel, startDate, endDate) {
  const parsingEmbed = new EmbedBuilder()
    .setTitle('B.O.B. Thesis — Multi-Day Analysis')
    .setColor(0xf59e0b)
    .setDescription(`Scanning for B.O.B. theses from **${formatDateShort(startDate)}** to **${formatDateShort(endDate)}**...`);
  await interaction.editReply({ embeds: [parsingEmbed] });

  // Set endDate to end of day
  const endOfDay = new Date(endDate);
  endOfDay.setHours(23, 59, 59, 999);

  const theses = await findBobThesesInRange(channel, startDate, endOfDay);

  if (theses.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('B.O.B. Thesis — No Theses Found')
      .setColor(0xef4444)
      .setDescription(
        `No B.O.B. theses found between **${formatDateShort(startDate)}** and **${formatDateShort(endDate)}**.\n\n` +
        'Try expanding your date range or check that theses were posted in this channel.'
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Update status
  const analyzingEmbed = new EmbedBuilder()
    .setTitle('B.O.B. Thesis — Aggregating...')
    .setColor(0xf59e0b)
    .setDescription(`Found **${theses.length}** thesis${theses.length > 1 ? 'es' : ''}. Running aggregate analysis with LLM...`);
  await interaction.editReply({ embeds: [analyzingEmbed] });

  // Build combined thesis text for LLM
  const combinedText = theses
    .sort((a, b) => a.message.createdAt - b.message.createdAt)
    .map((t, i) => {
      const date = t.message.createdAt.toLocaleDateString('en-US', { dateStyle: 'medium' });
      return `--- THESIS ${i + 1} (${date}) ---\n${t.text}`;
    })
    .join('\n\n');

  let parsed;
  try {
    const response = await llmChat(AGGREGATE_PROMPT, combinedText, { maxTokens: 4000 });
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM did not return valid JSON');
    // Clean up common LLM JSON issues before parsing
    let jsonStr = jsonMatch[0]
      .replace(/,\s*([}\]])/g, '$1')   // remove trailing commas
      .replace(/[\x00-\x1F\x7F]/g, (c) => c === '\n' || c === '\r' || c === '\t' ? c : ''); // strip control chars
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[/thesis] Aggregate analysis failed:', err);
    const errorEmbed = new EmbedBuilder()
      .setTitle('B.O.B. Thesis — Analysis Failed')
      .setColor(0xef4444)
      .setDescription(`Failed to run aggregate analysis: ${err.message}\n\nPlease try again.`);
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  // ─── Build Embed ───
  const { assetSummary, sentimentHeatmap, aggregateView } = parsed;

  // Asset Summary section
  const assetLines = (assetSummary?.assets || [])
    .map(a => {
      const dirIcon = a.direction === 'SHORT' ? '📉' : a.direction === 'LONG' ? '📈' : '↔️';
      return `${dirIcon} **${a.ticker}** (×${a.mentions}) — ${a.brief}`;
    })
    .join('\n');
  const assetText = assetLines
    ? `${assetLines}\n\n${assetSummary?.overview || ''}`
    : assetSummary?.overview || 'No assets extracted.';

  // Sentiment Heatmap section
  const sentimentIcon = sentimentHeatmap?.overallSentiment === 'BULLISH' ? '🟢'
    : sentimentHeatmap?.overallSentiment === 'BEARISH' ? '🔴' : '🟡';
  const heatmapHeader = `${sentimentIcon} **Overall: ${sentimentHeatmap?.overallSentiment || 'UNKNOWN'}** — Bullish: ${sentimentHeatmap?.bullishCount || 0} | Bearish: ${sentimentHeatmap?.bearishCount || 0} | Neutral: ${sentimentHeatmap?.neutralCount || 0}`;
  const heatmapBreakdown = (sentimentHeatmap?.breakdown || [])
    .map(b => {
      const icon = b.sentiment === 'BULLISH' ? '🟢' : '🔴';
      return `${icon} **${b.date}** — ${b.keyAsset}: ${b.oneLiner}`;
    })
    .join('\n');
  const heatmapTheme = sentimentHeatmap?.dominantTheme ? `\n**Dominant Theme:** ${sentimentHeatmap.dominantTheme}` : '';
  const heatmapShifts = sentimentHeatmap?.keyShifts && sentimentHeatmap.keyShifts !== 'None observed'
    ? `\n**Key Shifts:** ${sentimentHeatmap.keyShifts}` : '';
  const heatmapText = `${heatmapHeader}${heatmapTheme}${heatmapShifts}\n\n${heatmapBreakdown || 'No daily breakdown available.'}`;

  // Aggregate View section
  const aggParts = [];
  if (aggregateView?.investmentStyle) aggParts.push(`**Style:** ${aggregateView.investmentStyle}`);
  if (aggregateView?.recurringThemes?.length > 0) aggParts.push(`**Recurring Themes:** ${aggregateView.recurringThemes.join(', ')}`);
  if (aggregateView?.decisionPatterns) aggParts.push(`**Decision Patterns:** ${aggregateView.decisionPatterns}`);
  if (aggregateView?.evolution) aggParts.push(`**Evolution:** ${aggregateView.evolution}`);
  const aggText = aggParts.join('\n\n') || 'No aggregate patterns extracted.';

  // Truncate fields to Discord's 1024-char limit
  const truncate = (str, max = 1024) => str.length > max ? str.slice(0, max - 3) + '...' : str;

  const embed = new EmbedBuilder()
    .setTitle(`B.O.B. Thesis — Multi-Day Analysis`)
    .setColor(sentimentHeatmap?.overallSentiment === 'BULLISH' ? 0x22c55e
      : sentimentHeatmap?.overallSentiment === 'BEARISH' ? 0xef4444 : 0xf59e0b)
    .setDescription(`**${formatDateShort(startDate)}** → **${formatDateShort(endDate)}** · ${theses.length} thesis${theses.length > 1 ? 'es' : ''} analyzed`)
    .addFields(
      { name: '📊 Asset Summary', value: truncate(assetText) },
      { name: '🌡️ Sentiment Heatmap', value: truncate(heatmapText) },
      { name: '🔍 Aggregate View', value: truncate(aggText) },
    )
    .setFooter({ text: 'Aggregated from B.O.B. (jollyadvisorbot) daily theses' });

  await interaction.editReply({ embeds: [embed] });
}

// ─── Command ───

module.exports = {
  name: 'thesis',
  description: 'Distill the latest B.O.B. thesis or analyze multiple theses over a date range.',
  needsEntries: false,
  publicReply: true,

  async execute(interaction) {
    const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId);

    const startDateStr = interaction.options.getString('start_date');
    const endDateStr = interaction.options.getString('end_date');

    // If both dates provided, run multi-day analysis
    if (startDateStr && endDateStr) {
      const startDate = parseDate(startDateStr);
      const endDate = parseDate(endDateStr);

      if (!startDate || !endDate) {
        const embed = new EmbedBuilder()
          .setTitle('B.O.B. Thesis — Invalid Date')
          .setColor(0xef4444)
          .setDescription('Please provide dates in **YYYY-MM-DD** format.\n\nExample: `/thesis start_date:2026-03-01 end_date:2026-03-10`');
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (startDate > endDate) {
        const embed = new EmbedBuilder()
          .setTitle('B.O.B. Thesis — Invalid Range')
          .setColor(0xef4444)
          .setDescription('`start_date` must be before or equal to `end_date`.');
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      await executeMultiDay(interaction, channel, startDate, endDate);
      return;
    }

    // If only one date provided, warn user
    if (startDateStr || endDateStr) {
      const embed = new EmbedBuilder()
        .setTitle('B.O.B. Thesis — Missing Date')
        .setColor(0xef4444)
        .setDescription('Both `start_date` and `end_date` are required for multi-day analysis.\n\nExample: `/thesis start_date:2026-03-01 end_date:2026-03-10`\n\nOr use `/thesis` with no dates to analyze the latest thesis.');
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Default: single latest thesis analysis
    await executeSingle(interaction, channel);
  },
};
