const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addTrade } = require('../tradeStore');

// Temporary storage for pre-modal data (direction + screenshot URL)
// Keyed by interaction user ID, cleared after modal submit
const pendingTrades = new Map();

module.exports = {
  name: 'trade',
  description: 'Log a trade idea with asset, direction, prices, and reasoning.',
  needsEntries: false,
  isModal: true,

  async showModal(interaction) {
    const userId = interaction.user.id;
    const direction = interaction.options.getString('direction');
    const screenshot = interaction.options.getAttachment('screenshot');

    // Store pre-modal data for retrieval on submit
    pendingTrades.set(userId, {
      direction,
      screenshotUrl: screenshot ? screenshot.url : null,
    });

    const modal = new ModalBuilder()
      .setCustomId('trade_modal')
      .setTitle(`Trade Ticket — ${direction.toUpperCase()}`);

    const assetInput = new TextInputBuilder()
      .setCustomId('asset')
      .setLabel('Asset / Ticker | Timeframe')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. BTC | 4H   or   ETH | Daily')
      .setRequired(true)
      .setMaxLength(60);

    const entryInput = new TextInputBuilder()
      .setCustomId('entry')
      .setLabel('Entry Price')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 64500')
      .setRequired(true)
      .setMaxLength(30);

    const targetInput = new TextInputBuilder()
      .setCustomId('target')
      .setLabel('Target Price')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 72000')
      .setRequired(true)
      .setMaxLength(30);

    const stopLossInput = new TextInputBuilder()
      .setCustomId('stop_loss')
      .setLabel('Stop Loss Price')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 61000')
      .setRequired(false)
      .setMaxLength(30);

    const emotionInput = new TextInputBuilder()
      .setCustomId('emotion_reasoning')
      .setLabel('Emotion (1-10) & Reasoning')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('e.g. 7/10 confident — breakout above resistance with strong volume')
      .setRequired(true)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder().addComponents(assetInput),
      new ActionRowBuilder().addComponents(entryInput),
      new ActionRowBuilder().addComponents(targetInput),
      new ActionRowBuilder().addComponents(stopLossInput),
      new ActionRowBuilder().addComponents(emotionInput),
    );

    await interaction.showModal(modal);
  },

  async handleSubmit(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const assetRaw = interaction.fields.getTextInputValue('asset');
    const entry = interaction.fields.getTextInputValue('entry');
    const target = interaction.fields.getTextInputValue('target');
    const stopLoss = interaction.fields.getTextInputValue('stop_loss') || null;
    const emotionReasoning = interaction.fields.getTextInputValue('emotion_reasoning');

    // Parse "Asset | Timeframe" from combined field
    const parts = assetRaw.split('|').map(s => s.trim());
    const asset = parts[0];
    const timeframe = parts[1] || 'Not specified';

    // Retrieve pre-modal data
    const pending = pendingTrades.get(userId) || {};
    pendingTrades.delete(userId);

    const direction = pending.direction || 'Long';
    const screenshotUrl = pending.screenshotUrl || null;

    // Determine if price move is up or down based on direction
    const directionEmoji = direction.toLowerCase() === 'long' ? '📈' : '📉';

    // Save to store
    const trade = addTrade(userId, {
      asset,
      direction,
      entry,
      target,
      stopLoss,
      timeframe,
      emotionReasoning,
      screenshotUrl,
      username,
    });

    console.log(`[/trade] ${username} logged trade #${trade.id}: ${direction} ${asset} @ ${entry} → ${target}`);

    // Build the public trade ticket embed
    const embed = new EmbedBuilder()
      .setTitle(`TRADE TICKET #${trade.id}`)
      .setColor(direction.toLowerCase() === 'long' ? 0x22c55e : 0xef4444);

    let desc = '';
    desc += `**Trade ID:** \`${trade.tradeId}\`\n`;
    desc += `**Trader:** ${username}\n`;
    desc += `**Asset:** ${asset}\n`;
    desc += `**Direction:** ${directionEmoji} ${direction.toUpperCase()}\n`;
    desc += `**Entry:** ${entry}\n`;
    desc += `**Target:** ${target}\n`;
    if (stopLoss) desc += `**Stop Loss:** ${stopLoss}\n`;
    desc += `**Timeframe:** ${timeframe}\n\n`;
    desc += `**Emotion & Reasoning:**\n${emotionReasoning}\n\n`;
    desc += `**Logged:** ${new Date(trade.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;

    if (screenshotUrl) {
      desc += `\n\n**Chart:** ${screenshotUrl}`;
    }

    embed.setDescription(desc);

    // Button to launch LLM analysis linked to this trade
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`trade_llma_${trade.tradeId}`)
        .setLabel('Run LLM Analysis')
        .setEmoji('🔍')
        .setStyle(ButtonStyle.Primary),
    );

    // Post as a PUBLIC message in the channel (not ephemeral)
    await interaction.reply({ embeds: [embed], components: [row] });
  },

  pendingTrades,
};
