const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { callModel } = require('../openrouter');
const { getVisionModels } = require('../models');
const sharp = require('sharp');

// ─── Hyperliquid API ───

const HL_API = 'https://api.hyperliquid.xyz/info';

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

// Known HIP-3 builder prefixes for tradfi / builder-deployed perps
// xyz = TradeXYZ (stocks), km = Kinetiq (indices), hyna = HyENA, vntl = Ventuals (pre-IPO)
const HIP3_PREFIXES = ['xyz', 'km', 'hyna', 'vntl'];

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
  for (const prefix of HIP3_PREFIXES) {
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

// ─── Swing Detection ───

/**
 * Detect swing highs and swing lows using a zigzag approach.
 * A swing high is a candle whose high >= the highs of `lookback` candles on each side.
 * A swing low  is a candle whose low  <= the lows  of `lookback` candles on each side.
 * Returns an array of { index, price, type: 'high'|'low', timestamp } sorted by index,
 * alternating between highs and lows (zigzag).
 */
function detectSwings(parsed, lookback = 5) {
  const swingHighs = [];
  const swingLows = [];

  for (let i = lookback; i < parsed.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (parsed[i].h < parsed[i - j].h || parsed[i].h < parsed[i + j].h) isHigh = false;
      if (parsed[i].l > parsed[i - j].l || parsed[i].l > parsed[i + j].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) swingHighs.push({ index: i, price: parsed[i].h, type: 'high', timestamp: parsed[i].t });
    if (isLow) swingLows.push({ index: i, price: parsed[i].l, type: 'low', timestamp: parsed[i].t });
  }

  // Merge and sort by index, then build zigzag (alternate high/low)
  const all = [...swingHighs, ...swingLows].sort((a, b) => a.index - b.index);
  if (all.length === 0) return [];

  const zigzag = [all[0]];
  for (let i = 1; i < all.length; i++) {
    const last = zigzag[zigzag.length - 1];
    if (all[i].type === last.type) {
      // Same type — keep the more extreme one
      if (all[i].type === 'high' && all[i].price > last.price) {
        zigzag[zigzag.length - 1] = all[i];
      } else if (all[i].type === 'low' && all[i].price < last.price) {
        zigzag[zigzag.length - 1] = all[i];
      }
    } else {
      zigzag.push(all[i]);
    }
  }

  return zigzag;
}

/**
 * Calculate percentage changes between consecutive swing points.
 */
function calcSwingChanges(swings) {
  const changes = [];
  for (let i = 1; i < swings.length; i++) {
    const prev = swings[i - 1];
    const curr = swings[i];
    const pctChange = ((curr.price - prev.price) / prev.price * 100);
    changes.push({
      from: prev,
      to: curr,
      pctChange: pctChange.toFixed(2),
      direction: pctChange >= 0 ? 'up' : 'down',
    });
  }
  return changes;
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

function buildCandlestickSvg(candles, coin, interval, label, opts = {}) {
  const showSwings = opts.showSwings || false;
  const W = 900;
  const CHART_H = 500;
  const PAD_TOP = 50, PAD_BOTTOM = 60, PAD_LEFT = 20, PAD_RIGHT = 90;
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = CHART_H - PAD_TOP - PAD_BOTTOM;

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

  // Detect swings if requested
  const lookback = Math.max(3, Math.min(7, Math.floor(parsed.length / 12)));
  const swings = showSwings ? detectSwings(parsed, lookback) : [];
  const swingChanges = showSwings ? calcSwingChanges(swings) : [];

  // Build summary lines for swing overlay
  let summaryLines = [];
  if (showSwings && swingChanges.length > 0) {
    for (const sc of swingChanges) {
      const dir = sc.direction === 'up' ? '\u25B2' : '\u25BC';
      const fromLabel = formatDateLabel(sc.from.timestamp, interval);
      const toLabel = formatDateLabel(sc.to.timestamp, interval);
      summaryLines.push(`${dir} ${sc.pctChange}%  $${formatPrice(sc.from.price)} \u2192 $${formatPrice(sc.to.price)}  (${fromLabel} \u2013 ${toLabel})`);
    }
  }

  // Calculate total SVG height: chart + optional summary
  const SUMMARY_LINE_H = 18;
  const SUMMARY_PAD = showSwings && summaryLines.length > 0 ? 16 : 0;
  const summaryH = summaryLines.length > 0 ? SUMMARY_PAD + summaryLines.length * SUMMARY_LINE_H + 10 : 0;
  const H = CHART_H + summaryH;

  const GREEN = '#22c55e';
  const RED = '#ef4444';
  const BG = '#1f2937';
  const GRID = 'rgba(75,85,99,0.3)';
  const TEXT_COLOR = '#9ca3af';
  const TITLE_COLOR = '#e5e7eb';
  const SWING_LINE_COLOR = '#facc15';   // yellow
  const SWING_DOT_COLOR = '#38bdf8';    // sky blue
  const SWING_UP_COLOR = '#4ade80';     // light green
  const SWING_DOWN_COLOR = '#f87171';   // light red

  let svgParts = [];

  // Background
  svgParts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);

  // Title
  const swingTag = showSwings ? '  \u00B7  Swing %' : '';
  const titleText = `${escapeXml(coin.toUpperCase())}  \u00B7  ${escapeXml(label)}  \u00B7  $${escapeXml(formatPrice(currentPrice))}  ${changeSymbol} ${change}%${swingTag}`;
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

  // ─── Swing Overlay ───
  if (showSwings && swings.length >= 2) {
    // Draw zigzag lines connecting swing points
    for (let i = 1; i < swings.length; i++) {
      const prev = swings[i - 1];
      const curr = swings[i];
      const x1 = indexToX(prev.index);
      const y1 = priceToY(prev.price);
      const x2 = indexToX(curr.index);
      const y2 = priceToY(curr.price);
      svgParts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${SWING_LINE_COLOR}" stroke-width="2" stroke-dasharray="6,3" opacity="0.85"/>`);

      // Percentage label at midpoint of the line
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const pct = swingChanges[i - 1].pctChange;
      const pctColor = parseFloat(pct) >= 0 ? SWING_UP_COLOR : SWING_DOWN_COLOR;
      const pctSign = parseFloat(pct) >= 0 ? '+' : '';
      // Background rect for readability
      svgParts.push(`<rect x="${midX - 28}" y="${midY - 12}" width="56" height="16" rx="3" fill="${BG}" opacity="0.85"/>`);
      svgParts.push(`<text x="${midX}" y="${midY}" text-anchor="middle" fill="${pctColor}" font-family="Arial,sans-serif" font-size="11" font-weight="bold">${pctSign}${pct}%</text>`);
    }

    // Draw dots at each swing point
    for (const s of swings) {
      const x = indexToX(s.index);
      const y = priceToY(s.price);
      const dotColor = s.type === 'high' ? SWING_UP_COLOR : SWING_DOWN_COLOR;
      svgParts.push(`<circle cx="${x}" cy="${y}" r="4" fill="${dotColor}" stroke="${BG}" stroke-width="1.5"/>`);
    }
  }

  // X-axis labels (show ~8 evenly spaced)
  const xLabelCount = Math.min(8, parsed.length);
  const xLabelStep = Math.floor(parsed.length / xLabelCount);
  for (let i = 0; i < parsed.length; i += xLabelStep) {
    const x = indexToX(i);
    const dateStr = formatDateLabel(parsed[i].t, interval);
    svgParts.push(`<text x="${x}" y="${CHART_H - PAD_BOTTOM + 20}" text-anchor="middle" fill="${TEXT_COLOR}" font-family="Arial,sans-serif" font-size="10" transform="rotate(-35 ${x} ${CHART_H - PAD_BOTTOM + 20})">${escapeXml(dateStr)}</text>`);
  }

  // Data source watermark
  svgParts.push(`<text x="${PAD_LEFT + 5}" y="${CHART_H - 8}" fill="${GRID}" font-family="Arial,sans-serif" font-size="10">Data via Hyperliquid</text>`);

  // ─── Swing Summary Text (below chart) ───
  if (showSwings && summaryLines.length > 0) {
    const summaryStartY = CHART_H + SUMMARY_PAD;
    // Separator line
    svgParts.push(`<line x1="${PAD_LEFT}" y1="${CHART_H + 4}" x2="${W - PAD_RIGHT}" y2="${CHART_H + 4}" stroke="${GRID}" stroke-width="1"/>`);
    // Summary header
    svgParts.push(`<text x="${PAD_LEFT + 5}" y="${summaryStartY}" fill="${TITLE_COLOR}" font-family="Arial,sans-serif" font-size="12" font-weight="bold">Swing Summary</text>`);
    for (let i = 0; i < summaryLines.length; i++) {
      const ly = summaryStartY + (i + 1) * SUMMARY_LINE_H;
      const line = summaryLines[i];
      const lineColor = line.startsWith('\u25B2') ? SWING_UP_COLOR : SWING_DOWN_COLOR;
      svgParts.push(`<text x="${PAD_LEFT + 10}" y="${ly}" fill="${lineColor}" font-family="monospace" font-size="11">${escapeXml(line)}</text>`);
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svgParts.join('')}</svg>`;

  return { svg, currentPrice, change, changeSymbol, swings, swingChanges, summaryLines };
}

async function renderCandlestickChart(candles, coin, interval, label, opts = {}) {
  const result = buildCandlestickSvg(candles, coin, interval, label, opts);

  const buffer = await sharp(Buffer.from(result.svg)).png().toBuffer();

  return { buffer, currentPrice: result.currentPrice, change: result.change, changeSymbol: result.changeSymbol, swings: result.swings, swingChanges: result.swingChanges, summaryLines: result.summaryLines };
}

// ─── Chart data cache (for AI analysis button + ! chat ingestion) ───
// Maps channelId → { buffer, ticker, timeframe, timestamp }
const chartCache = new Map();
const CHART_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function cacheChart(channelId, buffer, ticker, timeframe) {
  chartCache.set(channelId, { buffer, ticker, timeframe, timestamp: Date.now() });
}

function getCachedChart(channelId) {
  const entry = chartCache.get(channelId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CHART_CACHE_TTL) {
    chartCache.delete(channelId);
    return null;
  }
  return entry;
}

// ─── AI Analysis handler (called when button is clicked) ───

const ANALYSIS_SYSTEM_PROMPT = `You are a technical analyst. The user has provided a candlestick chart. Analyze the chart thoroughly and provide:

1. **Trend** — Overall trend direction (bullish, bearish, or sideways) and strength
2. **Key Levels** — Notable support/resistance zones visible on the chart
3. **Pattern Recognition** — Any chart patterns (head & shoulders, flags, wedges, double tops/bottoms, etc.)
4. **Candlestick Signals** — Notable candlestick patterns (doji, engulfing, hammer, etc.) especially recent ones
5. **Momentum** — Assessment of buying/selling pressure based on candle sizes and wicks
6. **Verdict** — LONG or SHORT recommendation with confidence level (low/medium/high)

Be concise but specific. Reference what you actually see in the chart. Use plain text formatting suitable for Discord.`;

async function runChartAnalysis(interaction) {
  const channelId = interaction.channelId;
  const cached = getCachedChart(channelId);

  if (!cached) {
    await interaction.editReply({
      content: 'Chart data expired. Please run `/chart` again.',
      embeds: [],
      components: [],
    });
    return;
  }

  const imageBase64 = cached.buffer.toString('base64');

  // Pick a single strong vision model for the analysis
  const visionModels = getVisionModels();
  const preferredModel = visionModels.find(m => m.id.includes('claude-sonnet-4.6')) || visionModels[0];

  const progressEmbed = new EmbedBuilder()
    .setTitle(`AI Analysis \u2014 ${cached.ticker} \u00B7 ${cached.timeframe}`)
    .setColor(0x3b82f6)
    .setDescription(`Analyzing chart with **${preferredModel.name}**...`);

  await interaction.editReply({ embeds: [progressEmbed], components: [] });

  try {
    const userMsg = `Analyze this ${cached.ticker} candlestick chart on the ${cached.timeframe} timeframe. Give your full technical analysis.`;
    const response = await callModel(preferredModel.id, ANALYSIS_SYSTEM_PROMPT, userMsg, {
      imageBase64,
      maxTokens: 1500,
    });

    const resultEmbed = new EmbedBuilder()
      .setTitle(`AI Analysis \u2014 ${cached.ticker} \u00B7 ${cached.timeframe}`)
      .setColor(0x3b82f6)
      .setDescription(response.slice(0, 4090))
      .setFooter({ text: `Powered by ${preferredModel.name}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [resultEmbed], components: [] });
  } catch (err) {
    console.error('[chart AI analysis] Error:', err.message);
    const errorEmbed = new EmbedBuilder()
      .setTitle('AI Analysis \u2014 Error')
      .setColor(0xef4444)
      .setDescription(`Analysis failed: ${err.message}\n\nPlease try again.`);
    await interaction.editReply({ embeds: [errorEmbed], components: [] });
  }
}

// ─── Reusable chart generation (used by /chart and fc command) ───

async function generateChart(ticker, timeframe, opts = {}) {
  const coin = ticker.toUpperCase().replace(/[-/].*$/, '').replace(/USDT?$|USD$|PERP$/i, '');
  const tf = TIMEFRAMES[timeframe];
  if (!tf) {
    throw new Error(`Invalid timeframe \`${timeframe}\`. Supported: ${Object.keys(TIMEFRAMES).join(', ')}`);
  }

  const { candles, resolvedCoin, isTradfi } = await fetchCandles(coin, tf.interval, tf.candles);

  const displayName = resolvedCoin.includes(':') ? resolvedCoin.split(':')[1] : resolvedCoin;
  const assetTag = isTradfi ? ' (Stock)' : '';

  const { buffer, currentPrice, change, changeSymbol, swings, swingChanges, summaryLines } = await renderCandlestickChart(candles, displayName, tf.interval, tf.label, opts);

  const file = new AttachmentBuilder(buffer, { name: 'chart.png' });
  const changeColor = parseFloat(change) >= 0 ? 0x22c55e : 0xef4444;

  // Build description with optional swing summary text for embed
  let description = `${changeSymbol} **${change}%** | Data via Hyperliquid`;
  if (opts.showSwings && summaryLines && summaryLines.length > 0) {
    description += '\n\n**Swing Breakdown:**';
    for (const line of summaryLines) {
      description += `\n\`${line}\``;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`${displayName}${assetTag} \u00B7 ${tf.label} \u00B7 $${formatPrice(currentPrice)}`)
    .setColor(changeColor)
    .setDescription(description.slice(0, 4090))
    .setImage('attachment://chart.png')
    .setFooter({ text: `${candles.length} candles \u00B7 ${tf.label} timeframe${opts.showSwings ? ' \u00B7 Swing %' : ''}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('chart_analyze')
      .setLabel('AI Analysis')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('\uD83D\uDD0D'),
  );

  return { embed, file, row, buffer, displayName, tf, swings, swingChanges };
}

// ─── Module Export ───

module.exports = {
  name: 'chart',
  description: 'Display a candlestick chart (crypto or stocks) from Hyperliquid.',
  needsEntries: false,
  isModal: false,
  publicReply: true,
  TIMEFRAMES,
  generateChart,
  detectSwings,
  calcSwingChanges,

  async execute(interaction) {
    const ticker = interaction.options.getString('ticker');
    const timeframe = interaction.options.getString('timeframe') || '1h';

    try {
      const { embed, file, row, buffer, displayName, tf } = await generateChart(ticker, timeframe);

      cacheChart(interaction.channelId, buffer, displayName, tf.label);

      await interaction.editReply({ embeds: [embed], files: [file], components: [row] });
    } catch (err) {
      console.error('[/chart] Error:', err.message);

      const coin = ticker.toUpperCase().replace(/[-/].*$/, '').replace(/USDT?$|USD$|PERP$/i, '');
      const tf = TIMEFRAMES[timeframe];
      const errorEmbed = new EmbedBuilder()
        .setTitle('Chart Error')
        .setColor(0xef4444)
        .setDescription(
          `**Ticker:** ${coin}\n**Timeframe:** ${tf ? tf.label : timeframe}\n\n` +
          `${err.message}`
        );
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },

  async handleAnalysisButton(interaction) {
    await interaction.deferReply();
    await runChartAnalysis(interaction);
  },

  getCachedChart,
  cacheChart,
};
