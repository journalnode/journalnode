'use strict';

const https = require('https');

// ---------------------------------------------------------------------------
// In-memory cache: key = ticker|timeframe, value = { pack, ts }
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const cache = new Map();

function clearCache() {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Tiny HTTPS-JSON helper (no external deps)
// ---------------------------------------------------------------------------
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'journalnode/0.1' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Timeframe → days mapping
// ---------------------------------------------------------------------------
function timeframeToDays(tf) {
  const map = { '1D': 1, '1W': 7, '2W': 14, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
  return map[tf] || 7;
}

// ---------------------------------------------------------------------------
// Crypto fetcher (CoinGecko public API — no key needed)
// ---------------------------------------------------------------------------
async function fetchCrypto(ticker, timeframe) {
  const days = timeframeToDays(timeframe);
  const id = ticker.toLowerCase(); // CoinGecko uses slug ids like "bitcoin", "ethereum"

  const [market, history] = await Promise.all([
    _fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`),
    _fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`),
  ]);

  const priceCurrent = market.market_data?.current_price?.usd ?? null;
  const marketCap = market.market_data?.market_cap?.usd ?? null;

  const priceHistory = (history.prices || []).map(([ts, price]) => ({
    date: new Date(ts).toISOString().slice(0, 10),
    price,
  }));

  return { priceCurrent, priceHistory, marketCap };
}

// ---------------------------------------------------------------------------
// Equity fetcher (Yahoo Finance v8 unofficial chart endpoint)
// ---------------------------------------------------------------------------
function timeframeToYahooRange(tf) {
  const map = { '1D': '1d', '1W': '5d', '2W': '1mo', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y' };
  return map[tf] || '5d';
}

async function fetchEquity(ticker, timeframe) {
  const symbol = ticker.toUpperCase();
  const range = timeframeToYahooRange(timeframe);
  const interval = ['1D', '1W'].includes(timeframe) ? '1d' : '1wk';

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const data = await _fetch(url);

  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`No Yahoo data for ${symbol}`);

  const meta = result.meta || {};
  const priceCurrent = meta.regularMarketPrice ?? null;
  const marketCap = meta.marketCap ?? null;

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const priceHistory = timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    price: closes[i] ?? null,
  }));

  return { priceCurrent, priceHistory, marketCap };
}

// ---------------------------------------------------------------------------
// Main assembler
// ---------------------------------------------------------------------------
async function assembleDataPack({ ticker, assetClass, timeframe, newsHeadlines } = {}) {
  if (!ticker) throw new Error('ticker is required');
  if (!assetClass) throw new Error('assetClass is required');
  if (!timeframe) timeframe = '1W';

  const cacheKey = `${ticker.toLowerCase()}|${timeframe}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.pack;
  }

  let priceCurrent, priceHistory, marketCap;

  if (assetClass === 'crypto') {
    ({ priceCurrent, priceHistory, marketCap } = await fetchCrypto(ticker, timeframe));
  } else if (assetClass === 'equity') {
    ({ priceCurrent, priceHistory, marketCap } = await fetchEquity(ticker, timeframe));
  } else {
    throw new Error(`Unknown assetClass: ${assetClass}`);
  }

  const recentNews = Array.isArray(newsHeadlines)
    ? newsHeadlines.map((h) =>
        typeof h === 'string'
          ? { headline: h, source: 'user', date: new Date().toISOString().slice(0, 10) }
          : h
      )
    : [];

  const pack = {
    ticker,
    assetClass,
    timeframe,
    price_current: priceCurrent,
    price_history: priceHistory,
    market_cap: marketCap,
    recent_news: recentNews,
    sector_peers: [],
    data_freshness_timestamp: new Date().toISOString(),
  };

  cache.set(cacheKey, { pack, ts: Date.now() });
  return pack;
}

// Allow tests to override the JSON fetcher (e.g. when no network is available)
function _setFetchFn(fn) { _fetch = fn; }
let _fetch = fetchJSON;

module.exports = { assembleDataPack, clearCache, _setFetchFn };
