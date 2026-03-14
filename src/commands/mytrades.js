const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getOpenTrades, closeTrade, getTradeByTradeId } = require('../tradeStore');
const chartCmd = require('./chart');

// Temporary storage for pending close data (screenshot attachment)
// Keyed by `${userId}_${tradeId}`, cleared after modal submit
const pendingCloses = new Map();

// Map trade timeframes (e.g. "4H", "1D", "15M") to chart timeframes
const TIMEFRAME_MAP = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '8h': '8h', '12h': '12h',
  '1d': '1d', '3d': '3d', '1w': '1w', '1m': '1m',
};

function resolveChartTimeframe(tradeTimeframe) {
  if (!tradeTimeframe) return '1d';
  const normalized = tradeTimeframe.toLowerCase().trim();
  // Direct match
  if (chartCmd.TIMEFRAMES[normalized]) return normalized;
  // Try common variations
  if (TIMEFRAME_MAP[normalized]) return TIMEFRAME_MAP[normalized];
  // Try stripping spaces and matching
  const stripped = normalized.replace(/\s+/g, '');
  if (chartCmd.TIMEFRAMES[stripped]) return stripped;
  // Default
  return '1d';
}

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

    // With 2 buttons per trade (Chart + Close), we can fit 2 trades per row (4 buttons)
    // 5 rows max = 10 trades visible
    const tradesToShow = openTrades.slice(-10);

    for (const trade of tradesToShow) {
      const dirEmoji = trade.direction?.toLowerCase() === 'long' ? '📈' : '📉';
      const date = new Date(trade.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      desc += `**#${trade.id}** ${dirEmoji} **${trade.asset}** — ${trade.direction} @ ${trade.entry} → ${trade.target} _(${trade.timeframe}, ${date})_\n`;
      desc += `\`ID: ${trade.tradeId}\`\n\n`;
    }

    if (openTrades.length > 10) {
      desc += `_...and ${openTrades.length - 10} more. Close some trades to see older ones._\n`;
    }

    embed.setDescription(desc);

    // Build action rows with Chart + Close button pairs (2 trades per row, max 5 rows)
    const rows = [];
    for (let i = 0; i < tradesToShow.length && rows.length < 5; i += 2) {
      const row = new ActionRowBuilder();
      const chunk = tradesToShow.slice(i, i + 2);
      for (const trade of chunk) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`view_chart_${trade.tradeId}`)
            .setLabel(`📊 #${trade.id} ${trade.asset}`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`close_trade_${trade.tradeId}`)
            .setLabel(`Close #${trade.id}`)
            .setStyle(ButtonStyle.Danger),
        );
      }
      rows.push(row);
    }

    await interaction.editReply({ embeds: [embed], components: rows });
  },

  async handleChartButton(interaction) {
    const tradeId = interaction.customId.replace('view_chart_', '');
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

    await interaction.deferReply();

    const timeframe = resolveChartTimeframe(trade.timeframe);

    try {
      const { embed, file, row, buffer, displayName, tf } = await chartCmd.generateChart(
        trade.asset,
        timeframe,
        { entryPrice: trade.entry },
      );

      // Cache chart for AI analysis button
      chartCmd.cacheChart(interaction.channelId, buffer, displayName, tf.label);

      // Add trade context to the embed description
      const dirEmoji = trade.direction?.toLowerCase() === 'long' ? '📈' : '📉';
      const entryVal = parseFloat(trade.entry);
      const currentVal = parseFloat(embed.data.title.match(/\$[\d,.]+/)?.[0]?.replace(/[$,]/g, '') || '0');
      const tradeContext = `\n\n${dirEmoji} **Active Trade #${trade.id}** — ${trade.direction} @ $${trade.entry}`;
      const existingDesc = embed.data.description || '';
      embed.setDescription(existingDesc + tradeContext);

      await interaction.editReply({ embeds: [embed], files: [file], components: [row] });
    } catch (err) {
      console.error(`[/mytrades] Chart for trade #${trade.id} (${trade.asset}) failed:`, err.message);
      const errorEmbed = new EmbedBuilder()
        .setTitle('Chart Error')
        .setColor(0xef4444)
        .setDescription(
          `Could not load chart for **${trade.asset}** (${timeframe}).\n\n${err.message}`
        );
      await interaction.editReply({ embeds: [errorEmbed] });
    }
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
