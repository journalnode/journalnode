const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
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
      .setLabel('Asset / Ticker')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. BTC, ETH, AAPL, XRP/USD')
      .setRequired(true)
      .setMaxLength(50);

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

    const timeframeInput = new TextInputBuilder()
      .setCustomId('timeframe')
      .setLabel('Timeframe')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 4H, Daily, Swing, 1W')
      .setRequired(true)
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
      new ActionRowBuilder().addComponents(timeframeInput),
      new ActionRowBuilder().addComponents(emotionInput),
    );

    await interaction.showModal(modal);
  },

  async handleSubmit(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const asset = interaction.fields.getTextInputValue('asset');
    const entry = interaction.fields.getTextInputValue('entry');
    const target = interaction.fields.getTextInputValue('target');
    const timeframe = interaction.fields.getTextInputValue('timeframe');
    const emotionReasoning = interaction.fields.getTextInputValue('emotion_reasoning');

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
      timeframe,
      emotionReasoning,
      screenshotUrl,
      username,
    });

    console.log(`[/trade] ${username} logged trade #${trade.id}: ${direction} ${asset} @ ${entry} → ${target}`);

    // Build the public trade ticket message
    const lines = [
      `**━━━ TRADE TICKET #${trade.id} ━━━**`,
      '',
      `**Trader:** ${username}`,
      `**Asset:** ${asset}`,
      `**Direction:** ${directionEmoji} ${direction.toUpperCase()}`,
      `**Entry:** ${entry}`,
      `**Target:** ${target}`,
      `**Timeframe:** ${timeframe}`,
      '',
      `**Emotion & Reasoning:**`,
      emotionReasoning,
      '',
      `**Logged:** ${new Date(trade.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
    ];

    if (screenshotUrl) {
      lines.push('');
      lines.push(`**Chart:** ${screenshotUrl}`);
    }

    lines.push('**━━━━━━━━━━━━━━━━━━━━━━━━━━━**');

    // Post as a PUBLIC message in the channel (not ephemeral)
    await interaction.reply(lines.join('\n'));
  },

  pendingTrades,
};
