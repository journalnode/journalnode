const { getUserWallets } = require('../walletStore');

module.exports = {
  name: 'receive',
  description: 'Show your wallet address(es) in a copyable format.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const user = getUserWallets(userId);

    if (!user || user.wallets.length === 0) {
      await interaction.editReply('You don\'t have any wallets yet. Use `/postfiat` to create one.');
      return;
    }

    const lines = ['**Your Wallet Address(es)**\n'];

    for (const w of user.wallets) {
      const label = w.address === user.activeAddress ? ' (active)' : '';
      lines.push(`${label ? '**Active:**' : 'Wallet:'}`);
      lines.push(`\`\`\`${w.address}\`\`\``);
    }

    await interaction.editReply(lines.join('\n'));
  },
};
