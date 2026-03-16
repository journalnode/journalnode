const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getAllLinkedWallets } = require('./hyperliquidStore');
const { addTrade, getOpenTrades, closeTrade } = require('./tradeStore');

const HL_API = 'https://api.hyperliquid.xyz/info';
const POLL_INTERVAL_MS = 30_000; // 30 seconds

// In-memory cache of known positions per wallet to detect new ones and closes
// Structure: { [userId_walletId]: { [coin_direction]: { szi, entryPx } } }
const knownPositions = new Map();

/**
 * Fetch a user's open perpetual positions from Hyperliquid.
 * Returns an array of position objects or empty array on error.
 */
async function fetchPositions(walletAddress) {
  try {
    const res = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: walletAddress,
      }),
    });

    if (!res.ok) {
      console.error(`[HL Poller] API error ${res.status} for ${walletAddress}`);
      return [];
    }

    const data = await res.json();
    if (!data.assetPositions) return [];

    return data.assetPositions
      .map(ap => ap.position)
      .filter(p => p && parseFloat(p.szi) !== 0);
  } catch (err) {
    console.error(`[HL Poller] Fetch error for ${walletAddress}:`, err.message);
    return [];
  }
}

/**
 * Fetch recent trade fills for a wallet from Hyperliquid.
 * Used to determine exit price when a position is closed.
 */
async function fetchRecentFills(walletAddress) {
  try {
    const res = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'userFills',
        user: walletAddress,
      }),
    });

    if (!res.ok) {
      console.error(`[HL Poller] Fills API error ${res.status} for ${walletAddress}`);
      return [];
    }

    return await res.json();
  } catch (err) {
    console.error(`[HL Poller] Fetch fills error for ${walletAddress}:`, err.message);
    return [];
  }
}

/**
 * Get the exit price from recent fills for a closed position.
 * Looks for the most recent fill matching the coin within the last 2 minutes.
 */
function getExitPriceFromFills(fills, coin) {
  const now = Date.now();
  const lookbackMs = 2 * 60 * 1000; // 2 minutes

  // Filter fills for this coin within the lookback window, sorted newest first
  const relevant = fills
    .filter(f => f.coin === coin && (now - f.time) < lookbackMs)
    .sort((a, b) => b.time - a.time);

  if (relevant.length === 0) return null;

  // If multiple fills closed the position, compute volume-weighted average price
  let totalValue = 0;
  let totalSize = 0;
  for (const fill of relevant) {
    const px = parseFloat(fill.px);
    const sz = parseFloat(fill.sz);
    totalValue += px * sz;
    totalSize += sz;
  }

  return totalSize > 0 ? (totalValue / totalSize) : parseFloat(relevant[0].px);
}

/**
 * Build a unique key for a position to track it.
 */
function positionKey(position) {
  const direction = parseFloat(position.szi) > 0 ? 'Long' : 'Short';
  return `${position.coin}_${direction}`;
}

/**
 * Build the cache key for a user+wallet combination.
 */
function cacheKey(userId, walletId) {
  return `${userId}_${walletId}`;
}

/**
 * Detect closed positions by comparing current positions with known ones.
 * A position is "closed" if it was in the known cache but is no longer in current positions.
 * Must be called BEFORE detectNewPositions (which updates the cache).
 */
function detectClosedPositions(cacheId, currentPositions) {
  const known = knownPositions.get(cacheId) || {};
  const currentKeys = new Set(currentPositions.map(pos => positionKey(pos)));
  const closedPositions = [];

  for (const [key, data] of Object.entries(known)) {
    if (!currentKeys.has(key)) {
      const [coin, direction] = key.split('_');
      closedPositions.push({ coin, direction, ...data });
    }
  }

  return closedPositions;
}

/**
 * Detect new positions by comparing current positions with known ones.
 * A position is "new" if we haven't seen that coin+direction combination before.
 * Also updates the known positions cache.
 */
function detectNewPositions(cacheId, currentPositions) {
  const known = knownPositions.get(cacheId) || {};
  const newPositions = [];

  for (const pos of currentPositions) {
    const key = positionKey(pos);
    if (!known[key]) {
      newPositions.push(pos);
    }
  }

  // Update known positions to current state
  const updated = {};
  for (const pos of currentPositions) {
    const key = positionKey(pos);
    updated[key] = {
      szi: pos.szi,
      entryPx: pos.entryPx,
    };
  }
  knownPositions.set(cacheId, updated);

  return newPositions;
}

/**
 * Initialize known positions for a wallet (so we don't alert on existing positions at startup).
 */
async function initializeUserPositions(cacheId, walletAddress) {
  const positions = await fetchPositions(walletAddress);
  const known = {};
  for (const pos of positions) {
    const key = positionKey(pos);
    known[key] = {
      szi: pos.szi,
      entryPx: pos.entryPx,
    };
  }
  knownPositions.set(cacheId, known);
  return positions.length;
}

/**
 * Build a Discord embed for a new Hyperliquid position.
 * Includes wallet label to distinguish which account the trade came from.
 */
function buildPositionEmbed(position, username, walletLabel) {
  const size = parseFloat(position.szi);
  const direction = size > 0 ? 'Long' : 'Short';
  const dirEmoji = direction === 'Long' ? '📈' : '📉';
  const absSize = Math.abs(size);
  const entryPrice = parseFloat(position.entryPx);
  const leverage = position.leverage?.value || 'N/A';
  const leverageType = position.leverage?.type || 'cross';
  const liquidationPx = position.liquidationPx
    ? `$${parseFloat(position.liquidationPx).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'N/A';
  const positionValue = position.positionValue
    ? `$${parseFloat(position.positionValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'N/A';

  const embed = new EmbedBuilder()
    .setTitle(`${dirEmoji} HYPERLIQUID — ${position.coin} ${direction.toUpperCase()}`)
    .setColor(direction === 'Long' ? 0x22c55e : 0xef4444)
    .setTimestamp();

  let desc = '';
  desc += `**Trader:** ${username}\n`;
  desc += `**Wallet:** 🏷️ ${walletLabel}\n`;
  desc += `**Asset:** ${position.coin}\n`;
  desc += `**Direction:** ${dirEmoji} ${direction.toUpperCase()}\n`;
  desc += `**Size:** ${absSize} ${position.coin}\n`;
  desc += `**Entry Price:** $${entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}\n`;
  desc += `**Position Value:** ${positionValue}\n`;
  desc += `**Leverage:** ${leverage}x (${leverageType})\n`;
  desc += `**Liquidation Price:** ${liquidationPx}\n`;
  desc += `\n_Detected via Hyperliquid integration_`;

  embed.setDescription(desc);
  return embed;
}

/**
 * Build a Discord embed for a closed Hyperliquid position.
 * Includes wallet label for multi-wallet identification.
 */
function buildCloseEmbed(closedPos, exitPrice, trade, username, walletLabel) {
  const { coin, direction, szi, entryPx } = closedPos;
  const entry = parseFloat(entryPx);
  const exit = exitPrice ? parseFloat(exitPrice) : null;
  const absSize = Math.abs(parseFloat(szi));
  const dirEmoji = direction === 'Long' ? '📈' : '📉';

  // Calculate P&L
  let pnl = null;
  let pnlPercent = null;
  let isWin = null;
  if (exit !== null && entry > 0) {
    if (direction === 'Long') {
      pnl = (exit - entry) * absSize;
      pnlPercent = ((exit - entry) / entry) * 100;
    } else {
      pnl = (entry - exit) * absSize;
      pnlPercent = ((entry - exit) / entry) * 100;
    }
    isWin = pnl >= 0;
  }

  // Calculate trade duration
  let durationStr = 'Unknown';
  if (trade && trade.createdAt) {
    const openTime = new Date(trade.createdAt).getTime();
    const closeTime = Date.now();
    const durationMs = closeTime - openTime;
    durationStr = formatDuration(durationMs);
  }

  const outcomeEmoji = isWin === null ? '🔒' : (isWin ? '✅' : '❌');
  const outcomeText = isWin === null ? 'CLOSED' : (isWin ? 'WIN' : 'LOSS');

  const embed = new EmbedBuilder()
    .setTitle(`🔒 HYPERLIQUID — ${coin} ${direction.toUpperCase()} CLOSED ${outcomeEmoji}`)
    .setColor(isWin === null ? 0x6b7280 : (isWin ? 0x22c55e : 0xef4444))
    .setTimestamp();

  let desc = '';
  desc += `**Trader:** ${username}\n`;
  desc += `**Wallet:** 🏷️ ${walletLabel}\n`;
  desc += `**Asset:** ${coin}\n`;
  desc += `**Direction:** ${dirEmoji} ${direction.toUpperCase()}\n`;
  desc += `**Size:** ${absSize} ${coin}\n`;
  desc += `**Entry Price:** $${entry.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}\n`;

  if (exit !== null) {
    desc += `**Exit Price:** $${exit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}\n`;
  } else {
    desc += `**Exit Price:** _Unavailable_\n`;
  }

  desc += '\n';

  if (pnl !== null) {
    const pnlSign = pnl >= 0 ? '+' : '';
    const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
    desc += `**Realized P&L:** ${pnlEmoji} ${pnlSign}$${pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pnlSign}${pnlPercent.toFixed(2)}%)\n`;
    desc += `**Outcome:** ${outcomeEmoji} **${outcomeText}**\n`;
  }

  desc += `**Duration:** ${durationStr}\n`;

  if (trade) {
    desc += `\n**Opened:** ${new Date(trade.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}\n`;
    desc += `**Closed:** ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}\n`;
  }

  desc += `\n_Auto-closed via Hyperliquid integration_`;

  embed.setDescription(desc);

  if (trade) {
    embed.setFooter({ text: `Trade Ticket #${trade.id} • ID: ${trade.tradeId}` });
  }

  return { embed, pnl, pnlPercent, isWin };
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainHours = hours % 24;
    return `${days}d ${remainHours}h`;
  }
  if (hours > 0) {
    const remainMinutes = minutes % 60;
    return `${hours}h ${remainMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Find the matching open trade ticket for a closed Hyperliquid position.
 * Matches on wallet ID if available, otherwise falls back to coin+direction.
 */
function findMatchingTrade(userId, coin, direction, walletId) {
  const openTrades = getOpenTrades(userId);
  // Prefer matching by walletId for multi-wallet accuracy
  if (walletId) {
    const match = openTrades.find(t =>
      t.source === 'hyperliquid' &&
      t.asset === coin &&
      t.direction === direction &&
      t.walletId === walletId
    );
    if (match) return match;
  }
  // Fallback: match without walletId (legacy trades)
  return openTrades.find(t =>
    t.source === 'hyperliquid' &&
    t.asset === coin &&
    t.direction === direction
  ) || null;
}

/**
 * Auto-close a trade ticket with P&L data from Hyperliquid.
 */
function autoCloseTradeTicket(userId, tradeId, exitPrice, pnl, pnlPercent, isWin) {
  const outcome = isWin === null ? 'Win' : (isWin ? 'Win' : 'Loss');
  return closeTrade(userId, tradeId, {
    outcome,
    exitPrice: exitPrice ? String(exitPrice) : null,
    reflection: 'Auto-closed — position closed on Hyperliquid.',
    closeScreenshotUrl: null,
    pnl: pnl !== null ? pnl : undefined,
    pnlPercent: pnlPercent !== null ? pnlPercent : undefined,
  });
}

/**
 * Create a trade ticket from a Hyperliquid position.
 * Includes walletLabel and walletId for multi-wallet identification.
 */
function createTradeTicket(userId, position, username, walletLabel, walletId) {
  const size = parseFloat(position.szi);
  const direction = size > 0 ? 'Long' : 'Short';
  const absSize = Math.abs(size);
  const entryPrice = position.entryPx;
  const leverage = position.leverage?.value || 'N/A';

  const trade = addTrade(userId, {
    asset: position.coin,
    direction,
    entry: entryPrice,
    target: 'N/A (Hyperliquid)',
    stopLoss: position.liquidationPx || null,
    timeframe: 'Live',
    emotionReasoning: `Auto-detected from Hyperliquid [${walletLabel}] — ${absSize} ${position.coin} @ ${leverage}x leverage`,
    screenshotUrl: null,
    username,
    status: 'open',
    source: 'hyperliquid',
    walletLabel,
    walletId,
  });

  return trade;
}

/**
 * Check if a Hyperliquid position already has an open trade ticket to avoid duplicates.
 * Checks per walletId for multi-wallet accuracy.
 */
function hasExistingTicket(userId, coin, direction, walletId) {
  const openTrades = getOpenTrades(userId);
  return openTrades.some(t =>
    t.source === 'hyperliquid' &&
    t.asset === coin &&
    t.direction === direction &&
    (walletId ? t.walletId === walletId : true)
  );
}

/**
 * Start the polling loop. Call this once after bot is ready.
 * @param {Client} client - The Discord client for posting embeds.
 */
function startPoller(client) {
  console.log(`[HL Poller] Starting position poller (interval: ${POLL_INTERVAL_MS / 1000}s)`);

  // Initial snapshot of all linked wallets
  (async () => {
    const wallets = getAllLinkedWallets();
    for (const { userId, id: walletId, wallet, label } of wallets) {
      const ck = cacheKey(userId, walletId);
      const count = await initializeUserPositions(ck, wallet);
      console.log(`[HL Poller] Initialized ${count} existing positions for user ${userId} wallet "${label}"`);
    }
  })();

  setInterval(async () => {
    const wallets = getAllLinkedWallets();
    if (wallets.length === 0) return;

    for (const { userId, id: walletId, wallet, label: walletLabel, channelId } of wallets) {
      try {
        const ck = cacheKey(userId, walletId);
        const positions = await fetchPositions(wallet);

        // Detect closed positions BEFORE updating the cache
        const closedPositions = detectClosedPositions(ck, positions);

        // Detect new positions (this also updates the cache)
        const newPositions = detectNewPositions(ck, positions);

        const hasActivity = newPositions.length > 0 || closedPositions.length > 0;
        if (!hasActivity) continue;

        // Fetch the channel to post in
        let channel;
        try {
          channel = await client.channels.fetch(channelId);
        } catch (err) {
          console.error(`[HL Poller] Cannot fetch channel ${channelId}:`, err.message);
          continue;
        }

        // Fetch user info for display name
        let username = 'Unknown';
        try {
          const user = await client.users.fetch(userId);
          username = user.username;
        } catch (err) {
          console.error(`[HL Poller] Cannot fetch user ${userId}:`, err.message);
        }

        // Handle closed positions
        if (closedPositions.length > 0) {
          // Fetch recent fills to determine exit prices
          const fills = await fetchRecentFills(wallet);

          for (const closedPos of closedPositions) {
            console.log(`[HL Poller] Position closed: ${username} [${walletLabel}] ${closedPos.direction} ${closedPos.coin}`);

            // Get exit price from recent fills
            const exitPrice = getExitPriceFromFills(fills, closedPos.coin);

            // Find matching open trade ticket
            const trade = findMatchingTrade(userId, closedPos.coin, closedPos.direction, walletId);

            // Build close notification embed with wallet label
            const { embed, pnl, pnlPercent, isWin } = buildCloseEmbed(closedPos, exitPrice, trade, username, walletLabel);

            // Auto-close the trade ticket if found
            if (trade) {
              autoCloseTradeTicket(userId, trade.tradeId, exitPrice, pnl, pnlPercent, isWin);
              console.log(`[HL Poller] Auto-closed trade ticket #${trade.id} for ${closedPos.coin} ${closedPos.direction} [${walletLabel}]`);
            }

            try {
              await channel.send({ embeds: [embed] });
            } catch (err) {
              console.error(`[HL Poller] Failed to post close embed in channel ${channelId}:`, err.message);
            }
          }
        }

        // Handle new positions
        for (const pos of newPositions) {
          const size = parseFloat(pos.szi);
          const direction = size > 0 ? 'Long' : 'Short';

          // Skip if there's already an open trade ticket for this exact position on this wallet
          if (hasExistingTicket(userId, pos.coin, direction, walletId)) {
            console.log(`[HL Poller] Skipping duplicate ticket for ${pos.coin} ${direction} [${walletLabel}] (user ${userId})`);
            continue;
          }

          console.log(`[HL Poller] New position detected: ${username} [${walletLabel}] ${direction} ${pos.coin} @ ${pos.entryPx}`);

          // Build and post the embed with wallet label
          const embed = buildPositionEmbed(pos, username, walletLabel);

          // Create trade ticket with wallet info
          const trade = createTradeTicket(userId, pos, username, walletLabel, walletId);

          // Add trade ticket reference to embed
          embed.setFooter({ text: `Trade Ticket #${trade.id} • ID: ${trade.tradeId} • 🏷️ ${walletLabel}` });

          // Add LLM Analysis button
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`trade_llma_${trade.tradeId}`)
              .setLabel('Run LLM Analysis')
              .setEmoji('🔍')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`close_trade_${trade.tradeId}`)
              .setLabel(`Close Trade #${trade.id}`)
              .setStyle(ButtonStyle.Danger),
          );

          try {
            await channel.send({ embeds: [embed], components: [row] });
          } catch (err) {
            console.error(`[HL Poller] Failed to post embed in channel ${channelId}:`, err.message);
          }
        }
      } catch (err) {
        console.error(`[HL Poller] Error polling user ${userId} wallet "${walletLabel}":`, err.message);
      }
    }
  }, POLL_INTERVAL_MS);
}

module.exports = { startPoller, fetchPositions, initializeUserPositions };
