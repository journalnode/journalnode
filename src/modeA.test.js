'use strict';

const path = require('path');
const fs = require('fs');

// Use a fresh database for testing
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'model_reliability.db');
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const { runModeA } = require('./modeA');
const { _setFetchFn, clearCache } = require('./rawDataPack');
const { closeDb } = require('./modelReliability');

// ---------------------------------------------------------------------------
// Test harness (matches project convention)
// ---------------------------------------------------------------------------
function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Stub data-pack fetcher (no network required)
// ---------------------------------------------------------------------------
const STUB_CRYPTO_DATA = {
  market_data: { current_price: { usd: 67500 }, market_cap: { usd: 1.3e12 } },
};
const STUB_HISTORY_DATA = {
  prices: [
    [Date.now() - 6 * 86400e3, 65000],
    [Date.now() - 5 * 86400e3, 65800],
    [Date.now() - 4 * 86400e3, 66200],
    [Date.now() - 3 * 86400e3, 66900],
    [Date.now() - 2 * 86400e3, 67100],
    [Date.now() - 1 * 86400e3, 67400],
    [Date.now(), 67500],
  ],
};

_setFetchFn(async (url) => {
  if (url.includes('market_chart')) return STUB_HISTORY_DATA;
  return STUB_CRYPTO_DATA;
});

// ---------------------------------------------------------------------------
// Stubbed model handler factory
// ---------------------------------------------------------------------------

/**
 * Create a handler override that returns pre-defined JSON objects based on
 * prompt content. The handler inspects the prompt to determine which agent
 * role is being invoked and returns the matching stub response.
 */
function createStubHandler({ bullScore, bearScore, arbiterScsScore, arbiterBullPct, arbiterBearPct }) {
  let callCount = 0;

  return async ({ prompt }) => {
    callCount++;

    // ── Semantic Arbiter (check FIRST since its prompt also contains agent names) ─
    if (prompt.includes('Semantic Arbiter')) {
      return {
        scsScore: arbiterScsScore,
        bullPct: arbiterBullPct,
        bearPct: arbiterBearPct,
        synthesisSummary: 'The bull thesis rests on price momentum and institutional signals while the bear thesis highlights overbought conditions and regulatory risk. Net conviction leans mildly bullish given sustained accumulation patterns.',
        baselineTruths: [
          'BTC is trading near $67,500',
          'Price has risen approximately 3.8% over the past week',
          'Market cap remains above $1 trillion',
        ],
      };
    }

    // ── Bull Catalyst Scout ────────────────────────────────────────
    if (prompt.includes('Bull Catalyst Scout') && !prompt.includes('follow-up')) {
      return {
        direction: 'bull',
        score: bullScore,
        keyPoints: [
          'Strong price momentum over 7-day window',
          'Market cap holding above $1T support',
          'Increasing institutional adoption signals',
        ],
        semanticProximityKeywords: ['momentum', 'breakout', 'accumulation', 'institutional'],
        signalStrength: bullScore > 60 ? 'strong' : 'moderate',
      };
    }

    // ── Bear Risk Auditor ──────────────────────────────────────────
    if (prompt.includes('Bear Risk Auditor') && !prompt.includes('follow-up')) {
      return {
        direction: 'bear',
        score: bearScore,
        keyPoints: [
          'Overbought RSI levels in short timeframe',
          'Declining volume on recent upticks',
          'Regulatory uncertainty in major markets',
        ],
        semanticProximityKeywords: ['overvalued', 'resistance', 'regulation', 'volume-decline'],
        signalStrength: Math.abs(bearScore) > 60 ? 'strong' : 'moderate',
      };
    }

    // ── Bull follow-up ─────────────────────────────────────────────
    if (prompt.includes('Bull Catalyst Scout') && prompt.includes('follow-up')) {
      return {
        additionalPoint: 'ETF inflow data confirms sustained institutional buying pressure',
        revisedSignalStrength: 'strong',
      };
    }

    // ── Bear follow-up ─────────────────────────────────────────────
    if (prompt.includes('Bear Risk Auditor') && prompt.includes('follow-up')) {
      return {
        additionalPoint: 'On-chain whale wallets showing net distribution over past 72h',
        revisedSignalStrength: 'moderate',
      };
    }

    // Fallback
    return { scsScore: 0, bullPct: 50, bearPct: 50, synthesisSummary: 'fallback', baselineTruths: [] };
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
async function runAll() {
  console.log('\n=== Mode A: Three-Agent Debate Orchestrator Tests ===\n');

  // ── Scenario 1: HIGH SPREAD (>60) → Recursive research triggers ────
  console.log('Scenario 1: High spread (bull 80, bear -55 → spread 135) — recursive research should trigger\n');

  await test('high-spread triggers recursive research and returns correct schema', async () => {
    clearCache();

    const handler = createStubHandler({
      bullScore: 80,
      bearScore: -55,
      arbiterScsScore: 25,
      arbiterBullPct: 62,
      arbiterBearPct: 38,
    });

    const result = await runModeA({
      ticker: 'bitcoin',
      assetClass: 'crypto',
      timeframe: '1W',
      primaryModel: 'stub/test-model',
      _handlerOverride: handler,
    });

    console.log('    Full result:', JSON.stringify(result, null, 2));

    // Schema checks
    assert(typeof result.scsScore === 'number', `scsScore should be number (got ${typeof result.scsScore})`);
    assert(typeof result.label === 'string', `label should be string (got ${typeof result.label})`);
    assert(typeof result.bullPct === 'number', `bullPct should be number (got ${typeof result.bullPct})`);
    assert(typeof result.bearPct === 'number', `bearPct should be number (got ${typeof result.bearPct})`);
    assert(typeof result.synthesisSummary === 'string', `synthesisSummary should be string (got ${typeof result.synthesisSummary})`);
    assert(Array.isArray(result.semanticProximityKeywords), 'semanticProximityKeywords should be array');
    assert(typeof result.semanticDecayWarning === 'boolean', `semanticDecayWarning should be boolean (got ${typeof result.semanticDecayWarning})`);
    assert(typeof result.recursiveResearchTriggered === 'boolean', `recursiveResearchTriggered should be boolean (got ${typeof result.recursiveResearchTriggered})`);
    assert(Array.isArray(result.excluded), 'excluded should be array');
    assert(typeof result.dataFreshness === 'string', `dataFreshness should be string (got ${typeof result.dataFreshness})`);

    // Recursive research MUST fire for spread of 135 (|80 - (-55)| = 135 > 60)
    assert(result.recursiveResearchTriggered === true,
      `recursiveResearchTriggered should be true (spread 135 > 60), got ${result.recursiveResearchTriggered}`);

    // bullPct + bearPct = 100
    assert(result.bullPct + result.bearPct === 100,
      `bullPct + bearPct should be 100 (got ${result.bullPct + result.bearPct})`);

    // SCS score should be in valid range
    assert(result.scsScore >= -100 && result.scsScore <= 100,
      `scsScore should be in [-100, 100] (got ${result.scsScore})`);

    // Should have keywords from both agents
    assert(result.semanticProximityKeywords.length >= 4,
      `should have keywords from both agents (got ${result.semanticProximityKeywords.length})`);

    // dataFreshness should be valid ISO timestamp
    assert(!isNaN(Date.parse(result.dataFreshness)),
      `dataFreshness should be valid ISO date (got ${result.dataFreshness})`);

    console.log('    ✓ Recursive research correctly triggered for high-spread scenario');
  });

  // ── Scenario 2: LOW SPREAD (≤60) → No recursive research ──────────
  console.log('\nScenario 2: Low spread (bull 35, bear -20 → spread 55) — no recursive research\n');

  await test('low-spread does NOT trigger recursive research', async () => {
    clearCache();

    const handler = createStubHandler({
      bullScore: 35,
      bearScore: -20,
      arbiterScsScore: 12,
      arbiterBullPct: 55,
      arbiterBearPct: 45,
    });

    const result = await runModeA({
      ticker: 'bitcoin',
      assetClass: 'crypto',
      timeframe: '1W',
      primaryModel: 'stub/test-model',
      _handlerOverride: handler,
    });

    console.log('    Full result:', JSON.stringify(result, null, 2));

    // Schema checks
    assert(typeof result.scsScore === 'number', `scsScore should be number (got ${typeof result.scsScore})`);
    assert(typeof result.label === 'string', `label should be string (got ${typeof result.label})`);
    assert(typeof result.bullPct === 'number', `bullPct should be number (got ${typeof result.bullPct})`);
    assert(typeof result.bearPct === 'number', `bearPct should be number (got ${typeof result.bearPct})`);
    assert(typeof result.synthesisSummary === 'string', `synthesisSummary should be string`);
    assert(Array.isArray(result.semanticProximityKeywords), 'semanticProximityKeywords should be array');
    assert(typeof result.semanticDecayWarning === 'boolean', `semanticDecayWarning should be boolean`);
    assert(typeof result.recursiveResearchTriggered === 'boolean', `recursiveResearchTriggered should be boolean`);
    assert(Array.isArray(result.excluded), 'excluded should be array');
    assert(typeof result.dataFreshness === 'string', `dataFreshness should be string`);

    // Recursive research MUST NOT fire for spread of 55 (|35 - (-20)| = 55 ≤ 60)
    assert(result.recursiveResearchTriggered === false,
      `recursiveResearchTriggered should be false (spread 55 ≤ 60), got ${result.recursiveResearchTriggered}`);

    // bullPct + bearPct = 100
    assert(result.bullPct + result.bearPct === 100,
      `bullPct + bearPct should be 100 (got ${result.bullPct + result.bearPct})`);

    // SCS score should be in valid range
    assert(result.scsScore >= -100 && result.scsScore <= 100,
      `scsScore should be in [-100, 100] (got ${result.scsScore})`);

    console.log('    ✓ Recursive research correctly NOT triggered for low-spread scenario');
  });

  // ── Scenario 3: Exact boundary (spread = 60) → No recursion ───────
  console.log('\nScenario 3: Boundary spread (bull 40, bear -20 → spread 60) — no recursive research\n');

  await test('boundary spread (exactly 60) does NOT trigger recursive research', async () => {
    clearCache();

    const handler = createStubHandler({
      bullScore: 40,
      bearScore: -20,
      arbiterScsScore: 15,
      arbiterBullPct: 58,
      arbiterBearPct: 42,
    });

    const result = await runModeA({
      ticker: 'bitcoin',
      assetClass: 'crypto',
      timeframe: '1W',
      primaryModel: 'stub/test-model',
      _handlerOverride: handler,
    });

    console.log('    Full result:', JSON.stringify(result, null, 2));

    // spread = |40 - (-20)| = 60, which is NOT > 60, so no recursion
    assert(result.recursiveResearchTriggered === false,
      `recursiveResearchTriggered should be false (spread exactly 60 is not > 60), got ${result.recursiveResearchTriggered}`);

    console.log('    ✓ Boundary case correctly handled (spread = 60 → no recursion)');
  });

  // ── Scenario 4: Missing required params ────────────────────────────
  console.log('\nScenario 4: Error handling for missing parameters\n');

  await test('throws on missing ticker', async () => {
    let threw = false;
    try {
      await runModeA({ assetClass: 'crypto', primaryModel: 'stub/test' });
    } catch (e) {
      threw = true;
      assert(e.message.includes('ticker'), `error should mention ticker (got: ${e.message})`);
    }
    assert(threw, 'should throw when ticker is missing');
  });

  await test('throws on missing primaryModel', async () => {
    let threw = false;
    try {
      await runModeA({ ticker: 'bitcoin', assetClass: 'crypto' });
    } catch (e) {
      threw = true;
      assert(e.message.includes('primaryModel'), `error should mention primaryModel (got: ${e.message})`);
    }
    assert(threw, 'should throw when primaryModel is missing');
  });

  // Cleanup
  closeDb();
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  console.log('\n=== All Mode A tests completed ===\n');
}

runAll();
