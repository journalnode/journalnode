const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getUserTrades, getTradeByTradeId } = require('../tradeStore');
const { chat: llmChat } = require('../openrouter');
const { sendPFT, getBalance } = require('../wallet');
const { getActiveWallet, getWalletSeed } = require('../walletStore');
const { sendLong } = require('./helpers');

// ─── PFT Micro-Payment Constants ───

const JOURNAL_NODE_WALLET = 'rLnrtLSQdtmWgTiY3o6NNWKpb43RsvZ1yW';
const LLM_FEE_PFT = '1';
const PFT_EXPLORER = 'https://explorer.testnet.postfiat.org/transactions';

// ─── Pagination State ───

const PAGE_SIZE = 5;
const pageState = new Map(); // userId -> { page, closedTrades }

// ─── Helpers ───

function getClosedTrades(userId) {
  const trades = getUserTrades(userId);
  return trades.filter(t => t.status === 'closed').sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildTradeListEmbed(closedTrades, page) {
  const totalPages = Math.max(1, Math.ceil(closedTrades.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * PAGE_SIZE;
  const pageTrades = closedTrades.slice(start, start + PAGE_SIZE);

  const wins = closedTrades.filter(t => t.outcome === 'Win').length;
  const losses = closedTrades.filter(t => t.outcome === 'Loss').length;
  const winRate = closedTrades.length > 0 ? ((wins / closedTrades.length) * 100).toFixed(1) : '0.0';

  const embed = new EmbedBuilder()
    .setTitle('TRADE HISTORY')
    .setColor(0x6366f1);

  let desc = `**${closedTrades.length}** closed trade${closedTrades.length !== 1 ? 's' : ''} | `;
  desc += `**${wins}W / ${losses}L** (${winRate}% win rate)\n`;
  desc += `Page ${currentPage + 1} of ${totalPages}\n\n`;

  for (const trade of pageTrades) {
    const outcomeEmoji = trade.outcome === 'Win' ? '✅' : '❌';
    const dirEmoji = trade.direction?.toLowerCase() === 'long' ? '📈' : '📉';
    const opened = formatDate(trade.createdAt);
    const closed = formatDate(trade.closedAt);

    desc += `${outcomeEmoji} **#${trade.id} — ${trade.asset}** ${dirEmoji} ${trade.direction}\n`;
    desc += `Entry: ${trade.entry} → Exit: ${trade.exitPrice || 'N/A'} | Target: ${trade.target}\n`;
    desc += `${trade.timeframe} | ${opened} — ${closed}\n`;
    desc += `\`ID: ${trade.tradeId}\`\n\n`;
  }

  embed.setDescription(desc);
  return { embed, currentPage, totalPages };
}

// ─── Post-Mortem Prompts ───

const SINGLE_POSTMORTEM_PROMPT = `You are an expert trading coach and analyst conducting a post-mortem review of a completed trade. Analyze the trade details below and provide actionable insights.

Your analysis MUST include these sections:
1. **Trade Summary** — Recap the trade setup, direction, and outcome
2. **What Went Right** — Identify positive aspects of the trade decision
3. **What Went Wrong** — Identify mistakes, missed signals, or flawed reasoning
4. **Thesis vs. Reality** — Compare the original thesis/reasoning against the actual outcome
5. **Key Lessons** — 2-3 specific, actionable takeaways for future trades
6. **Rating** — Score the trade execution from 1-10 (separate from outcome — a losing trade can be well-executed)

Be direct, specific, and constructive. Reference the actual trade data.`;

const TIMEFRAME_POSTMORTEM_PROMPT = `You are an expert trading coach and analyst reviewing a series of completed trades over a specific time period. Analyze the trades below and identify patterns, trends, and areas for improvement.

Your analysis MUST include these sections:
1. **Period Overview** — Summary statistics (wins/losses, best/worst trades, assets traded)
2. **Performance Patterns** — Recurring strengths and weaknesses across trades
3. **Direction Bias** — Any tendency toward long/short, and whether it was profitable
4. **Emotional/Reasoning Patterns** — Common themes in the trader's reasoning across trades
5. **Risk Management Assessment** — How well entries, exits, and targets were managed
6. **Top 3 Actionable Improvements** — Specific changes that would improve future performance
7. **Overall Grade** — Letter grade (A-F) for the period's trading performance

Be analytical, specific, and reference actual trade data. Identify the single biggest area for improvement.`;

// ─── Payment Collection (reused from analyze.js pattern) ───

async function collectPayment(interaction, modeName) {
  const userId = interaction.user.id;

  const active = getActiveWallet(userId);
  if (!active) {
    const embed = new EmbedBuilder()
      .setTitle('Wallet Required')
      .setColor(0xef4444)
      .setDescription(
        'You need an active wallet to use AI trade analysis.\n' +
        'Use `/postfiat` to create one, or `/wallets import` to import an existing wallet.'
      );
    await interaction.editReply({ embeds: [embed], components: [] });
    return null;
  }

  const balance = await getBalance(active.address);
  if (balance === null || parseFloat(balance) < parseFloat(LLM_FEE_PFT)) {
    const embed = new EmbedBuilder()
      .setTitle('Insufficient Balance')
      .setColor(0xef4444)
      .setDescription(
        `You need at least **${LLM_FEE_PFT} PFT** to run this analysis.\n\n` +
        `**Your balance:** ${balance ?? '0 (not activated)'} PFT\n` +
        `**Wallet:** \`${active.address}\``
      );
    await interaction.editReply({ embeds: [embed], components: [] });
    return null;
  }

  const memo = `Journal Node - ${modeName}`;

  const confirmEmbed = new EmbedBuilder()
    .setTitle('Trade Post-Mortem — Payment Required')
    .setColor(0xf59e0b)
    .setDescription(
      `**Mode:** ${modeName}\n` +
      `**Fee:** ${LLM_FEE_PFT} PFT\n` +
      `**From:** \`${active.address}\`\n` +
      `**To:** \`${JOURNAL_NODE_WALLET}\`\n` +
      `**Your Balance:** ${balance} PFT\n\n` +
      'Click **Confirm & Pay** to proceed.'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('th_pay_confirm').setLabel(`Confirm & Pay ${LLM_FEE_PFT} PFT`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('th_pay_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

  let btnInteraction;
  try {
    const msg = await interaction.fetchReply();
    btnInteraction = await msg.awaitMessageComponent({
      filter: (i) => i.user.id === userId && (i.customId === 'th_pay_confirm' || i.customId === 'th_pay_cancel'),
      time: 60000,
    });
  } catch {
    const timeoutEmbed = new EmbedBuilder()
      .setTitle('Payment Timed Out')
      .setColor(0xef4444)
      .setDescription('Payment confirmation timed out. Run `/tradehistory` again.');
    await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    return null;
  }

  if (btnInteraction.customId === 'th_pay_cancel') {
    await btnInteraction.update({
      embeds: [new EmbedBuilder().setTitle('Analysis Cancelled').setColor(0x6b7280).setDescription('Payment was cancelled.')],
      components: [],
    });
    return null;
  }

  await btnInteraction.update({
    embeds: [new EmbedBuilder().setTitle('Processing Payment...').setColor(0xf59e0b).setDescription(`Sending ${LLM_FEE_PFT} PFT to Journal Node wallet...`)],
    components: [],
  });

  try {
    const seed = getWalletSeed(userId, active.address);
    if (!seed) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle('Wallet Error').setColor(0xef4444).setDescription('Could not retrieve your wallet credentials. Try `/wallets set-active` to reset.')],
      });
      return null;
    }

    const result = await sendPFT(seed, JOURNAL_NODE_WALLET, LLM_FEE_PFT, memo);
    const txUrl = `${PFT_EXPLORER}/${result.txHash}`;

    const confirmedEmbed = new EmbedBuilder()
      .setTitle('Payment Confirmed')
      .setColor(0x22c55e)
      .setDescription(
        `**Amount:** ${LLM_FEE_PFT} PFT\n` +
        `**Transaction:** [View on Explorer](${txUrl})\n\n` +
        `Running **${modeName}** analysis...`
      );
    await interaction.editReply({ embeds: [confirmedEmbed], components: [] });

    return { txHash: result.txHash, from: result.from, txUrl };
  } catch (err) {
    console.error(`[tradehistory] Payment failed:`, err.message);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('Payment Failed').setColor(0xef4444).setDescription(`Transaction failed: ${err.message}\n\nPlease try again.`)],
    });
    return null;
  }
}

// ─── Analysis Runners ───

async function runSinglePostMortem(interaction, trade) {
  const paymentTx = await collectPayment(interaction, 'Single Trade Post-Mortem');
  if (!paymentTx) return;

  const loadingEmbed = new EmbedBuilder()
    .setTitle(`Post-Mortem Analysis — #${trade.id} ${trade.asset}`)
    .setColor(0x6366f1)
    .setDescription('Analyzing trade... This may take a moment.');
  await interaction.editReply({ embeds: [loadingEmbed], components: [] });

  const tradeData = [
    `Trade #${trade.id}`,
    `Asset: ${trade.asset}`,
    `Direction: ${trade.direction}`,
    `Entry Price: ${trade.entry}`,
    `Exit Price: ${trade.exitPrice || 'Not recorded'}`,
    `Target Price: ${trade.target}`,
    `Timeframe: ${trade.timeframe}`,
    `Outcome: ${trade.outcome}`,
    `Opened: ${formatDate(trade.createdAt)}`,
    `Closed: ${formatDate(trade.closedAt)}`,
    `Original Reasoning: ${trade.emotionReasoning || 'Not provided'}`,
    `Post-Close Reflection: ${trade.reflection || 'Not provided'}`,
  ].join('\n');

  try {
    const analysis = await llmChat(SINGLE_POSTMORTEM_PROMPT, tradeData);

    const outcomeEmoji = trade.outcome === 'Win' ? '✅' : '❌';
    const dirEmoji = trade.direction?.toLowerCase() === 'long' ? '📈' : '📉';

    const resultEmbed = new EmbedBuilder()
      .setTitle(`Post-Mortem ${outcomeEmoji} — #${trade.id} ${trade.asset} ${dirEmoji}`)
      .setColor(trade.outcome === 'Win' ? 0x22c55e : 0xef4444)
      .setDescription(
        `**Trade:** ${trade.direction} ${trade.asset} | ${trade.entry} → ${trade.exitPrice || 'N/A'}\n` +
        `**Result:** ${trade.outcome} | **Timeframe:** ${trade.timeframe}\n` +
        `**Payment:** [View TX](${paymentTx.txUrl}) (${LLM_FEE_PFT} PFT)\n\n` +
        '─────────────────────────'
      );

    await interaction.editReply({ embeds: [resultEmbed], components: [] });

    // Send the analysis as follow-up (may be long)
    if (analysis.length <= 2000) {
      await interaction.followUp({ content: analysis, flags: 64 });
    } else {
      await interaction.followUp({ content: analysis.slice(0, 2000), flags: 64 });
      await sendLong(interaction, analysis.slice(2000));
    }
  } catch (err) {
    console.error('[tradehistory] Single post-mortem failed:', err);
    const errorEmbed = new EmbedBuilder()
      .setTitle('Analysis Failed')
      .setColor(0xef4444)
      .setDescription(`Post-mortem analysis failed: ${err.message}\n\nYour payment was processed. Please try again or contact support.`);
    await interaction.editReply({ embeds: [errorEmbed], components: [] });
  }
}

async function runTimeframePostMortem(interaction, trades, startDate, endDate) {
  const label = `${formatDate(startDate.toISOString())} — ${formatDate(endDate.toISOString())}`;
  const paymentTx = await collectPayment(interaction, `Timeframe Post-Mortem (${trades.length} trades)`);
  if (!paymentTx) return;

  const loadingEmbed = new EmbedBuilder()
    .setTitle(`Timeframe Analysis — ${label}`)
    .setColor(0x6366f1)
    .setDescription(`Analyzing ${trades.length} trades... This may take a moment.`);
  await interaction.editReply({ embeds: [loadingEmbed], components: [] });

  const tradesData = trades.map((t, i) => [
    `--- Trade ${i + 1} of ${trades.length} ---`,
    `Trade #${t.id} | Asset: ${t.asset} | Direction: ${t.direction}`,
    `Entry: ${t.entry} | Exit: ${t.exitPrice || 'N/A'} | Target: ${t.target}`,
    `Timeframe: ${t.timeframe} | Outcome: ${t.outcome}`,
    `Opened: ${formatDate(t.createdAt)} | Closed: ${formatDate(t.closedAt)}`,
    `Reasoning: ${t.emotionReasoning || 'Not provided'}`,
    `Reflection: ${t.reflection || 'Not provided'}`,
  ].join('\n')).join('\n\n');

  const wins = trades.filter(t => t.outcome === 'Win').length;
  const losses = trades.filter(t => t.outcome === 'Loss').length;

  const summary = `Period: ${label}\nTotal Trades: ${trades.length}\nWins: ${wins} | Losses: ${losses} | Win Rate: ${((wins / trades.length) * 100).toFixed(1)}%\n\n${tradesData}`;

  try {
    const analysis = await llmChat(TIMEFRAME_POSTMORTEM_PROMPT, summary);

    const winRate = ((wins / trades.length) * 100).toFixed(1);
    const resultEmbed = new EmbedBuilder()
      .setTitle(`Timeframe Analysis — ${label}`)
      .setColor(0x6366f1)
      .setDescription(
        `**Period:** ${label}\n` +
        `**Trades:** ${trades.length} | **${wins}W / ${losses}L** (${winRate}%)\n` +
        `**Payment:** [View TX](${paymentTx.txUrl}) (${LLM_FEE_PFT} PFT)\n\n` +
        '─────────────────────────'
      );

    await interaction.editReply({ embeds: [resultEmbed], components: [] });

    if (analysis.length <= 2000) {
      await interaction.followUp({ content: analysis, flags: 64 });
    } else {
      await interaction.followUp({ content: analysis.slice(0, 2000), flags: 64 });
      await sendLong(interaction, analysis.slice(2000));
    }
  } catch (err) {
    console.error('[tradehistory] Timeframe post-mortem failed:', err);
    const errorEmbed = new EmbedBuilder()
      .setTitle('Analysis Failed')
      .setColor(0xef4444)
      .setDescription(`Timeframe analysis failed: ${err.message}\n\nYour payment was processed. Please try again or contact support.`);
    await interaction.editReply({ embeds: [errorEmbed], components: [] });
  }
}

// ─── Pending analysis state ───

const pendingTimeframe = new Map(); // userId -> { closedTrades }

// ─── Module Export ───

module.exports = {
  name: 'tradehistory',
  description: 'View closed trade history and run AI post-mortem analysis on past trades.',
  needsEntries: false,
  isModal: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const closedTrades = getClosedTrades(userId);

    if (closedTrades.length === 0) {
      await interaction.editReply({
        content: 'You have no closed trades yet. Use `/mytrades` to close an open trade first.',
      });
      return;
    }

    const page = 0;
    pageState.set(userId, { page, closedTrades });

    const { embed, currentPage, totalPages } = buildTradeListEmbed(closedTrades, page);
    const components = buildComponents(closedTrades, currentPage, totalPages);
    await interaction.editReply({ embeds: [embed], components });
  },

  async handleButton(interaction) {
    const userId = interaction.user.id;
    const id = interaction.customId;

    // Payment buttons handled by collectPayment's awaitMessageComponent
    if (id === 'th_pay_confirm' || id === 'th_pay_cancel') return;

    const state = pageState.get(userId);

    if (id === 'th_prev' || id === 'th_next') {
      if (!state) {
        await interaction.reply({ content: 'Session expired. Run `/tradehistory` again.', flags: 64 });
        return;
      }

      const closedTrades = getClosedTrades(userId);
      const newPage = id === 'th_next' ? state.page + 1 : state.page - 1;
      pageState.set(userId, { page: newPage, closedTrades });

      const { embed, currentPage, totalPages } = buildTradeListEmbed(closedTrades, newPage);
      const components = buildComponents(closedTrades, currentPage, totalPages);
      await interaction.update({ embeds: [embed], components });
      return;
    }

    if (id === 'th_timeframe_analysis') {
      const closedTrades = getClosedTrades(userId);
      if (closedTrades.length === 0) {
        await interaction.reply({ content: 'No closed trades to analyze.', flags: 64 });
        return;
      }

      pendingTimeframe.set(userId, { closedTrades });

      // Build timeframe options based on available trade dates
      const options = [];

      // Last 7 days
      const now = new Date();
      const ranges = [
        { label: 'Last 7 Days', days: 7 },
        { label: 'Last 30 Days', days: 30 },
        { label: 'Last 90 Days', days: 90 },
        { label: 'All Time', days: 99999 },
      ];

      for (const range of ranges) {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - range.days);
        const count = closedTrades.filter(t => new Date(t.closedAt) >= cutoff).length;
        if (count > 0) {
          options.push({
            label: `${range.label} (${count} trade${count !== 1 ? 's' : ''})`,
            value: `tf_${range.days}`,
            description: `Analyze ${count} trade${count !== 1 ? 's' : ''} from the ${range.label.toLowerCase()}`,
          });
        }
      }

      if (options.length === 0) {
        await interaction.reply({ content: 'No closed trades found in any timeframe.', flags: 64 });
        return;
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('th_timeframe_select')
        .setPlaceholder('Select a timeframe to analyze...')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options);

      const embed = new EmbedBuilder()
        .setTitle('Timeframe Analysis')
        .setColor(0x6366f1)
        .setDescription(
          'Select a timeframe to run an AI post-mortem across all trades in that period.\n\n' +
          'The analysis will identify patterns, trends, and provide actionable improvements.\n\n' +
          `**Cost:** ${LLM_FEE_PFT} PFT`
        );

      await interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        flags: 64,
      });
      return;
    }
  },

  async handleSelectMenu(interaction) {
    const userId = interaction.user.id;
    const customId = interaction.customId;

    if (customId === 'th_select_trade') {
      const tradeId = interaction.values[0];
      const trade = getTradeByTradeId(userId, tradeId);
      if (!trade) {
        await interaction.reply({ content: 'Trade not found.', flags: 64 });
        return;
      }
      if (trade.status !== 'closed') {
        await interaction.reply({ content: 'This trade is still open. Close it first with `/mytrades`.', flags: 64 });
        return;
      }

      await interaction.deferReply({ flags: 64 });
      await runSinglePostMortem(interaction, trade);
      return;
    }

    if (customId === 'th_timeframe_select') {
      const value = interaction.values[0]; // e.g. "tf_30"
      const days = parseInt(value.replace('tf_', ''), 10);

      const closedTrades = getClosedTrades(userId);
      const now = new Date();
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - days);

      const filtered = closedTrades.filter(t => new Date(t.closedAt) >= cutoff);

      if (filtered.length === 0) {
        await interaction.reply({ content: 'No closed trades found in that timeframe.', flags: 64 });
        return;
      }

      await interaction.deferReply({ flags: 64 });

      const startDate = new Date(Math.min(...filtered.map(t => new Date(t.closedAt))));
      const endDate = new Date(Math.max(...filtered.map(t => new Date(t.closedAt))));
      await runTimeframePostMortem(interaction, filtered, startDate, endDate);
      return;
    }
  },
};

// ─── Build components helper (avoids reference error in buildTradeListComponents) ───

function buildComponents(closedTrades, currentPage, totalPages) {
  const components = [];

  // Pagination row
  if (totalPages > 1) {
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('th_prev')
        .setLabel('< Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('th_next')
        .setLabel('Next >')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1),
    );
    components.push(navRow);
  }

  // Trade select menu for individual analysis
  const start = currentPage * PAGE_SIZE;
  const pageTrades = closedTrades.slice(start, start + PAGE_SIZE);

  if (pageTrades.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('th_select_trade')
      .setPlaceholder('Select a trade for AI post-mortem...')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(pageTrades.map(t => ({
        label: `#${t.id} ${t.asset} ${t.direction} — ${t.outcome}`,
        value: t.tradeId,
        description: `${t.entry} → ${t.exitPrice || 'N/A'} | ${formatDate(t.closedAt)}`.slice(0, 100),
      })));
    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  // Timeframe analysis button
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('th_timeframe_analysis')
      .setLabel('Analyze Timeframe')
      .setStyle(ButtonStyle.Primary),
  );
  components.push(actionRow);

  return components;
}
