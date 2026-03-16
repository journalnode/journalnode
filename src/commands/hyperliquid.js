const { EmbedBuilder } = require('discord.js');
const { linkWallet, unlinkWallet, getLinkedWallet } = require('../hyperliquidStore');
const { initializeUserPositions, fetchPositions } = require('../hyperliquidPoller');

// Validate Ethereum-style address (0x + 40 hex chars)
function isValidAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

module.exports = {
  name: 'hyperliquid',
  description: 'Connect your Hyperliquid wallet to auto-track trades on the Journal Node.',
  needsEntries: false,
  isModal: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'connect') {
      const wallet = interaction.options.getString('wallet');

      if (!isValidAddress(wallet)) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('Invalid Wallet Address')
          .setColor(0xef4444)
          .setDescription(
            'Please provide a valid Ethereum-style address (0x followed by 40 hex characters).\n\n' +
            'Example: `0x1234567890abcdef1234567890abcdef12345678`\n\n' +
            '**Tip:** This is your Hyperliquid wallet address, not your seed phrase or API key.'
          );
        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      const channelId = interaction.channelId;
      linkWallet(userId, wallet, channelId);

      // Initialize poller with current positions so it doesn't alert on existing ones
      let existingCount = 0;
      try {
        existingCount = await initializeUserPositions(userId, wallet);
      } catch (err) {
        console.error(`[/hyperliquid] Failed to initialize positions:`, err.message);
      }

      console.log(`[/hyperliquid] ${username} linked wallet ${wallet} (${existingCount} existing positions)`);

      const embed = new EmbedBuilder()
        .setTitle('Hyperliquid Wallet Connected')
        .setColor(0x22c55e)
        .setDescription(
          `Your Hyperliquid wallet has been linked to Journal Node.\n\n` +
          `**Wallet:** \`${wallet}\`\n` +
          `**Notification Channel:** <#${channelId}>\n` +
          `**Existing Positions:** ${existingCount}\n\n` +
          `The bot will now monitor your Hyperliquid account every 30 seconds. ` +
          `When you open a new position, a trade notification will automatically appear in this channel ` +
          `and be logged as a trade ticket accessible via \`/mytrades\`.\n\n` +
          `Use \`/hyperliquid disconnect\` to stop monitoring.`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else if (subcommand === 'disconnect') {
      const existing = getLinkedWallet(userId);
      if (!existing) {
        await interaction.editReply({
          content: 'You don\'t have a Hyperliquid wallet linked. Use `/hyperliquid connect` to link one.',
        });
        return;
      }

      unlinkWallet(userId);
      console.log(`[/hyperliquid] ${username} disconnected wallet`);

      const embed = new EmbedBuilder()
        .setTitle('Hyperliquid Wallet Disconnected')
        .setColor(0xf59e0b)
        .setDescription(
          'Your Hyperliquid wallet has been unlinked from Journal Node.\n\n' +
          'Trade monitoring has stopped. Your existing trade tickets from Hyperliquid will remain in `/mytrades`.\n\n' +
          'Use `/hyperliquid connect` to link a wallet again.'
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else if (subcommand === 'status') {
      const existing = getLinkedWallet(userId);
      if (!existing) {
        await interaction.editReply({
          content: 'No Hyperliquid wallet linked. Use `/hyperliquid connect` to get started.',
        });
        return;
      }

      // Fetch current positions for status display
      let positions = [];
      try {
        positions = await fetchPositions(existing.wallet);
      } catch (err) {
        console.error(`[/hyperliquid] Failed to fetch positions for status:`, err.message);
      }

      const linkedDate = new Date(existing.linkedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

      let positionSummary = 'No open positions.';
      if (positions.length > 0) {
        const lines = positions.map(p => {
          const size = parseFloat(p.szi);
          const direction = size > 0 ? 'Long' : 'Short';
          const dirEmoji = direction === 'Long' ? '📈' : '📉';
          const absSize = Math.abs(size);
          const entryPx = parseFloat(p.entryPx);
          const unrealizedPnl = p.unrealizedPnl ? parseFloat(p.unrealizedPnl) : 0;
          const pnlEmoji = unrealizedPnl >= 0 ? '🟢' : '🔴';
          const pnlStr = unrealizedPnl >= 0
            ? `+$${unrealizedPnl.toFixed(2)}`
            : `-$${Math.abs(unrealizedPnl).toFixed(2)}`;
          return `${dirEmoji} **${p.coin}** — ${direction} ${absSize} @ $${entryPx.toLocaleString()} ${pnlEmoji} ${pnlStr}`;
        });
        positionSummary = lines.join('\n');
      }

      const embed = new EmbedBuilder()
        .setTitle('Hyperliquid Integration Status')
        .setColor(0x3b82f6)
        .setDescription(
          `**Wallet:** \`${existing.wallet}\`\n` +
          `**Notification Channel:** <#${existing.channelId}>\n` +
          `**Linked Since:** ${linkedDate}\n\n` +
          `**Open Positions (${positions.length}):**\n${positionSummary}`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },
};
