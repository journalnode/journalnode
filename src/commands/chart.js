const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');

// ─── Hyperliquid API ───

const HL_API = 'https://api.hyperliquid.xyz/info';

const TIMEFRAMES = {
  '1m':  { interval: '1m',  candles: 60,  label: '1 Minute' },
  '5m':  { interval: '5m',  candles: 60,  label: '5 Minute' },
  '15m': { interval: '15m', candles: 60,  label: '15 Minute' },
  '1h':  { interval: '1h',  candles: 60,  label: '1 Hour' },
  '4h':  { interval: '4h',  candles: 60,  label: '4 Hour' },
  '12h': { interval: '12h', candles: 60,  label: '12 Hour' },
  '1d':  { interval: '1d',  candles: 90,  label: 'Daily' },
  '1w':  { interval: '1w',  candles: 52,  label: 'Weekly' },
  '1M':  { interval: '1M',  candles: 24,  label: 'Monthly' },
};

const INTERVAL_MS = {
  '1m':  60 * 1000,
  '5m':  5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '4h':  4 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d':  24 * 60 * 60 * 1000,
  '1w':  7 * 24 * 60 * 60 * 1000,
  '1M':  30 * 24 * 60 * 60 * 1000,
};

// Known HIP-3 builder prefixes for tradfi assets (TradeXYZ is the primary deployer)
const TRADFI_PREFIXES = ['xyz'];

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

async function fetchCandles(coin, interval, count) {
  const now = Date.now();
  const intervalMs = INTERVAL_MS[interval] || 60 * 60 * 1000;
  const startTime = now - (intervalMs * count);

  // 1) Try as a regular crypto perp (e.g. "BTC", "ETH")
  const cryptoData = await fetchCandlesRaw(coin.toUpperCase(), interval, startTime, now);
  if (cryptoData) return { candles: cryptoData, resolvedCoin: coin.toUpperCase(), isTradfi: false };

  // 2) Try as a tradfi / HIP-3 builder-deployed asset (e.g. "xyz:NVDA")
  for (const prefix of TRADFI_PREFIXES) {
    const tradfiCoin = `${prefix}:${coin.toUpperCase()}`;
    const tradfiData = await fetchCandlesRaw(tradfiCoin, interval, startTime, now);
    if (tradfiData) return { candles: tradfiData, resolvedCoin: tradfiCoin, isTradfi: true };
  }

  throw new Error(
    `No data found for **${coin.toUpperCase()}**.\n\n` +
    'Crypto tickers: `BTC`, `ETH`, `SOL`, `DOGE` (no suffixes)\n' +
    'Stock tickers: `NVDA`, `TSLA`, `AAPL`, `GOOGL`, `AMZN`'
  );
}

// ─── SVG Candlestick Renderer ───

function formatPrice(price) {
  const n = parseFloat(price);
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.001) return n.toFixed(6);
  return n.toFixed(8);
}

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
  if (['1m', '5m', '15m', '1h', '4h', '12h'].includes(interval)) {
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

function buildCandlestickSvg(candles, coin, interval, label) {
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

  // Parse OHLC
  const parsed = candles.map(c => ({
    t: c.t,
    o: parseFloat(c.o),
    h: parseFloat(c.h),
    l: parseFloat(c.l),
    c: parseFloat(c.c),
  }));

  const allHighs = parsed.map(c => c.h);
  const allLows = parsed.map(c => c.l);
  const maxP = Math.max(...allHighs);
  const minP = Math.min(...allLows);
  const range = maxP - minP || 1;
  const padding = range * 0.05;
  const yMin = minP - padding;
  const yMax = maxP + padding;
  const yRange = yMax - yMin;

  // Map price to Y coordinate (inverted — high price = low Y)
  const priceToY = (p) => PAD_TOP + chartH - ((p - yMin) / yRange * chartH);
  // Map index to X coordinate
  const candleWidth = Math.max(2, Math.floor(chartW / parsed.length * 0.7));
  const gap = chartW / parsed.length;
  const indexToX = (i) => PAD_LEFT + gap * i + gap / 2;

  const GREEN = '#22c55e';
  const RED = '#ef4444';
  const BG = '#1f2937';
  const GRID = 'rgba(75,85,99,0.3)';
  const TEXT_COLOR = '#9ca3af';
  const TITLE_COLOR = '#e5e7eb';

  let svgParts = [];

  // Background
  svgParts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);

  // Title
  const titleText = `${escapeXml(coin.toUpperCase())}  \u00B7  ${escapeXml(label)}  \u00B7  $${escapeXml(formatPrice(currentPrice))}  ${changeSymbol} ${change}%`;
  svgParts.push(`<text x="${W / 2}" y="30" text-anchor="middle" fill="${TITLE_COLOR}" font-family="Arial,sans-serif" font-size="16" font-weight="bold">${titleText}</text>`);

  // Y-axis grid lines and labels (right side)
  const yTicks = 6;
  for (let i = 0; i <= yTicks; i++) {
    const price = yMin + (yRange / yTicks) * i;
    const y = priceToY(price);
    svgParts.push(`<line x1="${PAD_LEFT}" y1="${y}" x2="${W - PAD_RIGHT}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
    svgParts.push(`<text x="${W - PAD_RIGHT + 8}" y="${y + 4}" fill="${TEXT_COLOR}" font-family="Arial,sans-serif" font-size="11">${escapeXml(formatAxisPrice(price))}</text>`);
  }

  // Candlesticks
  for (let i = 0; i < parsed.length; i++) {
    const c = parsed[i];
    const x = indexToX(i);
    const isGreen = c.c >= c.o;
    const color = isGreen ? GREEN : RED;

    // Wick (high to low)
    const wickTop = priceToY(c.h);
    const wickBot = priceToY(c.l);
    svgParts.push(`<line x1="${x}" y1="${wickTop}" x2="${x}" y2="${wickBot}" stroke="${color}" stroke-width="1"/>`);

    // Body (open to close)
    const bodyTop = priceToY(Math.max(c.o, c.c));
    const bodyBot = priceToY(Math.min(c.o, c.c));
    const bodyH = Math.max(1, bodyBot - bodyTop);
    const halfW = candleWidth / 2;
    svgParts.push(`<rect x="${x - halfW}" y="${bodyTop}" width="${candleWidth}" height="${bodyH}" fill="${color}" rx="1"/>`);
  }

  // X-axis labels (show ~8 evenly spaced)
  const xLabelCount = Math.min(8, parsed.length);
  const xLabelStep = Math.floor(parsed.length / xLabelCount);
  for (let i = 0; i < parsed.length; i += xLabelStep) {
    const x = indexToX(i);
    const dateStr = formatDateLabel(parsed[i].t, interval);
    svgParts.push(`<text x="${x}" y="${H - PAD_BOTTOM + 20}" text-anchor="middle" fill="${TEXT_COLOR}" font-family="Arial,sans-serif" font-size="10" transform="rotate(-35 ${x} ${H - PAD_BOTTOM + 20})">${escapeXml(dateStr)}</text>`);
  }

  // Data source watermark
  svgParts.push(`<text x="${PAD_LEFT + 5}" y="${H - 8}" fill="${GRID}" font-family="Arial,sans-serif" font-size="10">Data via Hyperliquid</text>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svgParts.join('')}</svg>`;

  return { svg, currentPrice, change, changeSymbol };
}

async function renderCandlestickChart(candles, coin, interval, label) {
  const { svg, currentPrice, change, changeSymbol } = buildCandlestickSvg(candles, coin, interval, label);

  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();

  return { buffer, currentPrice, change, changeSymbol };
}

// ─── Module Export ───

module.exports = {
  name: 'chart',
  description: 'Display a candlestick chart (crypto or stocks) from Hyperliquid.',
  needsEntries: false,
  isModal: false,

  async execute(interaction) {
    const ticker = interaction.options.getString('ticker');
    const timeframe = interaction.options.getString('timeframe') || '1h';
    const coin = ticker.toUpperCase().replace(/[-/].*$/, '').replace(/USDT?$|USD$|PERP$/i, '');

    const tf = TIMEFRAMES[timeframe];
    if (!tf) {
      await interaction.editReply({ content: `Invalid timeframe \`${timeframe}\`. Supported: ${Object.keys(TIMEFRAMES).join(', ')}` });
      return;
    }

    try {
      const { candles, resolvedCoin, isTradfi } = await fetchCandles(coin, tf.interval, tf.candles);

      // Display name: strip builder prefix for clean titles (e.g. "xyz:NVDA" → "NVDA")
      const displayName = resolvedCoin.includes(':') ? resolvedCoin.split(':')[1] : resolvedCoin;
      const assetTag = isTradfi ? ' (Stock)' : '';

      const { buffer, currentPrice, change, changeSymbol } = await renderCandlestickChart(candles, displayName, tf.interval, tf.label);

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
      console.error('[/chart] Error:', err.message);

      const errorEmbed = new EmbedBuilder()
        .setTitle('Chart Error')
        .setColor(0xef4444)
        .setDescription(
          `**Ticker:** ${coin}\n**Timeframe:** ${tf.label}\n\n` +
          `${err.message}`
        );
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
