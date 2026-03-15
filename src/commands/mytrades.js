const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { getOpenTrades, closeTrade, getTradeByTradeId } = require('../tradeStore');
const chartCmd = require('./chart');

// Temporary storage for pending close data (screenshot attachment)
// Keyed by `${userId}_${tradeId}`, cleared after modal submit
const pendingCloses = new Map();

// Timeframe choices for chart selection (after picking a trade)
const TIMEFRAME_CHOICES = [
  { label: '1 Minute',   value: '1m',  description: '~1 hour window' },
  { label: '5 Minute',   value: '5m',  description: '~5 hour window' },
  { label: '15 Minute',  value: '15m', description: '~15 hour window' },
  { label: '30 Minute',  value: '30m', description: '~30 hour window' },
  { label: '1 Hour',     value: '1h',  description: '~2.5 day window' },
  { label: '4 Hour',     value: '4h',  description: '~10 day window' },
  { label: 'Daily',      value: '1d',  description: '~3 month window' },
  { label: 'Weekly',     value: '1w',  description: '~1 year window' },
];

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

    // Discord select menus support max 25 options; close buttons max 5 rows × 5 buttons = 25
    // We use: 1 row for chart dropdown, 1 row for close buttons (up to 5), so max ~5 close buttons visible
    // But we can show up to 25 trades in the dropdown and up to 20 close buttons (4 rows × 5)
    const tradesToShow = openTrades.slice(-25);

    let desc = `You have **${openTrades.length}** open trade${openTrades.length > 1 ? 's' : ''}.\n\n`;

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

    const rows = [];

    // Row 1: Chart dropdown select menu
    const chartOptions = tradesToShow.map(trade => {
      const dirEmoji = trade.direction?.toLowerCase() === 'long' ? '📈' : '📉';
      const date = new Date(trade.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const label = `#${trade.id} ${trade.asset} — ${trade.direction} @ ${trade.entry}`.slice(0, 100);
      const description = `${trade.timeframe}, opened ${date}`.slice(0, 100);
      return {
        label,
        value: trade.tradeId,
        description,
        emoji: dirEmoji === '📈' ? '📈' : '📉',
      };
    });

    const chartSelect = new StringSelectMenuBuilder()
      .setCustomId('mytrades_chart_select')
      .setPlaceholder('📊 Select a trade to view chart...')
      .addOptions(chartOptions);

    rows.push(new ActionRowBuilder().addComponents(chartSelect));

    // Remaining rows: Close buttons (up to 4 rows × 5 buttons = 20 trades)
    const closeTradesMax = tradesToShow.slice(0, 20);
    for (let i = 0; i < closeTradesMax.length && rows.length < 5; i += 5) {
      const row = new ActionRowBuilder();
      const chunk = closeTradesMax.slice(i, i + 5);
      for (const trade of chunk) {
        row.addComponents(
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

  // Handle trade selection from dropdown → show timeframe picker
  async handleChartSelect(interaction) {
    const userId = interaction.user.id;
    const tradeId = interaction.values[0];

    const trade = getTradeByTradeId(userId, tradeId);
    if (!trade) {
      await interaction.reply({ content: 'Trade not found.', flags: 64 });
      return;
    }
    if (trade.status === 'closed') {
      await interaction.reply({ content: 'This trade is already closed.', flags: 64 });
      return;
    }

    // Show timeframe selection menu
    const dirEmoji = trade.direction?.toLowerCase() === 'long' ? '📈' : '📉';
    const entryDate = new Date(trade.createdAt);
    const timeSinceEntry = Date.now() - entryDate.getTime();

    // Add helpful hints about which timeframes include the entry
    const options = TIMEFRAME_CHOICES.map(choice => {
      const tf = chartCmd.TIMEFRAMES[choice.value];
      const intervalMs = chartCmd.INTERVAL_MS[tf.interval] || 60 * 60 * 1000;
      const windowMs = intervalMs * tf.candles;
      const includesEntry = timeSinceEntry <= windowMs;
      const desc = includesEntry
        ? `${choice.description} ✅ includes entry`
        : `${choice.description} ⚠️ entry not visible`;
      return {
        label: choice.label,
        value: `${tradeId}_${choice.value}`,
        description: desc.slice(0, 100),
      };
    });

    const tfSelect = new StringSelectMenuBuilder()
      .setCustomId('mytrades_tf_select')
      .setPlaceholder('Select chart timeframe...')
      .addOptions(options);

    const embed = new EmbedBuilder()
      .setTitle(`📊 Chart for Trade #${trade.id}`)
      .setColor(0x3b82f6)
      .setDescription(
        `${dirEmoji} **${trade.asset}** — ${trade.direction} @ $${trade.entry}\n\n` +
        `Select a timeframe below. Wider timeframes will include your entry point on the chart.`
      );

    await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(tfSelect)],
      flags: 64,
    });
  },

  // Handle timeframe selection → generate chart with entry marker
  async handleTimeframeSelect(interaction) {
    const userId = interaction.user.id;
    const selected = interaction.values[0]; // format: tradeId_timeframe
    const lastUnderscore = selected.lastIndexOf('_');
    const tradeId = selected.slice(0, lastUnderscore);
    const timeframe = selected.slice(lastUnderscore + 1);

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

    const tf = chartCmd.TIMEFRAMES[timeframe];
    if (!tf) {
      await interaction.editReply({ content: `Invalid timeframe: ${timeframe}` });
      return;
    }

    // Determine if the entry timestamp falls within the chart window
    const entryTimestamp = new Date(trade.createdAt).getTime();
    const intervalMs = chartCmd.INTERVAL_MS[tf.interval] || 60 * 60 * 1000;
    const windowMs = intervalMs * tf.candles;
    const entryIncluded = (Date.now() - entryTimestamp) <= windowMs;

    try {
      const chartOpts = {
        entryPrice: trade.entry,
      };

      // If entry is within window, pass entryTimestamp so chart can place the dot
      if (entryIncluded) {
        chartOpts.entryTimestamp = entryTimestamp;
      }

      const { embed, file, row, buffer, displayName, tf: tfObj } = await chartCmd.generateChart(
        trade.asset,
        timeframe,
        chartOpts,
      );

      // Cache chart for AI analysis button
      chartCmd.cacheChart(interaction.channelId, buffer, displayName, tfObj.label);

      // Add trade context to embed description
      const dirEmoji = trade.direction?.toLowerCase() === 'long' ? '📈' : '📉';
      let tradeContext = `\n\n${dirEmoji} **Active Trade #${trade.id}** — ${trade.direction} @ $${trade.entry}`;
      if (!entryIncluded) {
        tradeContext += `\n⚠️ _Entry time not visible at this timeframe. Try a wider timeframe to see your entry point._`;
      }
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
