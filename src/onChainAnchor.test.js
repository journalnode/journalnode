'use strict';

const fs = require('fs');
const path = require('path');
const { anchorOutput, getAnchorByHash, verifyOutput } = require('./onChainAnchor');

const LEDGER_PATH = path.join(__dirname, '..', 'data', 'anchorLedger.jsonl');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

// Clean ledger before tests
if (fs.existsSync(LEDGER_PATH)) fs.unlinkSync(LEDGER_PATH);

// ---------------------------------------------------------------------------
// Stubbed mode outputs
// ---------------------------------------------------------------------------

const modeAOutput = {
  direction: 'bull',
  score: 72,
  keyPoints: ['strong revenue growth', 'expanding margins', 'new product pipeline'],
  semanticProximityKeywords: ['growth', 'margin', 'pipeline', 'revenue', 'expansion'],
  signalStrength: 'strong',
};

const modeDOutput = {
  asset_context: { ticker: 'BTC', timeframe: '1D', last_price: 64000 },
  recent_price_action: [{ candle_index: 0, type: 'bullish', volume: 'high' }],
  technical_indicators: { rsi: 58, ma_alignment: 'bullish', macd: 'bullish_cross' },
  visual_structures: { support_level: 60000, resistance_level: 70000, pattern_identified: 'ascending triangle' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n=== On-Chain Anchor Tests ===\n');

let modeAHash;
let modeDHash;

// --- Test Case 1: Anchor a Mode A output, verify hash format ---
console.log('Test Case 1: Anchor Mode A output');

(async () => {
  try {
    const result = await anchorOutput({
      sapOutput: modeAOutput,
      ticker: 'AAPL',
      modeUsed: 'mode_a',
      userDiscordId: 'user_001',
    });

    modeAHash = result.contentHash;

    test('contentHash is a valid 64-char hex string', () => {
      assert(typeof result.contentHash === 'string', 'contentHash should be a string');
      assert(result.contentHash.length === 64, `expected 64 chars, got ${result.contentHash.length}`);
      assert(/^[0-9a-f]{64}$/.test(result.contentHash), 'contentHash should be lowercase hex');
    });

    test('txHash starts with mock_tx_', () => {
      assert(result.txHash.startsWith('mock_tx_'), `unexpected txHash: ${result.txHash}`);
    });

    test('memoPayload has correct schema', () => {
      const mp = result.memoPayload;
      assert(mp.source_node === 'journal_node', 'source_node mismatch');
      assert(mp.output_type === 'mode_a', 'output_type mismatch');
      assert(mp.content_hash === result.contentHash, 'content_hash mismatch');
      assert(mp.ticker === 'AAPL', 'ticker mismatch');
      assert(mp.user_id === 'user_001', 'user_id mismatch');
      assert(typeof mp.timestamp === 'string', 'timestamp should be a string');
    });

    // --- Test Case 2: Anchor Mode D output, retrieve via getAnchorByHash ---
    console.log('\nTest Case 2: Anchor Mode D output and retrieve');

    const resultD = await anchorOutput({
      sapOutput: modeDOutput,
      ticker: 'BTC',
      modeUsed: 'mode_d',
      userDiscordId: 'user_002',
    });

    modeDHash = resultD.contentHash;

    test('Mode D hash is a valid 64-char hex string', () => {
      assert(/^[0-9a-f]{64}$/.test(resultD.contentHash), 'invalid hash format');
    });

    test('getAnchorByHash retrieves correct Mode D record', () => {
      const record = getAnchorByHash(modeDHash);
      assert(record !== null, 'record should not be null');
      assert(record.content_hash === modeDHash, 'content_hash mismatch');
      assert(record.ticker === 'BTC', 'ticker mismatch');
      assert(record.output_type === 'mode_d', 'output_type mismatch');
      assert(record.user_id === 'user_002', 'user_id mismatch');
    });

    // --- Test Case 3: verifyOutput on original Mode A object ---
    console.log('\nTest Case 3: verifyOutput on original Mode A object');

    test('verifyOutput returns verified: true for original Mode A output', () => {
      const vResult = verifyOutput({ sapOutput: modeAOutput });
      assert(vResult.verified === true, `expected verified true, got ${vResult.verified}`);
      assert(typeof vResult.anchoredAt === 'string', 'anchoredAt should be a string');
      assert(vResult.memoPayload !== null, 'memoPayload should not be null');
      assert(vResult.memoPayload.content_hash === modeAHash, 'content_hash mismatch in memoPayload');
    });

    // --- Test Case 4: verifyOutput on tampered Mode A object ---
    console.log('\nTest Case 4: verifyOutput on tampered Mode A object');

    test('verifyOutput returns verified: false for tampered Mode A output', () => {
      const tampered = { ...modeAOutput, score: 99 };
      const vResult = verifyOutput({ sapOutput: tampered });
      assert(vResult.verified === false, `expected verified false, got ${vResult.verified}`);
      assert(vResult.anchoredAt === null, 'anchoredAt should be null');
      assert(vResult.memoPayload === null, 'memoPayload should be null');
    });

    // Cleanup
    if (fs.existsSync(LEDGER_PATH)) fs.unlinkSync(LEDGER_PATH);

    console.log('\n=== All On-Chain Anchor Tests Complete ===\n');
  } catch (err) {
    console.error('Unexpected error:', err);
    process.exitCode = 1;
  }
})();
