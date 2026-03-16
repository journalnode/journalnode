const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const {
  addWallet,
  removeWallet,
  renameWallet,
  getUserWallets,
  getActiveWallets,
  getWalletById,
  getWalletByAddress,
} = require('../hyperliquidStore');
const { initializeUserPositions, fetchPositions } = require('../hyperliquidPoller');

// Validate Ethereum-style address (0x + 40 hex chars)
function isValidAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function truncateAddress(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

module.exports = {
  name: 'hyperliquid',
  description: 'Manage Hyperliquid wallets for automatic trade tracking on the Journal Node.',
  needsEntries: false,
  isModal: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      await this.handleAdd(interaction, userId, username);
    } else if (subcommand === 'remove') {
      await this.handleRemove(interaction, userId, username);
    } else if (subcommand === 'rename') {
      await this.handleRename(interaction, userId, username);
    } else if (subcommand === 'wallets') {
      await this.handleWallets(interaction, userId, username);
    } else if (subcommand === 'status') {
      await this.handleStatus(interaction, userId, username);
    }
  },

  async handleAdd(interaction, userId, username) {
    const wallet = interaction.options.getString('wallet');
    // Auto-generate unique default label if none provided
    let label = interaction.options.getString('label');
    if (!label) {
      const existing = getUserWallets(userId);
      if (existing.length === 0) {
        label = 'Main';
      } else {
        label = `Wallet ${existing.length + 1}`;
      }
    }

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

    // Check for duplicate address
    const existing = getWalletByAddress(userId, wallet);
    if (existing) {
      const errorEmbed = new EmbedBuilder()
        .setTitle('Wallet Already Connected')
        .setColor(0xf59e0b)
        .setDescription(
          `This wallet is already linked as **"${existing.label}"**.\n\n` +
          `Address: \`${wallet}\`\n\n` +
          `Use \`/hyperliquid rename\` to change its label, or \`/hyperliquid remove\` to remove it first.`
        );
      await interaction.editReply({ embeds: [errorEmbed] });
      return;
    }

    // Max 10 wallets per user
    const currentWallets = getUserWallets(userId);
    if (currentWallets.length >= 10) {
      const errorEmbed = new EmbedBuilder()
        .setTitle('Wallet Limit Reached')
        .setColor(0xef4444)
        .setDescription('You can have up to **10** wallets connected. Remove a wallet before adding a new one.');
      await interaction.editReply({ embeds: [errorEmbed] });
      return;
    }

    const channelId = interaction.channelId;
    const entry = addWallet(userId, wallet, label, channelId);

    // Initialize poller with current positions so it doesn't alert on existing ones
    let existingCount = 0;
    try {
      existingCount = await initializeUserPositions(`${userId}_${entry.id}`, wallet);
    } catch (err) {
      console.error(`[/hyperliquid] Failed to initialize positions:`, err.message);
    }

    console.log(`[/hyperliquid] ${username} added wallet "${label}" ${wallet} (${existingCount} existing positions)`);

    const walletCount = getUserWallets(userId).length;
    const embed = new EmbedBuilder()
      .setTitle('Hyperliquid Wallet Added')
      .setColor(0x22c55e)
      .setDescription(
        `A new wallet has been linked to Journal Node.\n\n` +
        `**Label:** ${label}\n` +
        `**Wallet:** \`${wallet}\`\n` +
        `**Notification Channel:** <#${channelId}>\n` +
        `**Existing Positions:** ${existingCount}\n` +
        `**Total Wallets:** ${walletCount}\n\n` +
        `The bot will now monitor this wallet every 30 seconds. ` +
        `When you open a new position, a trade notification will automatically appear in this channel ` +
        `with the wallet label **"${label}"** visible on every trade ticket.\n\n` +
        `Use \`/hyperliquid wallets\` to view all connected wallets.`
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },

  async handleRemove(interaction, userId, username) {
    const wallets = getUserWallets(userId);
    if (wallets.length === 0) {
      await interaction.editReply({
        content: 'You don\'t have any Hyperliquid wallets linked. Use `/hyperliquid add` to add one.',
      });
      return;
    }

    // If only one wallet, remove it directly
    if (wallets.length === 1) {
      const w = wallets[0];
      removeWallet(userId, w.id);
      console.log(`[/hyperliquid] ${username} removed wallet "${w.label}"`);

      const embed = new EmbedBuilder()
        .setTitle('Hyperliquid Wallet Removed')
        .setColor(0xf59e0b)
        .setDescription(
          `Your wallet **"${w.label}"** has been unlinked.\n\n` +
          `**Address:** \`${w.wallet}\`\n\n` +
          `Trade monitoring has stopped. Existing trade tickets remain in \`/mytrades\`.\n\n` +
          `Use \`/hyperliquid add\` to add a wallet.`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Multiple wallets — show dropdown with full address in description to distinguish
    const options = wallets.map(w => ({
      label: `${w.label} — ${truncateAddress(w.wallet)}`.slice(0, 100),
      value: w.id,
      description: `${w.wallet}`.slice(0, 100),
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('hl_remove_wallet')
      .setPlaceholder('Select a wallet to remove...')
      .addOptions(options);

    const embed = new EmbedBuilder()
      .setTitle('Remove a Wallet')
      .setColor(0xf59e0b)
      .setDescription('Select the wallet you want to disconnect from Journal Node.');

    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },

  async handleRename(interaction, userId, username) {
    const newLabel = interaction.options.getString('label');
    const wallets = getUserWallets(userId);

    if (wallets.length === 0) {
      await interaction.editReply({
        content: 'You don\'t have any Hyperliquid wallets linked. Use `/hyperliquid add` to add one.',
      });
      return;
    }

    // If only one wallet, rename it directly
    if (wallets.length === 1) {
      const oldLabel = wallets[0].label;
      renameWallet(userId, wallets[0].id, newLabel);
      console.log(`[/hyperliquid] ${username} renamed wallet "${oldLabel}" → "${newLabel}"`);

      const embed = new EmbedBuilder()
        .setTitle('Wallet Renamed')
        .setColor(0x3b82f6)
        .setDescription(
          `**"${oldLabel}"** has been renamed to **"${newLabel}"**.\n\n` +
          `Address: \`${wallets[0].wallet}\`\n\n` +
          `Future trade notifications from this wallet will display the new label.`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Multiple wallets — show dropdown with enough address to distinguish them
    const options = wallets.map(w => ({
      label: `${w.label} — ${truncateAddress(w.wallet)}`.slice(0, 100),
      value: `${w.id}_RENLBL_${newLabel}`,
      description: `${w.wallet}`.slice(0, 100),
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('hl_rename_wallet')
      .setPlaceholder('Select wallet to rename...')
      .addOptions(options);

    const embed = new EmbedBuilder()
      .setTitle(`Rename to "${newLabel}"`)
      .setColor(0x3b82f6)
      .setDescription('Select the wallet you want to relabel.');

    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },

  async handleWallets(interaction, userId, username) {
    const wallets = getUserWallets(userId);

    if (wallets.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('No Wallets Connected')
        .setColor(0x6b7280)
        .setDescription(
          'You have no Hyperliquid wallets linked to Journal Node.\n\n' +
          'Use `/hyperliquid add` to connect your first wallet.'
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    let desc = `You have **${wallets.length}** connected wallet${wallets.length > 1 ? 's' : ''}.\n\n`;

    for (let i = 0; i < wallets.length; i++) {
      const w = wallets[i];
      const linked = new Date(w.linkedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const statusIcon = w.active ? '🟢' : '🔴';
      desc += `${statusIcon} **${i + 1}. ${w.label}**\n`;
      desc += `Address: \`${w.wallet}\`\n`;
      desc += `Channel: <#${w.channelId}> • Linked: ${linked}\n\n`;
    }

    desc += '_Use `/hyperliquid add` to add a wallet, `/hyperliquid remove` to disconnect one, or `/hyperliquid rename` to relabel._';

    const embed = new EmbedBuilder()
      .setTitle('Your Hyperliquid Wallets')
      .setColor(0x3b82f6)
      .setDescription(desc)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },

  async handleStatus(interaction, userId, username) {
    const wallets = getActiveWallets(userId);
    if (wallets.length === 0) {
      await interaction.editReply({
        content: 'No active Hyperliquid wallets. Use `/hyperliquid add` to get started.',
      });
      return;
    }

    let desc = '';

    for (const w of wallets) {
      const linkedDate = new Date(w.linkedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

      // Fetch current positions for this wallet
      let positions = [];
      try {
        positions = await fetchPositions(w.wallet);
      } catch (err) {
        console.error(`[/hyperliquid] Failed to fetch positions for ${w.label}:`, err.message);
      }

      desc += `**📋 ${w.label}**\n`;
      desc += `Wallet: \`${w.wallet}\`\n`;
      desc += `Channel: <#${w.channelId}> • Linked: ${linkedDate}\n`;

      if (positions.length === 0) {
        desc += 'No open positions.\n\n';
      } else {
        desc += `**Open Positions (${positions.length}):**\n`;
        for (const p of positions) {
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
          desc += `${dirEmoji} **${p.coin}** — ${direction} ${absSize} @ $${entryPx.toLocaleString()} ${pnlEmoji} ${pnlStr}\n`;
        }
        desc += '\n';
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('Hyperliquid Integration Status')
      .setColor(0x3b82f6)
      .setDescription(desc.slice(0, 4090))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },

  // Handle dropdown interactions for remove/rename
  async handleWalletSelect(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const customId = interaction.customId;
    const selected = interaction.values[0];

    if (customId === 'hl_remove_wallet') {
      const walletEntry = getWalletById(userId, selected);
      if (!walletEntry) {
        await interaction.reply({ content: 'Wallet not found.', flags: 64 });
        return;
      }

      removeWallet(userId, selected);
      console.log(`[/hyperliquid] ${username} removed wallet "${walletEntry.label}"`);

      const embed = new EmbedBuilder()
        .setTitle('Hyperliquid Wallet Removed')
        .setColor(0xf59e0b)
        .setDescription(
          `Wallet **"${walletEntry.label}"** has been unlinked.\n\n` +
          `**Address:** \`${walletEntry.wallet}\`\n\n` +
          `Trade monitoring has stopped for this wallet. Existing trade tickets remain in \`/mytrades\`.`
        )
        .setTimestamp();

      await interaction.update({ embeds: [embed], components: [] });
    } else if (customId === 'hl_rename_wallet') {
      // Value format: walletId_RENLBL_newLabel
      const sepIdx = selected.indexOf('_RENLBL_');
      const walletId = selected.slice(0, sepIdx);
      const newLabel = selected.slice(sepIdx + 8);

      const walletEntry = getWalletById(userId, walletId);
      if (!walletEntry) {
        await interaction.reply({ content: 'Wallet not found.', flags: 64 });
        return;
      }

      const oldLabel = walletEntry.label;
      renameWallet(userId, walletId, newLabel);
      console.log(`[/hyperliquid] ${username} renamed wallet "${oldLabel}" → "${newLabel}"`);

      const embed = new EmbedBuilder()
        .setTitle('Wallet Renamed')
        .setColor(0x3b82f6)
        .setDescription(
          `**"${oldLabel}"** has been renamed to **"${newLabel}"**.\n\n` +
          `Address: \`${walletEntry.wallet}\`\n\n` +
          `Future trade notifications from this wallet will display the new label.`
        )
        .setTimestamp();

      await interaction.update({ embeds: [embed], components: [] });
    }
  },
};
