const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getNFTs, createNFTSellOffer, acceptNFTOffer } = require('../wallet');
const { getActiveWallet, getWalletSeed, findUserByAddress } = require('../walletStore');

const EXPLORER = 'https://explorer.testnet.postfiat.org';
const JOLLYDINGER = 'https://jollydinger.com/nft-detail.html?id=';
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

// Store pending sendnft sessions: interactionUserId -> { destination, nfts }
const pendingSends = new Map();

module.exports = {
  name: 'sendnft',
  description: 'Send NFTs from your gallery to another Post Fiat address.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const destination = interaction.options.getString('destination');

    const active = getActiveWallet(userId);
    if (!active) {
      await interaction.editReply('You don\'t have an active wallet. Use `/postfiat` to create one first.');
      return;
    }

    if (destination === active.address) {
      await interaction.editReply('You cannot send NFTs to your own active wallet.');
      return;
    }

    console.log(`[/sendnft] ${username} fetching NFTs for selection, destination: ${destination}`);

    const nfts = await getNFTs(active.address);
    if (nfts.length === 0) {
      await interaction.editReply('No NFTs found in your active wallet. Use `/mint` to create one first.');
      return;
    }

    // Store session data
    pendingSends.set(userId, { destination, nfts });

    // Build select menu (max 25 options in Discord)
    const options = nfts.slice(0, 25).map((nft, i) => {
      const shortId = nft.nftokenId.slice(0, 8) + '...' + nft.nftokenId.slice(-8);
      let desc = '';
      if (nft.uri && nft.uri.includes('ipfs://')) {
        const cid = nft.uri.split('ipfs://').pop();
        desc = `ipfs://...${cid.slice(-16)}`;
      } else if (nft.uri) {
        desc = nft.uri.slice(0, 50);
      } else {
        desc = 'No URI';
      }

      return {
        label: `NFT #${i + 1}: ${shortId}`,
        description: desc.slice(0, 100),
        value: nft.nftokenId,
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('sendnft_select')
      .setPlaceholder('Select NFT(s) to send...')
      .setMinValues(1)
      .setMaxValues(Math.min(options.length, 25))
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const lines = [
      `**Select NFT(s) to send to** \`${destination}\``,
      `You have **${nfts.length}** NFT${nfts.length !== 1 ? 's' : ''} in your gallery.${nfts.length > 25 ? ' (Showing first 25)' : ''}`,
    ];

    await interaction.editReply({ content: lines.join('\n'), components: [row] });
  },

  async handleSelectMenu(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const selectedIds = interaction.values;

    const session = pendingSends.get(userId);
    if (!session) {
      await interaction.reply({ content: 'Session expired. Please run `/sendnft` again.', flags: 64 });
      return;
    }

    const { destination } = session;
    pendingSends.delete(userId);

    await interaction.deferReply({ flags: 64 });

    const active = getActiveWallet(userId);
    if (!active) {
      await interaction.editReply('Wallet not found. Please try again.');
      return;
    }

    const seed = getWalletSeed(userId, active.address);
    if (!seed) {
      await interaction.editReply('Could not retrieve your wallet credentials. Try `/wallets set-active` to reset.');
      return;
    }

    // Check if recipient is a local Journal Node user (for auto-accept)
    const recipientUser = findUserByAddress(destination);
    let recipientSeed = null;
    if (recipientUser) {
      recipientSeed = getWalletSeed(recipientUser.userId, recipientUser.address);
    }

    console.log(`[/sendnft] ${username} sending ${selectedIds.length} NFT(s) to ${destination}${recipientSeed ? ' (auto-accept)' : ' (offer only)'}`);

    const results = [];
    const errors = [];

    for (const nftokenId of selectedIds) {
      try {
        // Create sell offer directed to destination
        const offerResult = await createNFTSellOffer(seed, nftokenId, destination);

        if (recipientSeed && offerResult.offerId) {
          // Auto-accept the offer on behalf of the recipient
          const acceptResult = await acceptNFTOffer(recipientSeed, offerResult.offerId);
          results.push({
            nftokenId,
            offerTxHash: offerResult.txHash,
            acceptTxHash: acceptResult.txHash,
            transferred: true,
          });
        } else {
          results.push({
            nftokenId,
            offerTxHash: offerResult.txHash,
            offerId: offerResult.offerId,
            transferred: false,
          });
        }
      } catch (err) {
        console.error(`[/sendnft] Failed for ${nftokenId}:`, err.message);
        errors.push({ nftokenId, error: err.message });
      }
    }

    // Build response
    const lines = [];

    if (results.length > 0) {
      const transferred = results.filter(r => r.transferred);
      const offered = results.filter(r => !r.transferred);

      if (transferred.length > 0) {
        lines.push(`**${transferred.length} NFT${transferred.length !== 1 ? 's' : ''} transferred successfully!**\n`);
        lines.push(`**From:** \`${active.address}\``);
        lines.push(`**To:** \`${destination}\`\n`);

        for (const r of transferred) {
          const shortId = r.nftokenId.slice(0, 8) + '...' + r.nftokenId.slice(-8);
          lines.push(`**NFT:** \`${shortId}\``);
          lines.push(`Offer Tx: ${EXPLORER}/transactions/${r.offerTxHash}`);
          lines.push(`Accept Tx: ${EXPLORER}/transactions/${r.acceptTxHash}`);
          lines.push(`[View on Jollydinger](${JOLLYDINGER}${r.nftokenId})`);
          lines.push('');
        }
      }

      if (offered.length > 0) {
        lines.push(`**${offered.length} sell offer${offered.length !== 1 ? 's' : ''} created**`);
        lines.push(`The recipient must accept the offer${offered.length !== 1 ? 's' : ''} to complete the transfer.\n`);
        lines.push(`**From:** \`${active.address}\``);
        lines.push(`**To:** \`${destination}\`\n`);

        for (const r of offered) {
          const shortId = r.nftokenId.slice(0, 8) + '...' + r.nftokenId.slice(-8);
          lines.push(`**NFT:** \`${shortId}\``);
          lines.push(`Offer Tx: ${EXPLORER}/transactions/${r.offerTxHash}`);
          if (r.offerId) lines.push(`Offer ID: \`${r.offerId}\``);
          lines.push('');
        }
      }
    }

    if (errors.length > 0) {
      lines.push(`**${errors.length} failed:**`);
      for (const e of errors) {
        const shortId = e.nftokenId.slice(0, 8) + '...' + e.nftokenId.slice(-8);
        lines.push(`\`${shortId}\`: ${e.error}`);
      }
    }

    await interaction.editReply(lines.join('\n'));
  },
};
