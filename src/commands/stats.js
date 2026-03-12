const { EmbedBuilder } = require('discord.js');
const { getUserTrades } = require('../tradeStore');
const { getUserAnalyses } = require('../analysisStore');

// ─── Helpers ───

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function calcPnlPercent(trade) {
  const entry = parseFloat(trade.entry);
  const exit = parseFloat(trade.exitPrice);
  if (isNaN(entry) || isNaN(exit) || entry === 0) return null;
  const isLong = trade.direction?.toLowerCase() === 'long';
  return isLong ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
}

// ─── Core Metrics ───

function computeTradeMetrics(trades) {
  const closed = trades.filter(t => t.status === 'closed');
  const open = trades.filter(t => t.status !== 'closed');

  if (closed.length === 0) {
    return null;
  }

  const wins = closed.filter(t => t.outcome === 'Win');
  const losses = closed.filter(t => t.outcome === 'Loss');
  const winRate = (wins.length / closed.length) * 100;

  // P&L calculations
  const pnlValues = closed
    .map(t => ({ trade: t, pnl: calcPnlPercent(t) }))
    .filter(p => p.pnl !== null);

  let avgPnl = null;
  let bestTrade = null;
  let worstTrade = null;
  let totalPnl = null;

  if (pnlValues.length > 0) {
    totalPnl = pnlValues.reduce((sum, p) => sum + p.pnl, 0);
    avgPnl = totalPnl / pnlValues.length;
    pnlValues.sort((a, b) => b.pnl - a.pnl);
    bestTrade = pnlValues[0];
    worstTrade = pnlValues[pnlValues.length - 1];
  }

  // Direction breakdown
  const longs = closed.filter(t => t.direction?.toLowerCase() === 'long');
  const shorts = closed.filter(t => t.direction?.toLowerCase() === 'short');
  const longWins = longs.filter(t => t.outcome === 'Win').length;
  const shortWins = shorts.filter(t => t.outcome === 'Win').length;

  // Asset breakdown — top 3 most traded
  const assetCounts = {};
  for (const t of closed) {
    const key = (t.asset || 'Unknown').toUpperCase();
    assetCounts[key] = (assetCounts[key] || 0) + 1;
  }
  const topAssets = Object.entries(assetCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Streak calculation
  let currentStreak = 0;
  let longestWinStreak = 0;
  let longestLoseStreak = 0;
  let tempWinStreak = 0;
  let tempLoseStreak = 0;

  const sortedClosed = [...closed].sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
  for (const t of sortedClosed) {
    if (t.outcome === 'Win') {
      tempWinStreak++;
      tempLoseStreak = 0;
      longestWinStreak = Math.max(longestWinStreak, tempWinStreak);
    } else {
      tempLoseStreak++;
      tempWinStreak = 0;
      longestLoseStreak = Math.max(longestLoseStreak, tempLoseStreak);
    }
  }

  // Current streak (from latest trade)
  if (sortedClosed.length > 0) {
    const lastOutcome = sortedClosed[sortedClosed.length - 1].outcome;
    let streak = 0;
    for (let i = sortedClosed.length - 1; i >= 0; i--) {
      if (sortedClosed[i].outcome === lastOutcome) streak++;
      else break;
    }
    currentStreak = lastOutcome === 'Win' ? streak : -streak;
  }

  return {
    total: trades.length,
    openCount: open.length,
    closedCount: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgPnl,
    totalPnl,
    bestTrade,
    worstTrade,
    longs: longs.length,
    shorts: shorts.length,
    longWinRate: longs.length > 0 ? (longWins / longs.length) * 100 : null,
    shortWinRate: shorts.length > 0 ? (shortWins / shorts.length) * 100 : null,
    topAssets,
    currentStreak,
    longestWinStreak,
    longestLoseStreak,
  };
}

// ─── Model vs User Accuracy ───

function computeAccuracyComparison(trades, analyses) {
  // Find closed trades that have bullish/bearish LLM analyses linked
  const closedWithAnalysis = [];

  for (const trade of trades) {
    if (trade.status !== 'closed') continue;

    const linked = analyses.filter(a => a.tradeId === trade.tradeId && a.mode === 'bullish');
    if (linked.length === 0) continue;

    closedWithAnalysis.push({ trade, analyses: linked });
  }

  if (closedWithAnalysis.length === 0) return null;

  let userCorrect = 0;
  let modelCorrect = 0;
  let totalCompared = closedWithAnalysis.length;

  for (const { trade, analyses: tradeAnalyses } of closedWithAnalysis) {
    const isLong = trade.direction?.toLowerCase() === 'long';
    const isWin = trade.outcome === 'Win';

    // User was correct if they won the trade
    if (isWin) userCorrect++;

    // For each bullish/bearish analysis, check if LLM consensus aligned with outcome
    for (const analysis of tradeAnalyses) {
      const { bullishCount = 0, bearishCount = 0 } = analysis.result || {};
      const modelSaysBullish = bullishCount > bearishCount;

      // Model was correct if:
      // - Trade is Long + Win and models said Bullish
      // - Trade is Long + Loss and models said Bearish
      // - Trade is Short + Win and models said Bearish
      // - Trade is Short + Loss and models said Bullish
      const priceWentUp = (isLong && isWin) || (!isLong && !isWin);
      if ((priceWentUp && modelSaysBullish) || (!priceWentUp && !modelSaysBullish)) {
        modelCorrect++;
      }
      break; // Use first analysis per trade
    }
  }

  return {
    totalCompared,
    userCorrect,
    userAccuracy: (userCorrect / totalCompared) * 100,
    modelCorrect,
    modelAccuracy: (modelCorrect / totalCompared) * 100,
  };
}

// ─── Build Embed ───

function buildStatsEmbed(username, metrics, accuracy) {
  const embed = new EmbedBuilder()
    .setTitle('TRADING PERFORMANCE DASHBOARD')
    .setColor(0x6366f1);

  let desc = `**Trader:** ${username}\n\n`;

  // ── Overview
  desc += '**━━━ Overview ━━━**\n';
  desc += `Total Trades: **${metrics.total}** (${metrics.openCount} open, ${metrics.closedCount} closed)\n`;
  desc += `Win Rate: **${metrics.winRate.toFixed(1)}%** (${metrics.wins}W / ${metrics.losses}L)\n`;

  if (metrics.currentStreak !== 0) {
    const streakLabel = metrics.currentStreak > 0
      ? `🔥 ${metrics.currentStreak}W streak`
      : `❄️ ${Math.abs(metrics.currentStreak)}L streak`;
    desc += `Current Streak: ${streakLabel}\n`;
  }

  desc += `Best Win Streak: **${metrics.longestWinStreak}** | Worst Lose Streak: **${metrics.longestLoseStreak}**\n\n`;

  // ── P&L Metrics
  desc += '**━━━ P&L Metrics ━━━**\n';
  if (metrics.avgPnl !== null) {
    const sign = (v) => v >= 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`;
    desc += `Average P&L: **${sign(metrics.avgPnl)}**\n`;
    desc += `Total P&L: **${sign(metrics.totalPnl)}**\n`;

    if (metrics.bestTrade) {
      const bt = metrics.bestTrade;
      desc += `Best Trade: **${sign(bt.pnl)}** — #${bt.trade.id} ${bt.trade.asset} ${bt.trade.direction}\n`;
    }
    if (metrics.worstTrade) {
      const wt = metrics.worstTrade;
      desc += `Worst Trade: **${sign(wt.pnl)}** — #${wt.trade.id} ${wt.trade.asset} ${wt.trade.direction}\n`;
    }
  } else {
    desc += '_P&L unavailable — entry/exit prices needed for calculation._\n';
  }
  desc += '\n';

  // ── Direction Breakdown
  desc += '**━━━ Direction Breakdown ━━━**\n';
  desc += `📈 Longs: **${metrics.longs}** trades`;
  if (metrics.longWinRate !== null) desc += ` (${metrics.longWinRate.toFixed(1)}% win rate)`;
  desc += '\n';
  desc += `📉 Shorts: **${metrics.shorts}** trades`;
  if (metrics.shortWinRate !== null) desc += ` (${metrics.shortWinRate.toFixed(1)}% win rate)`;
  desc += '\n';

  // ── Top Assets
  if (metrics.topAssets.length > 0) {
    desc += '\n**━━━ Most Traded Assets ━━━**\n';
    for (const [asset, count] of metrics.topAssets) {
      desc += `**${asset}** — ${count} trade${count !== 1 ? 's' : ''}\n`;
    }
  }

  // ── Model vs User Accuracy
  desc += '\n**━━━ User vs LLM Model Accuracy ━━━**\n';
  if (accuracy) {
    const userBar = buildBar(accuracy.userAccuracy);
    const modelBar = buildBar(accuracy.modelAccuracy);
    desc += `Trades with LLM analysis: **${accuracy.totalCompared}**\n\n`;
    desc += `🧠 Your Accuracy:  ${userBar} **${accuracy.userAccuracy.toFixed(1)}%** (${accuracy.userCorrect}/${accuracy.totalCompared})\n`;
    desc += `🤖 Model Consensus: ${modelBar} **${accuracy.modelAccuracy.toFixed(1)}%** (${accuracy.modelCorrect}/${accuracy.totalCompared})\n`;

    const diff = accuracy.userAccuracy - accuracy.modelAccuracy;
    if (Math.abs(diff) < 1) {
      desc += '\n_You and the models are neck and neck._\n';
    } else if (diff > 0) {
      desc += `\n_You're outperforming the LLM consensus by **${diff.toFixed(1)}pp**._\n`;
    } else {
      desc += `\n_The LLM consensus is ahead by **${Math.abs(diff).toFixed(1)}pp**. Consider weighing model signals more heavily._\n`;
    }
  } else {
    desc += '_No closed trades with LLM analysis found._\n';
    desc += '_Run `/llmanalyze` on your trades to enable accuracy comparison._\n';
  }

  embed.setDescription(desc);
  embed.setFooter({ text: 'Journal Node — Trading Performance Dashboard' });
  embed.setTimestamp();

  return embed;
}

function buildBar(pct) {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// ─── Module Export ───

module.exports = {
  name: 'stats',
  description: 'View your personal trading performance dashboard with win rate, P&L, and model accuracy.',
  needsEntries: false,

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const trades = getUserTrades(userId);

    if (trades.length === 0) {
      await interaction.editReply({
        content: 'You have no trades yet. Use `/trade` to log your first trade.',
      });
      return;
    }

    const metrics = computeTradeMetrics(trades);

    if (!metrics) {
      await interaction.editReply({
        content: 'You have no closed trades yet. Use `/mytrades` to close an open trade first, then check your stats.',
      });
      return;
    }

    const analyses = getUserAnalyses(userId);
    const accuracy = computeAccuracyComparison(trades, analyses);

    const embed = buildStatsEmbed(username, metrics, accuracy);
    await interaction.editReply({ embeds: [embed] });
  },
};
