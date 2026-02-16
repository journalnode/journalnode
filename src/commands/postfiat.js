const { generateWallet } = require('../wallet');

module.exports = {
  name: 'postfiat',
  description: 'Opt in to the Post Fiat testnet — generates your wallet on the network.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    console.log(`[/postfiat] Generating wallet for ${username} (${userId})`);

    const wallet = generateWallet();
    console.log(`[/postfiat] New address: ${wallet.address}`);

    const reply = [
      '**Welcome to the Post Fiat testnet!** Your wallet has been generated.\n',
      `**Wallet address:** \`${wallet.address}\``,
      '',
      '**Your 24-word seed phrase:**',
      `\`\`\`${wallet.mnemonic}\`\`\``,
      '',
      `**Explorer:** https://explorer.testnet.postfiat.org`,
      '',
      '⚠️ **IMPORTANT — READ THIS:**',
      '• Your **seed phrase** is your private key. It controls your wallet and your funds.',
      '• **Write it down** on paper or save it in a password manager — right now.',
      '• **Delete this message** after saving your seed phrase.',
      '• **Never share your seed phrase** with anyone. Journal Node does not store it.',
      '• If you lose your seed phrase, your wallet and any on-chain achievements are gone forever.',
      '',
      'Your wallet is not yet active on-chain — it will be activated when someone sends you PFT for the first time (minimum 10 PFT to cover the account reserve).',
    ].join('\n');

    await interaction.editReply(reply);
  },
};
