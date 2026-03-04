const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

// ─── FAQ Data ───

const FAQ_DATA = {
  faq_protocol: {
    title: 'Post Fiat Protocol — FAQ',
    color: 0x3b82f6,
    entries: [
      {
        q: 'What is Post Fiat?',
        a: 'An AI-powered Layer 1 blockchain built as a regulatory-compliant fork of XRP. It uses RPCA consensus for near-instant finality and low fees, but replaces XRP\'s opaque validator governance with an AI-based, programmatic system that selects and rewards validators transparently. Designed for AI-driven capital markets and investment banking.',
      },
      {
        q: 'How does Post Fiat differ from XRP?',
        a: '• Validators are **rewarded** (55% of supply) — XRP validators get nothing\n• UNL selection is **AI-driven** and deterministic — XRP\'s is opaque\n• Token concentration **<20%** per entity (Clarity Act compliant) — XRP has high Ripple concentration\n• Governance is **programmatic**, LLM-adjudicated — XRP is foundation-controlled\n• Focus: **investment banking & AI trading** — XRP focuses on remittances',
      },
      {
        q: 'How does AI validator governance work?',
        a: 'Each month, a benchmarked open-weight LLM evaluates all validators on uptime, on-chain contribution, institutional credibility, and network value. Results are deterministic through repeated sampling and reproducible by any observer. Rewards are escrow-based and algorithmically distributed.',
      },
      {
        q: 'What is the Digital Asset Clarity Act?',
        a: 'The 2025 Clarity Act defines a "mature blockchain" as one where no entity controls ≥20% of influence. Post Fiat is structured with three independent foundations at 18.3% each to meet this threshold. This enables commodity classification, DeFi safe harbor, staking exemptions, and institutional participation.',
      },
      {
        q: 'What are the tokenomics?',
        a: 'Fixed supply of **100 billion** tokens with transaction fees burned. Distribution: **55%** to validators over time, **18.3%** to each of three independent foundations, remainder to development corporation, founders, and investors. Treasury deploys AI trading strategies, converting profits into token buy pressure.',
      },
    ],
  },

  faq_jnode: {
    title: 'Journal Node Overview — FAQ',
    color: 0x8b5cf6,
    entries: [
      {
        q: 'What is the Journal Node?',
        a: 'A Discord-based AI bot that serves the Post Fiat community. It provides two main tool suites: the **Economic Suite** (trade logging and AI market analysis) and the **Post Fiat Suite** (wallet management and token operations). Talk to it with `/chat` or the `!` prefix.',
      },
      {
        q: 'What are the two tool suites?',
        a: '**Economic Suite** — Flagship products: `/trade` for immutable trade tickets and `/llmanalyze` for AI-powered market analysis across 18 LLMs.\n\n**Post Fiat Suite** — Network tools: `/postfiat` for onboarding, `/wallets` for wallet management, `/send`/`/balance`/`/receive` for tokens, `/mint`/`/gallery` for NFTs.',
      },
      {
        q: 'How does the Journal Node benefit me?',
        a: 'Two key benefits:\n1. **Pattern recognition** — As you log more trades, you receive AI insights on your strategies and P&L, identifying strengths and weaknesses.\n2. **Synergistic analysis** — Pairing your views with `/llmanalyze` creates a human+AI feedback loop where your decision-making improves over time.',
      },
      {
        q: 'How do I talk to the Journal Node?',
        a: 'Use `/chat` followed by your message as a slash command, or prefix any message with `!` in the channel. The bot reads your journal entries and can answer questions about your patterns, give advice, or discuss the Post Fiat ecosystem.',
      },
    ],
  },

  faq_economic: {
    title: 'Economic Suite — FAQ',
    color: 0x22c55e,
    entries: [
      {
        q: 'What is /trade?',
        a: 'Log immutable trade tickets with asset, direction (long/short), entry price, target price, timeframe, emotion/reasoning, and an optional chart screenshot. Each ticket gets a unique ID and a "Run LLM Analysis" button. Close trades later via `/mytrades` to record outcomes and post-mortem reflections.',
      },
      {
        q: 'What is /llmanalyze?',
        a: 'AI market analysis with four modes:\n• **Bullish or Bearish** — 18 LLMs vote on your thesis (pie chart)\n• **Multi-Valuation** — Up to 8 LLMs estimate market cap (bar chart)\n• **Solo-Valuation** — 1 model, multiple runs for consistency (bar chart)\n• **Technical Analyst** — Vision LLMs analyze a chart screenshot (Long/Short)',
      },
      {
        q: 'What is "LLM-optimization"?',
        a: 'The foundational thesis of the Economic Suite. It suggests asset prices will converge toward "LLM Consensus" as AI agents increasingly manage both retail sentiment and institutional capital. `/llmanalyze` lets you see where that consensus sits today, helping align your strategies with AI-driven market dynamics.',
      },
      {
        q: 'Does /llmanalyze cost PFT?',
        a: 'Yes — each of the four modes costs **1 PFT** per use. The fee is sent to the Journal Node\'s master wallet with an on-chain memo identifying the mode used. You\'ll see a payment confirmation with an explorer link before the analysis runs.',
      },
      {
        q: 'How does trade logging improve my trading?',
        a: '1. **Pattern recognition** — The AI identifies recurring strengths, weaknesses, and areas for improvement across your logged trades.\n2. **Synergistic analysis** — Pairing your own views with `/llmanalyze` creates a self-reinforcing feedback loop between human intuition and LLM analysis.',
      },
    ],
  },

  faq_postfiat: {
    title: 'Post Fiat Suite — FAQ',
    color: 0x6b7280,
    entries: [
      {
        q: 'How do I get started with Post Fiat?',
        a: 'Run `/postfiat` to create your first wallet, set your goals, and receive a PFT airdrop. Your wallet is encrypted and stored securely. You\'ll receive a 24-word seed phrase — write it down and delete the message.',
      },
      {
        q: 'What wallet commands are available?',
        a: '`/wallets` — Create, import (24-word seed or private key), delete, list, and set-active wallet.\n`/balance` — Check PFT balance across all wallets.\n`/send` — Transfer PFT to any address with an optional on-chain memo.\n`/receive` — Show your wallet address(es) for receiving PFT.',
      },
      {
        q: 'Can I mint NFTs?',
        a: 'Yes! Use `/mint` to create NFTs on the Post Fiat testnet. Upload an image (auto-uploaded to IPFS) or provide an IPFS URI directly. View your collection with `/gallery`. Closed trade tickets can also be minted as NFTs for a permanent on-chain track record.',
      },
      {
        q: 'What is /onboard?',
        a: 'Set your purpose within the Post Fiat ecosystem and receive a PFT reward for doing so. This helps the Journal Node understand your goals and tailor insights to your journey.',
      },
    ],
  },

  faq_vision: {
    title: 'Vision & Use Cases — FAQ',
    color: 0xef4444,
    entries: [
      {
        q: 'What is the "Internet of Agents"?',
        a: 'Post Fiat\'s core vision — a blockchain where AI agents, financial institutions, and retail participants coordinate, transact, and generate value on-chain. A new coordination layer for AI agents paying humans, humans coordinating AI systems, and institutions interacting with AI agents compliantly.',
      },
      {
        q: 'Who is Post Fiat built for?',
        a: 'Three user groups:\n1. **Retail traders** — Using the Journal Node for AI-guided strategy refinement\n2. **Institutions** — Leveraging AI trading agents, compliance automation, and verified inference pipelines\n3. **AI agents** — Operating as autonomous participants in on-chain capital markets',
      },
      {
        q: 'What is the "Dual-Cylinder Growth Model"?',
        a: 'Two reinforcing flywheels:\n• **Retail:** Users → Better AI → Higher returns → Treasury appreciation → More rewards → More users\n• **Institutional:** Institutions → Shared compliance + intelligence → Alpha → Rewards → More institutions\n\nCombined effect: credibility inversion relative to XRP\'s positioning.',
      },
      {
        q: "What's the long-term vision?",
        a: 'In the post-AGI world, humans are not paid for existence but rewarded for useful contribution. AI systems distribute capital programmatically. Currency becomes a coordination primitive. Post Fiat is designed to be that primitive — a system where humans remain economically relevant in the age of AGI.',
      },
    ],
  },
};

// ─── Button Row Builder ───

function buildButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('faq_protocol').setLabel('Protocol').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('faq_jnode').setLabel('Journal Node').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('faq_economic').setLabel('Economic Suite').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('faq_postfiat').setLabel('Post Fiat Suite').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('faq_vision').setLabel('Vision').setStyle(ButtonStyle.Danger),
  );
}

function buildMenuEmbed() {
  return new EmbedBuilder()
    .setTitle('Journal Node & Post Fiat — FAQ')
    .setColor(0x3b82f6)
    .setDescription(
      'Browse frequently asked questions about the Journal Node and the Post Fiat protocol.\n\n' +
      'Select a category below to get started.'
    )
    .addFields(
      { name: 'Protocol', value: 'What is Post Fiat, how it differs from XRP, tokenomics, Clarity Act', inline: true },
      { name: 'Journal Node', value: 'Overview of the bot, tool suites, and key benefits', inline: true },
      { name: 'Economic Suite', value: '/trade, /llmanalyze, LLM-optimization thesis, PFT fees', inline: true },
      { name: 'Post Fiat Suite', value: 'Wallets, tokens, NFTs, onboarding', inline: true },
      { name: 'Vision', value: 'Internet of Agents, growth model, long-term roadmap', inline: true },
    );
}

// ─── Command Export ───

module.exports = {
  name: 'faq',
  description: 'Frequently asked questions about Journal Node and Post Fiat.',
  needsEntries: false,

  async execute(interaction) {
    await interaction.editReply({ embeds: [buildMenuEmbed()], components: [buildButtonRow()] });
  },

  async handleButton(interaction) {
    const id = interaction.customId;
    const category = FAQ_DATA[id];
    if (!category) return;

    const embed = new EmbedBuilder()
      .setTitle(category.title)
      .setColor(category.color);

    for (const entry of category.entries) {
      embed.addFields({ name: entry.q, value: entry.a });
    }

    await interaction.update({ embeds: [embed], components: [buildButtonRow()] });
  },
};
