const { sendPFT } = require('../wallet');
const { getActiveWallet, getWalletSeed } = require('../walletStore');

module.exports = {
  name: 'send',
  description: 'Send PFT to an address from your active wallet.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const destination = interaction.options.getString('destination');
    const amount = interaction.options.getString('amount');
    const memo = interaction.options.getString('memo');

    // Check user has an active wallet
    const active = getActiveWallet(userId);
    if (!active) {
      await interaction.editReply(
        'You don\'t have an active wallet. Use `/postfiat` to create one, or `/wallets import` to import an existing wallet.'
      );
      return;
    }

    // Validate amount
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      await interaction.editReply('Invalid amount. Please enter a positive number.');
      return;
    }

    console.log(`[/send] ${username} sending ${amount} PFT to ${destination}${memo ? ` memo: "${memo}"` : ''}`);

    // Get the seed for signing
    const seed = getWalletSeed(userId, active.address);
    if (!seed) {
      await interaction.editReply('Could not retrieve your wallet credentials. Try `/wallets set-active` to reset.');
      return;
    }

    try {
      const result = await sendPFT(seed, destination, amount, memo);

      const lines = [
        '**Transaction confirmed!**\n',
        `**From:** \`${result.from}\``,
        `**To:** \`${result.to}\``,
        `**Amount:** ${result.amount} PFT`,
      ];

      if (result.memo) {
        lines.push(`**Memo:** ${result.memo}`);
      }

      lines.push(`**Transaction Link:** https://explorer.testnet.postfiat.org/transactions/${result.txHash}`);

      await interaction.editReply(lines.join('\n'));
    } catch (err) {
      console.error(`[/send] Failed:`, err.message);
      await interaction.editReply(`Transaction failed: ${err.message}`);
    }
  },
};
