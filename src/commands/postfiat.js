const { generateWallet, airdropToWallet } = require('../wallet');
const { getUserWallets, addWallet } = require('../walletStore');

module.exports = {
  name: 'postfiat',
  description: 'Opt in to the Post Fiat testnet — creates your first wallet.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const user = getUserWallets(userId);

    // Returning user — redirect to /wallets
    if (user.wallets.length > 0) {
      const active = user.activeAddress
        ? `Your active wallet: \`${user.activeAddress}\``
        : 'No active wallet set.';

      await interaction.editReply(
        `**You're already on the Post Fiat testnet!** You have ${user.wallets.length} wallet(s).\n\n` +
        active + '\n\n' +
        'Use these commands to manage your wallets:\n' +
        '• `/wallets list` — view all your wallets\n' +
        '• `/wallets create` — generate a new wallet\n' +
        '• `/wallets import` — import an existing wallet with a seed phrase\n' +
        '• `/wallets delete` — remove a wallet\n' +
        '• `/wallets set-active` — switch your active wallet'
      );
      return;
    }

    // First-time user — create wallet + airdrop
    console.log(`[/postfiat] First-time setup for ${username} (${userId})`);

    const wallet = generateWallet();
    console.log(`[/postfiat] New address: ${wallet.address}`);

    // Save to persistent store
    addWallet(userId, wallet.address, wallet.mnemonic, wallet.publicKey);

    // Airdrop to activate the wallet on-chain
    let airdropMsg = '';
    try {
      const airdrop = await airdropToWallet(wallet.address);
      airdropMsg = `**Airdrop:** ${airdrop.amount} PFT sent from the Master Node\n**Transaction:** \`${airdrop.txHash}\`\n`;
      console.log(`[/postfiat] Airdrop success — tx: ${airdrop.txHash}`);
    } catch (err) {
      airdropMsg = `Airdrop failed: ${err.message} — the wallet can be funded manually.\n`;
      console.error(`[/postfiat] Airdrop failed:`, err.message);
    }

    const reply = [
      '**Welcome to the Post Fiat testnet!** Your wallet has been created and saved.\n',
      `**Wallet address:** \`${wallet.address}\``,
      airdropMsg,
      '**Your 24-word seed phrase:**',
      `\`\`\`${wallet.mnemonic}\`\`\``,
      '',
      `**Explorer:** https://explorer.testnet.postfiat.org`,
      '',
      '⚠️ **IMPORTANT — READ THIS:**',
      '• Your **seed phrase** is your private key. Write it down and save it securely.',
      '• **Delete this message** after saving your seed phrase.',
      '• Journal Node encrypts your seed locally, but always keep a personal backup.',
      '',
      'Use `/wallets` to manage your wallets in the future.',
    ].join('\n');

    await interaction.editReply(reply);
  },
};
