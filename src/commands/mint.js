const { mintNFT, uploadToIPFS } = require('../wallet');
const { getActiveWallet, getWalletSeed } = require('../walletStore');

module.exports = {
  name: 'mint',
  description: 'Mint an NFT on the Post Fiat testnet from an IPFS URI or image upload.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const uriInput = interaction.options.getString('uri');
    const attachment = interaction.options.getAttachment('image');

    // Must provide at least one
    if (!uriInput && !attachment) {
      await interaction.editReply(
        '**Please provide either:**\n' +
        '• A `uri` — an IPFS URI like `ipfs://bafkrei...`\n' +
        '• An `image` — upload a .jpg or .png file\n\n' +
        '**How to get an IPFS URI from an image:**\n' +
        '1. Go to https://app.pinata.cloud (free account)\n' +
        '2. Upload your image\n' +
        '3. Copy the CID and use it as: `ipfs://<your-CID>`'
      );
      return;
    }

    // Check user has an active wallet
    const active = getActiveWallet(userId);
    if (!active) {
      await interaction.editReply('You don\'t have an active wallet. Use `/postfiat` to create one first.');
      return;
    }

    const seed = getWalletSeed(userId, active.address);
    if (!seed) {
      await interaction.editReply('Could not retrieve your wallet credentials. Try `/wallets set-active` to reset.');
      return;
    }

    let uri = uriInput;

    // If image attachment provided, upload to IPFS
    if (attachment) {
      if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
        await interaction.editReply('Please upload an image file (.jpg, .png, .gif, .webp).');
        return;
      }

      console.log(`[/mint] ${username} uploading image to IPFS: ${attachment.name}`);

      try {
        const response = await fetch(attachment.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        uri = await uploadToIPFS(buffer, attachment.name);
        console.log(`[/mint] IPFS upload success: ${uri}`);
      } catch (err) {
        console.error(`[/mint] IPFS upload failed:`, err.message);
        await interaction.editReply(
          `Image upload to IPFS failed: ${err.message}\n\n` +
          '**Alternative:** Upload your image manually at https://app.pinata.cloud and use `/mint uri:ipfs://<your-CID>`'
        );
        return;
      }
    }

    console.log(`[/mint] ${username} minting NFT with URI: ${uri}`);

    try {
      const result = await mintNFT(seed, uri);
      console.log(`[/mint] Success — tx: ${result.txHash}, nftokenId: ${result.nftokenId}`);

      const lines = [
        '**NFT minted successfully!**\n',
        `**URI:** ${result.uri}`,
        `**Minter:** \`${result.minter}\``,
      ];

      if (result.nftokenId) {
        lines.push(`**NFToken ID:** \`${result.nftokenId}\``);
      }

      lines.push(`**Transaction Link:** https://explorer.testnet.postfiat.org/transactions/${result.txHash}`);

      // Add viewable image link if URI is an IPFS URI
      if (result.uri.startsWith('ipfs://')) {
        const cid = result.uri.replace('ipfs://', '');
        lines.push(`**View Image:** https://ipfs.io/ipfs/${cid}`);
      }

      await interaction.editReply(lines.join('\n'));
    } catch (err) {
      console.error(`[/mint] Failed:`, err.message);
      await interaction.editReply(`Mint failed: ${err.message}`);
    }
  },
};
