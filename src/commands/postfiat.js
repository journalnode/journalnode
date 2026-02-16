const { generateWallet, airdropToWallet } = require('../wallet');

module.exports = {
  name: 'postfiat',
  description: 'Opt in to the Post Fiat testnet — generates your wallet and activates it on-chain.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    console.log(`[/postfiat] Generating wallet for ${username} (${userId})`);

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
        '**Your wallet was generated** but the on-chain activation failed: ' + err.message + '\n\n' +
        `**Wallet address:** \`${wallet.address}\`\n\n` +
        '**Your 24-word seed phrase:**\n' +
        `\`\`\`${wallet.mnemonic}\`\`\`\n` +
        '⚠️ **Save your seed phrase somewhere safe and delete this message.** The wallet can be activated later when someone sends you PFT (minimum 10 PFT).'
      );
      return;
    }

    const reply = [
      '**Welcome to the Post Fiat testnet!** Your wallet has been created and activated on-chain.\n',
      `**Wallet address:** \`${wallet.address}\``,
      `**Airdrop:** ${airdrop.amount} PFT sent from the Master Node`,
      `**Transaction:** \`${airdrop.txHash}\``,
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
    ].join('\n');

    await interaction.editReply(reply);
  },
};
