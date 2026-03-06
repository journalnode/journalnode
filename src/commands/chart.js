const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

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

// Interval durations in ms for calculating startTime
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

async function fetchCandles(coin, interval, count) {
  const now = Date.now();
  const intervalMs = INTERVAL_MS[interval] || 60 * 60 * 1000;
  const startTime = now - (intervalMs * count);

  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: {
        coin: coin.toUpperCase(),
        interval,
        startTime,
        endTime: now,
      },
    }),
  });

  if (!res.ok) throw new Error(`Hyperliquid API error: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No candle data returned for ${coin.toUpperCase()}. Check the ticker — Hyperliquid uses coin names like BTC, ETH, SOL.`);
  }
  return data;
}

// ─── Chart Rendering ───

function formatPrice(price) {
  const n = parseFloat(price);
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.001) return n.toFixed(6);
  return n.toFixed(8);
}

function formatDateLabel(timestamp, interval) {
  const d = new Date(timestamp);
  if (['1m', '5m', '15m'].includes(interval)) {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (['1h', '4h', '12h'].includes(interval)) {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

async function renderCandlestickChart(candles, coin, interval, label) {
  const lastCandle = candles[candles.length - 1];
  const firstCandle = candles[0];
  const currentPrice = parseFloat(lastCandle.c);
  const openPrice = parseFloat(firstCandle.o);
  const change = ((currentPrice - openPrice) / openPrice * 100).toFixed(2);
  const changeSymbol = change >= 0 ? '\u25B2' : '\u25BC';

  // Build candlestick data using box plot approach for QuickChart
  // QuickChart supports chartjs-chart-financial with OHLC
  const ohlcData = candles.map(c => ({
    x: c.t,
    o: parseFloat(c.o),
    h: parseFloat(c.h),
    l: parseFloat(c.l),
    c: parseFloat(c.c),
  }));

  // Calculate price range for Y axis
  const allHighs = ohlcData.map(c => c.h);
  const allLows = ohlcData.map(c => c.l);
  const maxPrice = Math.max(...allHighs);
  const minPrice = Math.min(...allLows);
  const padding = (maxPrice - minPrice) * 0.05;

  const config = {
    type: 'ohlc',
    data: {
      datasets: [{
        label: `${coin.toUpperCase()} ${label}`,
        data: ohlcData,
        color: {
          up: '#22c55e',
          down: '#ef4444',
          unchanged: '#6b7280',
        },
        borderColor: {
          up: '#22c55e',
          down: '#ef4444',
          unchanged: '#6b7280',
        },
      }],
    },
    options: {
      title: {
        display: true,
        text: `${coin.toUpperCase()}  \u00B7  ${label}  \u00B7  $${formatPrice(currentPrice)}  ${changeSymbol} ${change}%`,
        fontSize: 16,
        fontColor: '#e5e7eb',
      },
      legend: { display: false },
      scales: {
        xAxes: [{
          type: 'time',
          time: {
            unit: ['1d', '1w', '1M'].includes(interval) ? 'day' : 'hour',
            displayFormats: {
              hour: 'MMM D HH:mm',
              day: 'MMM D',
              week: 'MMM D',
              month: 'MMM YYYY',
            },
          },
          ticks: { fontColor: '#9ca3af', maxTicksLimit: 10 },
          gridLines: { color: 'rgba(75, 85, 99, 0.3)' },
        }],
        yAxes: [{
          ticks: {
            fontColor: '#9ca3af',
            suggestedMin: minPrice - padding,
            suggestedMax: maxPrice + padding,
            callback: (val) => `$${formatPrice(val)}`,
          },
          gridLines: { color: 'rgba(75, 85, 99, 0.3)' },
          position: 'right',
        }],
      },
      plugins: { datalabels: { display: false } },
    },
  };

  // Render via QuickChart
  const res = await fetch('https://quickchart.io/chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chart: config,
      width: 900,
      height: 500,
      format: 'png',
      backgroundColor: '#1f2937',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Chart rendering failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    currentPrice,
    change,
    changeSymbol,
  };
}

// ─── Module Export ───

module.exports = {
  name: 'chart',
  description: 'Display a crypto candlestick chart from Hyperliquid.',
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
      const candles = await fetchCandles(coin, tf.interval, tf.candles);
      const { buffer, currentPrice, change, changeSymbol } = await renderCandlestickChart(candles, coin, tf.interval, tf.label);

      const file = new AttachmentBuilder(buffer, { name: 'chart.png' });
      const changeColor = parseFloat(change) >= 0 ? 0x22c55e : 0xef4444;

      const embed = new EmbedBuilder()
        .setTitle(`${coin} \u00B7 ${tf.label} \u00B7 $${formatPrice(currentPrice)}`)
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
          `${err.message}\n\n` +
          'Hyperliquid uses coin names like `BTC`, `ETH`, `SOL`, `DOGE`. Try without suffixes like USDT or USD.'
        );
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
