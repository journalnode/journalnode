const { getUserWallets, addWallet, removeWallet, setActiveWallet } = require('../walletStore');
const { generateWallet, airdropToWallet, loadWallet } = require('../wallet');

module.exports = {
  name: 'wallets',
  description: 'Manage your Post Fiat wallets.',
  needsEntries: false,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const username = interaction.user.username;

    if (sub === 'list') {
      const user = getUserWallets(userId);
      if (user.wallets.length === 0) {
        await interaction.editReply(
          'You have no wallets yet. Use `/postfiat` to create your first wallet, or `/wallets import` to import an existing one.'
        );
        return;
      }

      const lines = user.wallets.map((w, i) => {
        const active = w.address === user.activeAddress ? ' **[active]**' : '';
        const short = w.address.slice(0, 8) + '...' + w.address.slice(-6);
        return `${i + 1}. \`${short}\`${active}`;
      });

      await interaction.editReply(
        `**Your Post Fiat wallets** (${user.wallets.length}):\n\n` +
        lines.join('\n') +
        '\n\nUse `/wallets set-active` to switch wallets.'
      );

    } else if (sub === 'create') {
      console.log(`[/wallets create] ${username} (${userId})`);

      const wallet = generateWallet();
      console.log(`[/wallets create] New address: ${wallet.address}`);

      addWallet(userId, wallet.address, wallet.mnemonic, wallet.publicKey);

      // Attempt airdrop
      let airdropMsg = '';
      try {
        const airdrop = await airdropToWallet(wallet.address);
        airdropMsg = `**Airdrop:** ${airdrop.amount} PFT sent from the Master Node\n**Transaction:** \`${airdrop.txHash}\`\n`;
        console.log(`[/wallets create] Airdrop success — tx: ${airdrop.txHash}`);
      } catch (err) {
        airdropMsg = `Airdrop failed: ${err.message} — the wallet can be funded manually.\n`;
        console.error(`[/wallets create] Airdrop failed:`, err.message);
      }

      await interaction.editReply(
        '**New wallet created and saved!**\n\n' +
        `**Address:** \`${wallet.address}\`\n` +
        airdropMsg + '\n' +
        '**Your 24-word seed phrase:**\n' +
        `\`\`\`${wallet.mnemonic}\`\`\`\n` +
        '⚠️ **Write down your seed phrase and delete this message.** Journal Node encrypts it locally, but you should always have a personal backup.'
      );

    } else if (sub === 'import') {
      const seed = interaction.options.getString('seed');
      console.log(`[/wallets import] ${username} (${userId})`);

      let wallet;
      try {
        wallet = loadWallet(seed);
      } catch (err) {
        await interaction.editReply('Invalid seed phrase or private key. Please check and try again.');
        return;
      }

      const added = addWallet(userId, wallet.classicAddress, seed, wallet.publicKey);
      if (!added) {
        await interaction.editReply(`Wallet \`${wallet.classicAddress}\` is already in your wallet list.`);
        return;
      }

      console.log(`[/wallets import] Imported: ${wallet.classicAddress}`);
      await interaction.editReply(
        '**Wallet imported and saved!**\n\n' +
        `**Address:** \`${wallet.classicAddress}\`\n\n` +
        'Use `/wallets list` to see all your wallets and `/wallets set-active` to switch.'
      );

    } else if (sub === 'delete') {
      const address = interaction.options.getString('address');
      console.log(`[/wallets delete] ${username} (${userId}) — ${address}`);

      const removed = removeWallet(userId, address);
      if (!removed) {
        await interaction.editReply(`No wallet found with address \`${address}\`. Use \`/wallets list\` to see your wallets.`);
        return;
      }

      await interaction.editReply(`Wallet \`${address}\` has been removed from your profile.`);

    } else if (sub === 'set-active') {
      const address = interaction.options.getString('address');
      console.log(`[/wallets set-active] ${username} (${userId}) — ${address}`);

      const success = setActiveWallet(userId, address);
      if (!success) {
        await interaction.editReply(`No wallet found with address \`${address}\`. Use \`/wallets list\` to see your wallets.`);
        return;
      }

      await interaction.editReply(`Active wallet set to \`${address}\`.`);
    }
  },
};
