const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { addAsset, removeAsset, getWatchlist } = require('../watchlistStore');

// ─── Hyperliquid price fetching (reuses same API as /chart) ───

const HL_API = 'https://api.hyperliquid.xyz/info';
const HIP3_PREFIXES = ['xyz', 'km', 'hyna', 'vntl'];

const TIMEFRAME_CHOICES = [
  { label: '1 Minute',  value: '1m' },
  { label: '5 Minute',  value: '5m' },
  { label: '15 Minute', value: '15m' },
  { label: '30 Minute', value: '30m' },
  { label: '1 Hour',    value: '1h' },
  { label: '4 Hour',    value: '4h' },
  { label: 'Daily',     value: '1d' },
  { label: 'Weekly',    value: '1w' },
];

async function fetchLatestPrice(coin) {
  const now = Date.now();
  const startTime = now - (60 * 60 * 1000); // 1 hour of 1m candles

  async function tryFetch(symbol) {
    const res = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: { coin: symbol, interval: '1m', startTime, endTime: now },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data;
  }

  // Try as crypto first
  const upper = coin.toUpperCase();
  const cryptoData = await tryFetch(upper);
  if (cryptoData) {
    const last = cryptoData[cryptoData.length - 1];
    return { price: parseFloat(last.c), resolvedCoin: upper, isTradfi: false };
  }

  // Try HIP-3 prefixes
  for (const prefix of HIP3_PREFIXES) {
    const symbol = `${prefix}:${upper}`;
    const data = await tryFetch(symbol);
    if (data) {
      const last = data[data.length - 1];
      return { price: parseFloat(last.c), resolvedCoin: symbol, isTradfi: true };
    }
  }

  return null;
}

function formatPrice(price) {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.001) return price.toFixed(6);
  return price.toFixed(8);
}

// ─── Subcommand handlers ───

async function handleAdd(interaction) {
  const ticker = interaction.options.getString('ticker');
  const coin = ticker.toUpperCase().replace(/[-/].*$/, '').replace(/USDT?$|USD$|PERP$/i, '');
  const userId = interaction.user.id;

  // Verify the asset exists on Hyperliquid before adding
  const priceData = await fetchLatestPrice(coin);
  if (!priceData) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('Asset Not Found')
      .setColor(0xef4444)
      .setDescription(
        `Could not find **${coin}** on Hyperliquid.\n\n` +
        'Crypto tickers: `BTC`, `ETH`, `SOL`, `DOGE`\n' +
        'Stock tickers: `NVDA`, `TSLA`, `AAPL`, `GOOGL`, `AMZN`'
      );
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const result = addAsset(userId, coin);
  if (!result) {
    const embed = new EmbedBuilder()
      .setTitle('Already Tracked')
      .setColor(0xf59e0b)
      .setDescription(`**${coin}** is already on your watchlist.`);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const displayName = priceData.resolvedCoin.includes(':')
    ? priceData.resolvedCoin.split(':')[1]
    : priceData.resolvedCoin;
  const tag = priceData.isTradfi ? ' (Stock)' : '';

  const embed = new EmbedBuilder()
    .setTitle('Asset Added to Watchlist')
    .setColor(0x22c55e)
    .setDescription(
      `**${displayName}${tag}** has been added to your watchlist.\n\n` +
      `**Current Price:** $${formatPrice(priceData.price)}`
    )
    .setFooter({ text: 'Use /watchlist view to see your full list' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleRemove(interaction) {
  const ticker = interaction.options.getString('ticker');
  const coin = ticker.toUpperCase().replace(/[-/].*$/, '').replace(/USDT?$|USD$|PERP$/i, '');
  const userId = interaction.user.id;

  const removed = removeAsset(userId, coin);
  if (!removed) {
    const embed = new EmbedBuilder()
      .setTitle('Not Found')
      .setColor(0xef4444)
      .setDescription(`**${coin}** is not on your watchlist.`);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Asset Removed')
    .setColor(0xef4444)
    .setDescription(`**${coin}** has been removed from your watchlist.`)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleView(interaction) {
  const userId = interaction.user.id;
  const watchlist = getWatchlist(userId);

  if (watchlist.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('Your Watchlist')
      .setColor(0x6366f1)
      .setDescription('Your watchlist is empty.\n\nUse `/watchlist add <ticker>` to start tracking assets.')
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Fetch live prices for all assets in parallel
  const priceResults = await Promise.all(
    watchlist.map(async (asset) => {
      const data = await fetchLatestPrice(asset.ticker);
      return {
        ticker: asset.ticker,
        addedAt: asset.addedAt,
        price: data ? data.price : null,
        resolvedCoin: data ? data.resolvedCoin : asset.ticker,
        isTradfi: data ? data.isTradfi : false,
      };
    })
  );

  // Build the watchlist display
  const lines = priceResults.map((item, i) => {
    const displayName = item.resolvedCoin.includes(':')
      ? item.resolvedCoin.split(':')[1]
      : item.resolvedCoin;
    const tag = item.isTradfi ? ' (Stock)' : '';
    const priceStr = item.price !== null
      ? `$${formatPrice(item.price)}`
      : 'Price unavailable';
    return `**${i + 1}.** ${displayName}${tag} — ${priceStr}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('Your Watchlist')
    .setColor(0x6366f1)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${watchlist.length} asset${watchlist.length !== 1 ? 's' : ''} tracked \u00B7 Prices via Hyperliquid` })
    .setTimestamp();

  // Build chart buttons — one row per asset (max 5 rows Discord limit)
  // Use a select menu approach: user picks asset, then picks timeframe
  const components = [];

  if (priceResults.length > 0) {
    const assetOptions = priceResults
      .filter(item => item.price !== null)
      .slice(0, 25) // select menu max
      .map(item => {
        const displayName = item.resolvedCoin.includes(':')
          ? item.resolvedCoin.split(':')[1]
          : item.resolvedCoin;
        return {
          label: displayName,
          value: item.ticker,
          description: `$${formatPrice(item.price)}`,
        };
      });

    if (assetOptions.length > 0) {
      const assetSelect = new StringSelectMenuBuilder()
        .setCustomId('wl_chart_asset')
        .setPlaceholder('View chart for an asset...')
        .addOptions(assetOptions);
      components.push(new ActionRowBuilder().addComponents(assetSelect));
    }
  }

  await interaction.editReply({ embeds: [embed], components });
}

// ─── Button / Select Menu handlers ───

async function handleSelectMenu(interaction) {
  if (interaction.customId === 'wl_chart_asset') {
    const ticker = interaction.values[0];

    // Show timeframe select
    const tfSelect = new StringSelectMenuBuilder()
      .setCustomId(`wl_chart_tf_${ticker}`)
      .setPlaceholder('Select chart timeframe...')
      .addOptions(TIMEFRAME_CHOICES);

    const row = new ActionRowBuilder().addComponents(tfSelect);

    await interaction.reply({
      content: `Select a timeframe for **${ticker}** chart:`,
      components: [row],
      flags: 64,
    });
  } else if (interaction.customId.startsWith('wl_chart_tf_')) {
    const ticker = interaction.customId.replace('wl_chart_tf_', '');
    const timeframe = interaction.values[0];

    // Defer and invoke the chart logic directly
    await interaction.deferReply();

    try {
      const coin = ticker.toUpperCase();
      const TIMEFRAMES = {
        '1m':  { interval: '1m',  candles: 60,  label: '1 Minute' },
        '3m':  { interval: '3m',  candles: 60,  label: '3 Minute' },
        '5m':  { interval: '5m',  candles: 60,  label: '5 Minute' },
        '15m': { interval: '15m', candles: 60,  label: '15 Minute' },
        '30m': { interval: '30m', candles: 60,  label: '30 Minute' },
        '1h':  { interval: '1h',  candles: 60,  label: '1 Hour' },
        '2h':  { interval: '2h',  candles: 60,  label: '2 Hour' },
        '4h':  { interval: '4h',  candles: 60,  label: '4 Hour' },
        '8h':  { interval: '8h',  candles: 60,  label: '8 Hour' },
        '12h': { interval: '12h', candles: 60,  label: '12 Hour' },
        '1d':  { interval: '1d',  candles: 90,  label: 'Daily' },
        '3d':  { interval: '3d',  candles: 60,  label: '3 Day' },
        '1w':  { interval: '1w',  candles: 52,  label: 'Weekly' },
        '1M':  { interval: '1M',  candles: 24,  label: 'Monthly' },
      };
      const tf = TIMEFRAMES[timeframe];

      const { candles, resolvedCoin, isTradfi } = await fetchCandlesForChart(coin, tf.interval, tf.candles);
      const displayName = resolvedCoin.includes(':') ? resolvedCoin.split(':')[1] : resolvedCoin;
      const assetTag = isTradfi ? ' (Stock)' : '';

      const { buffer, currentPrice, change, changeSymbol } = await renderCandlestickChart(candles, displayName, tf.interval, tf.label);

      const { AttachmentBuilder } = require('discord.js');
      const file = new AttachmentBuilder(buffer, { name: 'chart.png' });
      const changeColor = parseFloat(change) >= 0 ? 0x22c55e : 0xef4444;

      const embed = new EmbedBuilder()
        .setTitle(`${displayName}${assetTag} \u00B7 ${tf.label} \u00B7 $${formatPrice(currentPrice)}`)
        .setColor(changeColor)
        .setDescription(`${changeSymbol} **${change}%** | Data via Hyperliquid`)
        .setImage('attachment://chart.png')
        .setFooter({ text: `${candles.length} candles \u00B7 ${tf.label} timeframe` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [file] });
    } catch (err) {
      console.error('[watchlist chart] Error:', err.message);
      const errorEmbed = new EmbedBuilder()
        .setTitle('Chart Error')
        .setColor(0xef4444)
        .setDescription(`Failed to load chart for **${ticker}**: ${err.message}`);
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
}

// ─── Candle fetching & rendering (shared with chart.js logic) ───

const INTERVAL_MS = {
  '1m':  60 * 1000,
  '3m':  3 * 60 * 1000,
  '5m':  5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '2h':  2 * 60 * 60 * 1000,
  '4h':  4 * 60 * 60 * 1000,
  '8h':  8 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d':  24 * 60 * 60 * 1000,
  '3d':  3 * 24 * 60 * 60 * 1000,
  '1w':  7 * 24 * 60 * 60 * 1000,
  '1M':  30 * 24 * 60 * 60 * 1000,
};

async function fetchCandlesRaw(coin, interval, startTime, endTime) {
  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: { coin, interval, startTime, endTime },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return data;
}

async function fetchCandlesForChart(coin, interval, count) {
  const now = Date.now();
  const intervalMs = INTERVAL_MS[interval] || 60 * 60 * 1000;
  const startTime = now - (intervalMs * count);

  const cryptoData = await fetchCandlesRaw(coin.toUpperCase(), interval, startTime, now);
  if (cryptoData) return { candles: cryptoData, resolvedCoin: coin.toUpperCase(), isTradfi: false };

  for (const prefix of HIP3_PREFIXES) {
    const tradfiCoin = `${prefix}:${coin.toUpperCase()}`;
    const tradfiData = await fetchCandlesRaw(tradfiCoin, interval, startTime, now);
    if (tradfiData) return { candles: tradfiData, resolvedCoin: tradfiCoin, isTradfi: true };
  }

  throw new Error(`No data found for **${coin.toUpperCase()}**.`);
}

// ─── SVG chart rendering (same as chart.js) ───

const sharp = require('sharp');

function formatAxisPrice(price) {
  const n = parseFloat(price);
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function formatDateLabel(timestamp, interval) {
  const d = new Date(timestamp);
  if (['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h'].includes(interval)) {
    const mo = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${mo} ${day} ${h}:${m}`;
  }
  const mo = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const yr = String(d.getFullYear()).slice(2);
  return `${mo} ${day} '${yr}`;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function renderCandlestickChart(candles, coin, interval, label) {
  const W = 900, H = 500;
  const PAD_TOP = 50, PAD_BOTTOM = 60, PAD_LEFT = 20, PAD_RIGHT = 90;
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP - PAD_BOTTOM;

  const lastCandle = candles[candles.length - 1];
  const firstCandle = candles[0];
  const currentPrice = parseFloat(lastCandle.c);
  const openPrice = parseFloat(firstCandle.o);
  const change = ((currentPrice - openPrice) / openPrice * 100).toFixed(2);
  const changeSymbol = parseFloat(change) >= 0 ? '\u25B2' : '\u25BC';

  const parsed = candles.map(c => ({
    t: c.t, o: parseFloat(c.o), h: parseFloat(c.h), l: parseFloat(c.l), c: parseFloat(c.c),
  }));

  const maxP = Math.max(...parsed.map(c => c.h));
  const minP = Math.min(...parsed.map(c => c.l));
  const range = maxP - minP || 1;
  const padding = range * 0.05;
  const yMin = minP - padding;
  const yMax = maxP + padding;
  const yRange = yMax - yMin;

  const priceToY = (p) => PAD_TOP + chartH - ((p - yMin) / yRange * chartH);
  const candleWidth = Math.max(2, Math.floor(chartW / parsed.length * 0.7));
  const gap = chartW / parsed.length;
  const indexToX = (i) => PAD_LEFT + gap * i + gap / 2;

  const GREEN = '#22c55e', RED = '#ef4444', BG = '#1f2937';
  const GRID = 'rgba(75,85,99,0.3)', TEXT_COLOR = '#9ca3af', TITLE_COLOR = '#e5e7eb';

  let svgParts = [];
  svgParts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);

  const titleText = `${escapeXml(coin.toUpperCase())}  \u00B7  ${escapeXml(label)}  \u00B7  $${escapeXml(formatPrice(currentPrice))}  ${changeSymbol} ${change}%`;
  svgParts.push(`<text x="${W / 2}" y="30" text-anchor="middle" fill="${TITLE_COLOR}" font-family="Arial,sans-serif" font-size="16" font-weight="bold">${titleText}</text>`);

  const yTicks = 6;
  for (let i = 0; i <= yTicks; i++) {
    const price = yMin + (yRange / yTicks) * i;
    const y = priceToY(price);
    svgParts.push(`<line x1="${PAD_LEFT}" y1="${y}" x2="${W - PAD_RIGHT}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
    svgParts.push(`<text x="${W - PAD_RIGHT + 8}" y="${y + 4}" fill="${TEXT_COLOR}" font-family="Arial,sans-serif" font-size="11">${escapeXml(formatAxisPrice(price))}</text>`);
  }

  for (let i = 0; i < parsed.length; i++) {
    const c = parsed[i];
    const x = indexToX(i);
    const isGreen = c.c >= c.o;
    const color = isGreen ? GREEN : RED;
    svgParts.push(`<line x1="${x}" y1="${priceToY(c.h)}" x2="${x}" y2="${priceToY(c.l)}" stroke="${color}" stroke-width="1"/>`);
    const bodyTop = priceToY(Math.max(c.o, c.c));
    const bodyBot = priceToY(Math.min(c.o, c.c));
    const bodyH = Math.max(1, bodyBot - bodyTop);
    const halfW = candleWidth / 2;
    svgParts.push(`<rect x="${x - halfW}" y="${bodyTop}" width="${candleWidth}" height="${bodyH}" fill="${color}" rx="1"/>`);
  }

  const xLabelCount = Math.min(8, parsed.length);
  const xLabelStep = Math.floor(parsed.length / xLabelCount);
  for (let i = 0; i < parsed.length; i += xLabelStep) {
    const x = indexToX(i);
    const dateStr = formatDateLabel(parsed[i].t, interval);
    svgParts.push(`<text x="${x}" y="${H - PAD_BOTTOM + 20}" text-anchor="middle" fill="${TEXT_COLOR}" font-family="Arial,sans-serif" font-size="10" transform="rotate(-35 ${x} ${H - PAD_BOTTOM + 20})">${escapeXml(dateStr)}</text>`);
  }

  svgParts.push(`<text x="${PAD_LEFT + 5}" y="${H - 8}" fill="${GRID}" font-family="Arial,sans-serif" font-size="10">Data via Hyperliquid</text>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svgParts.join('')}</svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();

  return { buffer, currentPrice, change, changeSymbol };
}

// ─── Module export ───

module.exports = {
  name: 'watchlist',
  description: 'Manage your asset watchlist with live prices from Hyperliquid.',
  needsEntries: false,
  isModal: false,
  publicReply: false,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return handleAdd(interaction);
    if (sub === 'remove') return handleRemove(interaction);
    if (sub === 'view') return handleView(interaction);
  },

  handleSelectMenu,
};
