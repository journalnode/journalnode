const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getAllLinkedWallets } = require('./hyperliquidStore');
const { addTrade, getOpenTrades } = require('./tradeStore');

const HL_API = 'https://api.hyperliquid.xyz/info';
const POLL_INTERVAL_MS = 30_000; // 30 seconds

// In-memory cache of known positions per user to detect new ones
// Structure: { [userId]: { [coin_direction]: { szi, entryPx } } }
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
 * Build a unique key for a position to track it.
 */
function positionKey(position) {
  const direction = parseFloat(position.szi) > 0 ? 'Long' : 'Short';
  return `${position.coin}_${direction}`;
}

/**
 * Detect new positions by comparing current positions with known ones.
 * A position is "new" if we haven't seen that coin+direction combination before.
 */
function detectNewPositions(userId, currentPositions) {
  const known = knownPositions.get(userId) || {};
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
  knownPositions.set(userId, updated);

  return newPositions;
}

/**
 * Initialize known positions for a user (so we don't alert on existing positions at startup).
 */
async function initializeUserPositions(userId, walletAddress) {
  const positions = await fetchPositions(walletAddress);
  const known = {};
  for (const pos of positions) {
    const key = positionKey(pos);
    known[key] = {
      szi: pos.szi,
      entryPx: pos.entryPx,
    };
  }
  knownPositions.set(userId, known);
  return positions.length;
}

/**
 * Build a Discord embed for a new Hyperliquid position.
 */
function buildPositionEmbed(position, username) {
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
 * Create a trade ticket from a Hyperliquid position.
 */
function createTradeTicket(userId, position, username) {
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
    emotionReasoning: `Auto-detected from Hyperliquid — ${absSize} ${position.coin} @ ${leverage}x leverage`,
    screenshotUrl: null,
    username,
    status: 'open',
    source: 'hyperliquid',
  });

  return trade;
}

/**
 * Check if a Hyperliquid position already has an open trade ticket to avoid duplicates.
 */
function hasExistingTicket(userId, coin, direction) {
  const openTrades = getOpenTrades(userId);
  return openTrades.some(t =>
    t.source === 'hyperliquid' &&
    t.asset === coin &&
    t.direction === direction
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
    for (const { userId, wallet } of wallets) {
      const count = await initializeUserPositions(userId, wallet);
      console.log(`[HL Poller] Initialized ${count} existing positions for user ${userId}`);
    }
  })();

  setInterval(async () => {
    const wallets = getAllLinkedWallets();
    if (wallets.length === 0) return;

    for (const { userId, wallet, channelId } of wallets) {
      try {
        const positions = await fetchPositions(wallet);
        const newPositions = detectNewPositions(userId, positions);

        if (newPositions.length === 0) continue;

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

        for (const pos of newPositions) {
          const size = parseFloat(pos.szi);
          const direction = size > 0 ? 'Long' : 'Short';

          // Skip if there's already an open trade ticket for this exact position
          if (hasExistingTicket(userId, pos.coin, direction)) {
            console.log(`[HL Poller] Skipping duplicate ticket for ${pos.coin} ${direction} (user ${userId})`);
            continue;
          }

          console.log(`[HL Poller] New position detected: ${username} ${direction} ${pos.coin} @ ${pos.entryPx}`);

          // Build and post the embed
          const embed = buildPositionEmbed(pos, username);

          // Create trade ticket
          const trade = createTradeTicket(userId, pos, username);

          // Add trade ticket reference to embed
          embed.setFooter({ text: `Trade Ticket #${trade.id} • ID: ${trade.tradeId}` });

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
        console.error(`[HL Poller] Error polling user ${userId}:`, err.message);
      }
    }
  }, POLL_INTERVAL_MS);
}

module.exports = { startPoller, fetchPositions, initializeUserPositions };
