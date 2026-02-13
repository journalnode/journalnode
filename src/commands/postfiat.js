const { generateWallet, airdropToWallet } = require('../wallet');

module.exports = {
  name: 'postfiat',
  description: 'Opt in to the Post Fiat testnet — generates your wallet and activates it on-chain.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    console.log(`[/postfiat] Generating wallet for ${username} (${userId})`);

    // Generate new wallet
    const wallet = generateWallet();
    console.log(`[/postfiat] New address: ${wallet.address}`);

    // Airdrop to activate the wallet on-chain
    let airdrop;
    try {
      airdrop = await airdropToWallet(wallet.address);
      console.log(`[/postfiat] Airdrop success — tx: ${airdrop.txHash}`);
    } catch (err) {
      console.error(`[/postfiat] Airdrop failed:`, err.message);
      await interaction.editReply(
        `Your wallet was generated but the on-chain activation failed: ${err.message}\n\n` +
        `Your address: \`${wallet.address}\`\n` +
        `Your seed: \`${wallet.seed}\`\n\n` +
        '⚠️ **Save your seed somewhere safe and delete this message.** You can try again later once the issue is resolved.'
      );
      return;
    }

    const reply = [
      '**Welcome to the Post Fiat testnet!** Your wallet has been created and activated on-chain.\n',
      `**Wallet address:** \`${wallet.address}\``,
      `**Your secret seed:** \`${wallet.seed}\``,
      `**Airdrop:** ${airdrop.amount} PFT sent from the Master Node`,
      `**Transaction hash:** \`${airdrop.txHash}\``,
      `**Explorer:** https://explorer.testnet.postfiat.org`,
      '',
      '⚠️ **IMPORTANT — READ THIS:**',
      '• Your **seed** is your private key. It controls your wallet and your funds.',
      '• **Write it down** on paper or save it in a password manager.',
      '• **Delete this message** after saving your seed.',
      '• **Never share your seed** with anyone. Journal Node does not store it.',
      '• If you lose your seed, your wallet and any on-chain achievements are gone forever.',
    ].join('\n');

    await interaction.editReply(reply);
  },
};
