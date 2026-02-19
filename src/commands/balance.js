const { getBalance } = require('../wallet');
const { getUserWallets } = require('../walletStore');

module.exports = {
  name: 'balance',
  description: 'Check PFT balance for all your wallets.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const user = getUserWallets(userId);

    if (user.wallets.length === 0) {
      await interaction.editReply(
        'You have no wallets yet. Use `/postfiat` to create your first wallet.'
      );
      return;
    }

    const lines = ['**Your PFT Balances**\n'];

    for (const w of user.wallets) {
      const isActive = w.address === user.activeAddress;
      const label = isActive ? ' **(active)**' : '';
      try {
        const balance = await getBalance(w.address);
        if (balance === null) {
          lines.push(`\`${w.address}\`${label}\nBalance: Not activated on-chain\n`);
        } else {
          lines.push(`\`${w.address}\`${label}\nBalance: **${balance} PFT**\n`);
        }
      } catch (err) {
        lines.push(`\`${w.address}\`${label}\nBalance: Error — ${err.message}\n`);
      }
    }

    await interaction.editReply(lines.join('\n'));
  },
};
