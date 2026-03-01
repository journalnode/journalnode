const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getOpenTrades, closeTrade, getTradeByTradeId } = require('../tradeStore');

// Temporary storage for pending close data (screenshot attachment)
// Keyed by `${userId}_${tradeId}`, cleared after modal submit
const pendingCloses = new Map();

module.exports = {
  name: 'mytrades',
  description: 'View your active trade tickets and close positions with a post-mortem.',
  needsEntries: false,
  isModal: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const openTrades = getOpenTrades(userId);

    if (openTrades.length === 0) {
      await interaction.editReply({
        content: 'You have no open trades. Use `/trade` to log a new trade idea.',
      });
      return;
    }

    // Build embed listing open trades
    const embed = new EmbedBuilder()
      .setTitle('YOUR ACTIVE TRADES')
      .setColor(0x3b82f6);

    let desc = `You have **${openTrades.length}** open trade${openTrades.length > 1 ? 's' : ''}.\n\n`;

    // Show up to 25 trades (5 action rows x 5 buttons max)
    const tradesToShow = openTrades.slice(-25);

    for (const trade of tradesToShow) {
      const dirEmoji = trade.direction?.toLowerCase() === 'long' ? '📈' : '📉';
      const date = new Date(trade.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      desc += `**#${trade.id}** ${dirEmoji} **${trade.asset}** — ${trade.direction} @ ${trade.entry} → ${trade.target} _(${trade.timeframe}, ${date})_\n`;
      desc += `\`ID: ${trade.tradeId}\`\n\n`;
    }

    if (openTrades.length > 25) {
      desc += `_...and ${openTrades.length - 25} more. Close some trades to see older ones._\n`;
    }

    embed.setDescription(desc);

    // Build action rows with Close buttons (max 5 buttons per row, max 5 rows)
    const rows = [];
    for (let i = 0; i < tradesToShow.length && rows.length < 5; i += 5) {
      const row = new ActionRowBuilder();
      const chunk = tradesToShow.slice(i, i + 5);
      for (const trade of chunk) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`close_trade_${trade.tradeId}`)
            .setLabel(`Close #${trade.id} ${trade.asset}`)
            .setStyle(ButtonStyle.Danger),
        );
      }
      rows.push(row);
    }

    await interaction.editReply({ embeds: [embed], components: rows });
  },

  async handleCloseButton(interaction) {
    const tradeId = interaction.customId.replace('close_trade_', '');
    const userId = interaction.user.id;

    const trade = getTradeByTradeId(userId, tradeId);
    if (!trade) {
      await interaction.reply({ content: 'Trade not found.', flags: 64 });
      return;
    }
    if (trade.status === 'closed') {
      await interaction.reply({ content: 'This trade is already closed.', flags: 64 });
      return;
    }

    // Show modal to capture close data
    const modal = new ModalBuilder()
      .setCustomId(`close_trade_modal_${tradeId}`)
      .setTitle(`Close Trade #${trade.id} — ${trade.asset}`);

    const outcomeInput = new TextInputBuilder()
      .setCustomId('outcome')
      .setLabel('Outcome (Win or Loss)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Win or Loss')
      .setRequired(true)
      .setMaxLength(10);

    const exitPriceInput = new TextInputBuilder()
      .setCustomId('exit_price')
      .setLabel('Exit Price')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 72500')
      .setRequired(false)
      .setMaxLength(30);

    const reflectionInput = new TextInputBuilder()
      .setCustomId('reflection')
      .setLabel('Post-Mortem Reflection')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('What went right or wrong? What would you do differently?')
      .setRequired(true)
      .setMaxLength(1000);

    const screenshotInput = new TextInputBuilder()
      .setCustomId('screenshot_url')
      .setLabel('Screenshot URL (optional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Paste an image URL or leave blank')
      .setRequired(false)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder().addComponents(outcomeInput),
      new ActionRowBuilder().addComponents(exitPriceInput),
      new ActionRowBuilder().addComponents(reflectionInput),
      new ActionRowBuilder().addComponents(screenshotInput),
    );

    await interaction.showModal(modal);
  },

  async handleCloseSubmit(interaction) {
    const customId = interaction.customId;
    const tradeId = customId.replace('close_trade_modal_', '');
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const trade = getTradeByTradeId(userId, tradeId);
    if (!trade) {
      await interaction.reply({ content: 'Trade not found.', flags: 64 });
      return;
    }
    if (trade.status === 'closed') {
      await interaction.reply({ content: 'This trade is already closed.', flags: 64 });
      return;
    }

    // Parse modal fields
    const rawOutcome = interaction.fields.getTextInputValue('outcome').trim();
    const exitPrice = interaction.fields.getTextInputValue('exit_price').trim();
    const reflection = interaction.fields.getTextInputValue('reflection').trim();
    const screenshotUrl = interaction.fields.getTextInputValue('screenshot_url').trim();

    // Normalize outcome to Win or Loss
    const outcomeLower = rawOutcome.toLowerCase();
    let outcome;
    if (outcomeLower.startsWith('w')) {
      outcome = 'Win';
    } else if (outcomeLower.startsWith('l')) {
      outcome = 'Loss';
    } else {
      await interaction.reply({
        content: 'Invalid outcome. Please enter **Win** or **Loss**.',
        flags: 64,
      });
      return;
    }

    // Close the trade
    const closed = closeTrade(userId, tradeId, {
      outcome,
      exitPrice: exitPrice || null,
      reflection,
      closeScreenshotUrl: screenshotUrl || null,
    });

    console.log(`[/mytrades] ${username} closed trade #${closed.id} (${closed.asset}) — ${outcome}`);

    // Build confirmation embed
    const outcomeEmoji = outcome === 'Win' ? '✅' : '❌';
    const dirEmoji = closed.direction?.toLowerCase() === 'long' ? '📈' : '📉';
    const embed = new EmbedBuilder()
      .setTitle(`TRADE CLOSED ${outcomeEmoji} — #${closed.id}`)
      .setColor(outcome === 'Win' ? 0x22c55e : 0xef4444);

    let desc = '';
    desc += `**Trade ID:** \`${closed.tradeId}\`\n`;
    desc += `**Trader:** ${username}\n`;
    desc += `**Asset:** ${closed.asset}\n`;
    desc += `**Direction:** ${dirEmoji} ${closed.direction.toUpperCase()}\n`;
    desc += `**Entry:** ${closed.entry}\n`;
    if (exitPrice) {
      desc += `**Exit:** ${exitPrice}\n`;
    }
    desc += `**Target:** ${closed.target}\n`;
    desc += `**Timeframe:** ${closed.timeframe}\n\n`;
    desc += `**Outcome:** ${outcomeEmoji} **${outcome.toUpperCase()}**\n\n`;
    desc += `**Post-Mortem Reflection:**\n${reflection}\n\n`;
    desc += `**Opened:** ${new Date(closed.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}\n`;
    desc += `**Closed:** ${new Date(closed.closedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;

    if (screenshotUrl) {
      desc += `\n\n**Screenshot:** ${screenshotUrl}`;
    }

    embed.setDescription(desc);

    // Post as public message so others can see the close
    await interaction.reply({ embeds: [embed] });
  },
};
