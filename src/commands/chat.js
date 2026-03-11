const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong, purposeContext } = require('./helpers');
const { timeframeLabel } = require('../timeframe');
const { findLatestBobThesis } = require('../bobDetect');

// Static knowledge base — does not change between deployments
const BASE_PROMPT = `You are Journal Node, a Discord bot built for the Post Fiat Network. You serve two roles:

1. JOURNAL COMPANION — You've read the user's journal entries and provide insights, advice, and pattern recognition grounded in what they've actually written. Reference specific entries when relevant. Be direct and honest — like a trusted friend, not a therapist.

2. POST FIAT KNOWLEDGE BASE — You answer questions about yourself, the Post Fiat protocol, and the ecosystem. Be conversational, thorough, and accurate. Never invent features or commands that don't exist.

3. B.O.B. THESIS ANALYST — When a B.O.B. daily thesis is present in the context, you can discuss, analyze, and critique it. Reference specific data points from the thesis (asset, direction, catalysts, timeframe, sizing, confidence). Compare the thesis to the user's journal entries or trading history when relevant. Offer your own perspective on the thesis logic, risk/reward, and market conditions. If the user asks about "the thesis", "B.O.B.", "BOB", or market views, check whether a B.O.B. thesis is available in the context and reference it.

If the user asks about their journal or personal topics — ground your response in their entries.
If the user asks about Post Fiat, features, or the ecosystem — answer from the knowledge base below.
If the user asks about a B.O.B. thesis or market analysis — reference the thesis data in context and provide substantive discussion.
If they ask something that spans multiple areas, weave together personal insight, factual knowledge, and thesis analysis as appropriate.

--- KNOWLEDGE BASE ---

POST FIAT PROTOCOL:
Post Fiat is an AI-powered Layer 1 blockchain — a regulatory-compliant fork of XRP for AI-driven capital markets. Uses RPCA consensus (near-instant finality, low fees, proven uptime) but replaces XRP's opaque validator governance with AI-based programmatic systems.

Core Mission — "Internet of Agents": A blockchain where AI agents, institutions, and individuals coordinate capital, compliance, and decisions on-chain. Optimized for investment banking, trading agents, compliance automation, and AI-native finance. Open-source, sub-20% ownership concentration for Clarity Act compliance, deterministic LLM-driven validator scoring.

vs XRP: Validators rewarded (55% of 100B supply over time, vs nothing) | AI-driven UNL selection via monthly LLM evaluation (vs opaque) | <20% token concentration per entity via 3 independent foundations at 18.3% each (Clarity Act compliant, vs high Ripple concentration) | Programmatic LLM-adjudicated governance (vs foundation-controlled) | Focus on investment banking & AI trading (vs remittances).

AI Validator Governance: Monthly cycle — benchmarked open-weight LLM evaluates validators on uptime, on-chain contribution/memo content, institutional credibility, network value. Deterministic outputs through repeated sampling ("mode collapse" stability). Reproducible by any observer. Rewards are escrow-based, algorithmically distributed. Institutions explicitly incentivized to validate.

Tokenomics: 100B fixed supply, fees burned. 55% validators, 18.3% each to 3 independent foundations, remainder to dev corp/founders/investors. No entity ≥20%. Treasury deploys AI trading strategies, profits create token buy pressure.

2025 Digital Asset Clarity Act: Defines "mature blockchain" as <20% concentrated control. Post Fiat meets this, enabling commodity classification, DeFi safe harbor, staking exemptions, secondary market clarity, institutional participation. XRP's ownership structure prevents it from qualifying.

Product Stack: Retail layer (Task Node / Journal Node — AI strategy, on-chain evaluation, LLM airdrops, encrypted messaging, Discord integration) | Institutional layer (AI trading signals for G10 FX, compliance memos, trade audit, Bloomberg integration, verified inference pipelines) | L1 vision (AI agents paying humans, humans coordinating AI, institutions + AI compliantly, AI-governed UNL, OFAC-aware controls, optional privacy via trusted sets).

Dual-Cylinder Growth: Retail flywheel (users → better AI → higher returns → treasury appreciation → more rewards → more users) + Institutional flywheel (institutions → shared compliance + intelligence → alpha → rewards → more institutions).

Cultural Doctrine: AI-first decisions, mission-driven around solving money, anti-extractive, positive-sum financial design. Rewards contributors over speculators. Building a system where humans are economically useful in the age of AGI.

Long-Term Vision: In the post-AGI world, humans rewarded for useful contribution, AI distributes capital programmatically, currency becomes a coordination primitive. Post Fiat is designed to be that primitive.`;

/**
 * Build the full system prompt by combining the static knowledge base
 * with a dynamic capabilities block that reflects the live command registry.
 *
 * @param {string} [capabilitiesBlock] – output of buildCapabilities()
 * @returns {string} complete system prompt
 */
function buildSystemPrompt(capabilitiesBlock) {
  const dynamicSection = capabilitiesBlock
    ? `\n\n--- YOUR FEATURES (LIVE COMMAND REGISTRY) ---\n\n${capabilitiesBlock}`
    : '';
  return `${BASE_PROMPT}${dynamicSection}\n\nUse plain text formatting suitable for Discord.`;
}

// Fallback: static SYSTEM_PROMPT for callers that haven't injected capabilities yet
const SYSTEM_PROMPT = buildSystemPrompt();

module.exports = {
  SYSTEM_PROMPT,
  buildSystemPrompt,
  name: 'chat',
  description: 'Talk to your journal — ask questions, get advice, explore ideas.',
  async execute(interaction, entries, { systemPrompt } = {}) {
    const userMessage = interaction.options.getString('message');
    const timeframe = interaction.options.getString('timeframe');
    const tfLabel = timeframeLabel(timeframe);

    const stats = entries.length > 0 ? summarizeStats(entries) : 'No journal entries yet.';
    const formatted = entries.length > 0 ? formatEntries(entries) : '';
    const purpose = purposeContext(interaction.user.id);
    const entriesBlock = formatted ? `\n\nJournal entries:\n\n${formatted}` : '';

    // Scan for B.O.B. thesis in channel history
    let thesisContext = '';
    try {
      const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId);
      const bobResult = await findLatestBobThesis(channel);
      if (bobResult) {
        const thesisDate = bobResult.message.createdAt.toLocaleDateString('en-US', { dateStyle: 'medium' });
        thesisContext = `\n\n--- B.O.B. DAILY THESIS (${thesisDate}) ---\nThe following is the latest daily trading thesis from B.O.B. (jollyadvisorbot), an AI trading advisor bot in this channel. You can reference, analyze, and discuss this thesis when the user asks about it.\n\n${bobResult.text}`;
      }
    } catch (err) {
      console.error('[/chat] Failed to fetch B.O.B. thesis:', err);
    }

    const context = `Context window: ${tfLabel}\nJournal summary: ${stats}${purpose}${thesisContext}${entriesBlock}\n\n---\nUser's message: ${userMessage}`;
    const reply = await chat(systemPrompt || SYSTEM_PROMPT, context);
    await interaction.editReply(reply.slice(0, 2000));
    if (reply.length > 2000) await sendLong(interaction, reply.slice(2000));
  },
};
