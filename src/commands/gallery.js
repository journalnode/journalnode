const { getNFTs } = require('../wallet');
const { getActiveWallet, getUserWallets } = require('../walletStore');

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
const EXPLORER = 'https://explorer.testnet.postfiat.org';
const PAGE_SIZE = 10;

module.exports = {
  name: 'gallery',
  description: 'View all NFTs minted by your active wallet.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const page = (interaction.options.getInteger('page') || 1) - 1;

    const active = getActiveWallet(userId);
    if (!active) {
      await interaction.editReply('You don\'t have an active wallet. Use `/postfiat` to create one first.');
      return;
    }

    console.log(`[/gallery] Fetching NFTs for ${active.address}`);

    const nfts = await getNFTs(active.address);

    if (nfts.length === 0) {
      await interaction.editReply('No NFTs found for your active wallet. Use `/mint` to create one.');
      return;
    }

    const totalPages = Math.ceil(nfts.length / PAGE_SIZE);
    const currentPage = Math.min(page, totalPages - 1);
    const start = currentPage * PAGE_SIZE;
    const pageNfts = nfts.slice(start, start + PAGE_SIZE);

    const lines = [`**Your NFTs** (${nfts.length} total) — Page ${currentPage + 1}/${totalPages}\n`];

    pageNfts.forEach((nft, i) => {
      const num = start + i + 1;
      lines.push(`**${num}.** \`${nft.nftokenId}\``);
      lines.push(`Explorer: ${EXPLORER}/nft/${nft.nftokenId}`);

      if (nft.uri && nft.uri.includes('ipfs://')) {
        const cid = nft.uri.split('ipfs://').pop();
        lines.push(`View: ${IPFS_GATEWAY}${cid}`);
      } else if (nft.uri) {
        lines.push(`URI: ${nft.uri}`);
      }

      lines.push('');
    });

    if (totalPages > 1) {
      lines.push(`Use \`/gallery page:${currentPage + 2}\` to see more.`);
    }

    await interaction.editReply(lines.join('\n'));
  },
};
