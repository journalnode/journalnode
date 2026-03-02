module.exports = {
  name: 'menu',
  description: 'View all Journal Node commands organized by suite.',
  needsEntries: false,

  async execute(interaction) {
    const lines = [
      '**JOURNAL NODE — COMMAND MENU**',
      '',
      '**━━━ Economic Suite ━━━**',
      '`/trade` — Log a trade idea with direction, prices, reasoning.',
      '`/mytrades` — View active trades, close positions with P&L and reflection.',
      '`/llmanalyze` — AI-powered market analysis (bullish/bearish, valuations, technical).',
      '',
      '**━━━ Post Fiat Suite ━━━**',
      '`/postfiat` — Opt in to Post Fiat testnet.',
      '`/onboard` — Set your trading purpose + PFT reward.',
      '`/balance` — Check PFT balance.',
      '`/send` — Send PFT to an address.',
      '`/receive` — Show wallet address(es).',
      '`/mint` — Mint an NFT on Post Fiat testnet.',
      '`/gallery` — View your minted NFTs.',
      '`/wallets` — list, create, import, delete, set-active.',
      '',
      '**━━━ Other ━━━**',
      '`/chat` — Talk to Journal Node AI.',
      '`! message` — Prefix command for chat.',
    ];

    const full = lines.join('\n');
    if (full.length <= 2000) {
      await interaction.editReply(full);
    } else {
      // Split by suite sections (double newline) and send as multiple messages
      const chunks = [];
      let current = '';
      for (const line of lines) {
        const next = current ? current + '\n' + line : line;
        if (next.length > 1900 && current) {
          chunks.push(current);
          current = line;
        } else {
          current = next;
        }
      }
      if (current) chunks.push(current);

      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i], flags: 64 });
      }
    }
  },
};
