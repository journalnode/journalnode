module.exports = {
  name: 'menu',
  description: 'View all Journal Node commands organized by suite.',
  needsEntries: false,

  async execute(interaction) {
    const lines = [
      '**JOURNAL NODE — COMMAND MENU**',
      '',
      '**━━━ Personal Suite ━━━**',
      '`/insight` — AI holistic analysis of your journal.',
      '`/mood` — Emotional temperature over time.',
      '`/focus` — Past, present, or future orientation.',
      '`/rhythm` — Day-of-week and time-of-day patterns.',
      '`/cadence` — Streaks, gaps, and monthly frequency.',
      '`/length` — Word count trends over time.',
      '`/topics` — Theme and topic evolution.',
      '`/questions` — Self-questioning patterns.',
      '`/vocab` — Vocabulary diversity over time.',
      '`/onboard` — Set your journal purpose + 50 PFT reward.',
      '',
      '**━━━ Economic Suite ━━━**',
      '`/trade` — Log a trade idea with direction, prices, reasoning.',
      '`/llmanalyze` — 18-model market analysis (bullish/bearish, valuations, technical).',
      '',
      '**━━━ Post Fiat Suite ━━━**',
      '`/postfiat` — Opt in to Post Fiat testnet.',
      '`/balance` — Check PFT balance.',
      '`/send` — Send PFT to an address.',
      '`/receive` — Show wallet address(es).',
      '`/mint` — Mint an NFT on Post Fiat testnet.',
      '`/gallery` — View your minted NFTs.',
      '`/wallets` — list, create, import, delete, set-active.',
      '',
      '**━━━ Other ━━━**',
      '`/chat` — Talk to your journal AI.',
      '`! message` — Prefix command for chat.',
    ];

    await interaction.editReply(lines.join('\n'));
  },
};
