'use strict';

const { assembleDataPack, clearCache, _setFetchFn } = require('./rawDataPack');

// ---------------------------------------------------------------------------
// Mock data for environments without network access
// ---------------------------------------------------------------------------
const MOCK_RESPONSES = {
  // CoinGecko coin detail
  'api.coingecko.com/api/v3/coins/bitcoin': {
    market_data: {
      current_price: { usd: 67432.10 },
      market_cap: { usd: 1_325_000_000_000 },
    },
  },
  // CoinGecko market chart
  'api.coingecko.com/api/v3/coins/bitcoin/market_chart': {
    prices: [
      [1710806400000, 65100], [1710892800000, 65800], [1710979200000, 66200],
      [1711065600000, 66900], [1711152000000, 67100], [1711238400000, 67300],
      [1711324800000, 67432],
    ],
  },
  // Yahoo Finance chart for AAPL
  'query1.finance.yahoo.com/v8/finance/chart/AAPL': {
    chart: {
      result: [{
        meta: { regularMarketPrice: 178.52, marketCap: 2_780_000_000_000 },
        timestamp: [1709596800, 1710201600, 1710806400, 1711411200],
        indicators: {
          quote: [{ close: [175.10, 176.30, 177.80, 178.52] }],
        },
      }],
    },
  },
};

function mockFetch(url) {
  // Sort keys longest-first so more specific patterns match before shorter ones
  const keys = Object.keys(MOCK_RESPONSES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (url.includes(key)) return Promise.resolve(MOCK_RESPONSES[key]);
  }
  return Promise.reject(new Error(`No mock for ${url}`));
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------
const REQUIRED_FIELDS = [
  'ticker', 'assetClass', 'timeframe',
  'price_current', 'price_history', 'market_cap',
  'recent_news', 'sector_peers', 'data_freshness_timestamp',
];

function assertSchema(pack, label) {
  let ok = true;
  for (const field of REQUIRED_FIELDS) {
    if (pack[field] === undefined || pack[field] === null) {
      console.error(`  FAIL [${label}]: field "${field}" is missing or null`);
      ok = false;
    }
  }
  if (!Array.isArray(pack.price_history) || pack.price_history.length === 0) {
    console.error(`  FAIL [${label}]: price_history should be a non-empty array`);
    ok = false;
  } else {
    const entry = pack.price_history[0];
    if (!entry.date || entry.price == null) {
      console.error(`  FAIL [${label}]: price_history entries must have date and price`);
      ok = false;
    }
  }
  if (!Array.isArray(pack.recent_news)) {
    console.error(`  FAIL [${label}]: recent_news should be an array`);
    ok = false;
  }
  if (!Array.isArray(pack.sector_peers)) {
    console.error(`  FAIL [${label}]: sector_peers should be an array`);
    ok = false;
  }
  if (ok) console.log(`  PASS [${label}]: all schema fields present and valid`);
  return ok;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
async function run() {
  let failures = 0;

  // Try a real fetch first; fall back to mocks if network is unavailable
  let usingMock = false;
  try {
    clearCache();
    await assembleDataPack({ ticker: 'bitcoin', assetClass: 'crypto', timeframe: '1W' });
  } catch (err) {
    if (err.code === 'EAI_AGAIN' || err.code === 'ENOTFOUND' || err.message.includes('getaddrinfo')) {
      console.log('Network unavailable — switching to mock fetch\n');
      usingMock = true;
      _setFetchFn(mockFetch);
    } else {
      throw err;
    }
  }

  clearCache();

  // --- Crypto test (bitcoin) ---
  console.log('=== Crypto: bitcoin / 1W ===');
  const t0 = Date.now();
  const btc = await assembleDataPack({ ticker: 'bitcoin', assetClass: 'crypto', timeframe: '1W' });
  const t1 = Date.now();
  console.log(JSON.stringify(btc, null, 2));
  if (!assertSchema(btc, 'bitcoin')) failures++;

  // --- Cache hit test ---
  console.log('\n=== Cache hit test: bitcoin / 1W (second call) ===');
  const btc2 = await assembleDataPack({ ticker: 'bitcoin', assetClass: 'crypto', timeframe: '1W' });
  const t2 = Date.now();
  if (btc2.data_freshness_timestamp === btc.data_freshness_timestamp) {
    console.log(`  PASS [cache]: second call returned cached data (same timestamp)`);
    console.log(`  First call: ${t1 - t0}ms, cached call: ${t2 - t1}ms`);
  } else {
    console.error('  FAIL [cache]: timestamps differ — cache did not work');
    failures++;
  }

  // --- Equity test (AAPL) ---
  console.log('\n=== Equity: AAPL / 1M ===');
  const aapl = await assembleDataPack({
    ticker: 'AAPL',
    assetClass: 'equity',
    timeframe: '1M',
    newsHeadlines: ['Apple beats earnings expectations'],
  });
  console.log(JSON.stringify(aapl, null, 2));
  if (!assertSchema(aapl, 'AAPL')) failures++;

  // --- Summary ---
  console.log(`\n=== Done${usingMock ? ' (mock mode)' : ''}: ${failures} failure(s) ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
