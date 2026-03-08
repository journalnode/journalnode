const { EmbedBuilder } = require('discord.js');
const { chat: llmChat } = require('../openrouter');

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

// ─── Distillation Prompt ───

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

// ─── Command ───

module.exports = {
  name: 'thesis',
  description: 'Distill the latest B.O.B. thesis into structured data (Asset, Direction, Timeframe, Sizing).',
  needsEntries: false,

  async execute(interaction) {
    const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId);

    // Find B.O.B. thesis
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

    // Show parsing state
    const parsingEmbed = new EmbedBuilder()
      .setTitle('B.O.B. Thesis — Distilling...')
      .setColor(0xf59e0b)
      .setDescription('Extracting structured data from thesis with LLM...');
    await interaction.editReply({ embeds: [parsingEmbed] });

    // Extract date from thesis text
    const dateMatch = thesisText.match(/(?:Daily\s+)?Thesis\s*[—–\-]\s*(.+?)(?:\n|\*)/i);
    const thesisDate = dateMatch
      ? dateMatch[1].trim()
      : thesisMsg.createdAt.toLocaleDateString('en-US', { dateStyle: 'medium' });

    // LLM distillation
    let parsed;
    try {
      const response = await llmChat(DISTILL_PROMPT, thesisText);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('LLM did not return valid JSON');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('[/thesis] Distillation failed:', err);
      const errorEmbed = new EmbedBuilder()
        .setTitle('B.O.B. Thesis — Distillation Failed')
        .setColor(0xef4444)
        .setDescription(`Failed to extract structured data: ${err.message}\n\nPlease try again.`);
      await interaction.editReply({ embeds: [errorEmbed] });
      return;
    }

    // Validate required fields
    const asset = parsed.asset || 'Unknown';
    const direction = (parsed.direction || '').toUpperCase();
    const timeframe = parsed.timeframe || 'Not specified';
    const sizing = parsed.sizing || 'Not specified';
    const catalyst = parsed.catalyst || 'Not specified';
    const confidence = (parsed.confidence || 'MEDIUM').toUpperCase();
    const summary = parsed.summary || 'No summary extracted.';

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
  },
};
