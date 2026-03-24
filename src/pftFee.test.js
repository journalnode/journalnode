'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { _setFetchFn } = require('./rawDataPack');
const {
  recordSignal,
  checkObservationWindows,
  getUserFeeStatement,
  generateSignalOutcomeNotification,
  PFT_FEE_PCT,
  _setLedgerPath,
} = require('./pftFee');

// ---------------------------------------------------------------------------
// Test-local ledger in a temp directory
// ---------------------------------------------------------------------------
const tmpDir = path.join(os.tmpdir(), `pftFee-test-${Date.now()}`);
const tmpLedger = path.join(tmpDir, 'signalLedger.jsonl');

// ---------------------------------------------------------------------------
// Price stubs: BTC goes up (bullish correct), ETH goes down (bullish incorrect)
// ---------------------------------------------------------------------------
const PRICES = {
  bitcoin: 70000,  // signal price will be 65000 → correct bullish
  ethereum: 2800,  // signal price will be 3000  → incorrect bullish
};

function mockFetch(url) {
  if (url.includes('bitcoin')) {
    return Promise.resolve({
      market_data: { current_price: { usd: PRICES.bitcoin }, market_cap: { usd: 1e12 } },
      prices: [[Date.now(), PRICES.bitcoin]],
    });
  }
  if (url.includes('ethereum')) {
    return Promise.resolve({
      market_data: { current_price: { usd: PRICES.ethereum }, market_cap: { usd: 3e11 } },
      prices: [[Date.now(), PRICES.ethereum]],
    });
  }
  return Promise.reject(new Error(`No mock for ${url}`));
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
async function run() {
  let failures = 0;

  // Setup
  fs.mkdirSync(tmpDir, { recursive: true });
  _setLedgerPath(tmpLedger);
  _setFetchFn(mockFetch);

  const userId = 'user-abc-123';

  // --- 1. Record two signals ---
  console.log('=== recordSignal ===');

  const sig1 = await recordSignal({
    ticketId: 'ticket-1',
    asset: 'bitcoin',
    signalDirection: 'bullish',
    signalPrice: 65000,
    userTimeframe: '1D',
    modeUsed: 'A',
    userDiscordId: userId,
  });

  const sig2 = await recordSignal({
    ticketId: 'ticket-2',
    asset: 'ethereum',
    signalDirection: 'bullish',
    signalPrice: 3000,
    userTimeframe: '1D',
    modeUsed: 'A',
    userDiscordId: userId,
  });

  if (sig1.status === 'open' && sig1.signalId && sig1.observationWindowClosesAt) {
    console.log('  PASS [recordSignal]: signal 1 created with UUID, status open, and observationWindowClosesAt');
  } else {
    console.error('  FAIL [recordSignal]: signal 1 missing expected fields');
    failures++;
  }

  if (sig2.status === 'open' && sig2.signalId) {
    console.log('  PASS [recordSignal]: signal 2 created correctly');
  } else {
    console.error('  FAIL [recordSignal]: signal 2 missing expected fields');
    failures++;
  }

  // --- Verify timeframe computation ---
  const windowMs = new Date(sig1.observationWindowClosesAt).getTime() - new Date(sig1.createdAt).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (Math.abs(windowMs - oneDayMs) < 1000) {
    console.log('  PASS [recordSignal]: 1D timeframe converts to ~24h window');
  } else {
    console.error(`  FAIL [recordSignal]: expected ~${oneDayMs}ms window, got ${windowMs}ms`);
    failures++;
  }

  // --- 2. Backdate observation windows so they expire ---
  console.log('\n=== checkObservationWindows ===');
  const ledgerRaw = fs.readFileSync(tmpLedger, 'utf-8').trim().split('\n').map(JSON.parse);
  for (const rec of ledgerRaw) {
    rec.observationWindowClosesAt = new Date(Date.now() - 1000).toISOString();
  }
  fs.writeFileSync(tmpLedger, ledgerRaw.map(JSON.stringify).join('\n') + '\n', 'utf-8');

  const closed = await checkObservationWindows();

  if (closed.length === 2) {
    console.log('  PASS [checkObservationWindows]: both signals processed');
  } else {
    console.error(`  FAIL [checkObservationWindows]: expected 2 closed, got ${closed.length}`);
    failures++;
  }

  const btcSignal = closed.find((s) => s.asset === 'bitcoin');
  const ethSignal = closed.find((s) => s.asset === 'ethereum');

  // BTC: bullish, signalPrice 65000 → currentPrice 70000 → correct
  if (btcSignal && btcSignal.outcome === 'correct') {
    console.log('  PASS [outcome]: BTC bullish signal marked correct (price rose)');
  } else {
    console.error('  FAIL [outcome]: BTC signal should be correct');
    failures++;
  }

  // ETH: bullish, signalPrice 3000 → currentPrice 2800 → incorrect
  if (ethSignal && ethSignal.outcome === 'incorrect') {
    console.log('  PASS [outcome]: ETH bullish signal marked incorrect (price fell)');
  } else {
    console.error('  FAIL [outcome]: ETH signal should be incorrect');
    failures++;
  }

  // --- 3. Fee accrual ---
  console.log('\n=== Fee accrual ===');
  // BTC: (70000 - 65000) / 65000 * 100 = 7.6923...% → fee = 7.6923 * 0.05 = 0.3846
  const expectedBtcPctMove = (70000 - 65000) / 65000 * 100;
  const expectedBtcFee = expectedBtcPctMove * PFT_FEE_PCT;

  if (btcSignal && Math.abs(btcSignal.rawFeeAccrued - expectedBtcFee) < 0.001) {
    console.log(`  PASS [fee]: BTC correct signal accrued fee ${btcSignal.rawFeeAccrued.toFixed(4)} PFT`);
  } else {
    console.error(`  FAIL [fee]: BTC fee expected ~${expectedBtcFee.toFixed(4)}, got ${btcSignal?.rawFeeAccrued}`);
    failures++;
  }

  if (ethSignal && ethSignal.rawFeeAccrued === 0) {
    console.log('  PASS [fee]: ETH incorrect signal accrued 0 fee');
  } else {
    console.error(`  FAIL [fee]: ETH incorrect signal should accrue 0, got ${ethSignal?.rawFeeAccrued}`);
    failures++;
  }

  // --- 4. getUserFeeStatement & above-water check ---
  console.log('\n=== getUserFeeStatement & above-water check ===');
  const stmt = await getUserFeeStatement({ userDiscordId: userId });

  if (stmt.totalSignals === 2) {
    console.log('  PASS [statement]: totalSignals = 2');
  } else {
    console.error(`  FAIL [statement]: expected totalSignals 2, got ${stmt.totalSignals}`);
    failures++;
  }

  if (stmt.correctSignals === 1 && stmt.incorrectSignals === 1) {
    console.log('  PASS [statement]: 1 correct, 1 incorrect');
  } else {
    console.error(`  FAIL [statement]: expected 1/1 correct/incorrect, got ${stmt.correctSignals}/${stmt.incorrectSignals}`);
    failures++;
  }

  // Cumulative P&L: BTC correct = +7.69%, ETH incorrect = -6.67% → net ~+1.03%
  // Since net is positive, fees should be owed and not net-negative
  if (stmt.cumulativePnlPct > 0) {
    console.log(`  PASS [statement]: cumulativePnlPct positive (${stmt.cumulativePnlPct.toFixed(4)}%)`);
  } else {
    console.error(`  FAIL [statement]: cumulativePnlPct should be positive, got ${stmt.cumulativePnlPct}`);
    failures++;
  }

  if (stmt.totalFeesOwed > 0) {
    console.log(`  PASS [statement]: totalFeesOwed = ${stmt.totalFeesOwed.toFixed(4)} PFT`);
  } else {
    console.error(`  FAIL [statement]: totalFeesOwed should be > 0, got ${stmt.totalFeesOwed}`);
    failures++;
  }

  if (stmt.isNetNegative === false) {
    console.log('  PASS [statement]: isNetNegative is false (net positive P&L)');
  } else {
    console.error('  FAIL [statement]: isNetNegative should be false');
    failures++;
  }

  // --- 5. Above-water fee suppression test ---
  // Add a big losing signal to make cumulative P&L negative
  console.log('\n=== Above-water fee suppression ===');
  const sig3 = await recordSignal({
    ticketId: 'ticket-3',
    asset: 'ethereum',
    signalDirection: 'long',
    signalPrice: 4000,  // ETH at 2800 → huge loss
    userTimeframe: '1D',
    modeUsed: 'A',
    userDiscordId: userId,
  });

  // Backdate to expire
  const ledger2 = fs.readFileSync(tmpLedger, 'utf-8').trim().split('\n').map(JSON.parse);
  const openRec = ledger2.find((r) => r.status === 'open');
  if (openRec) openRec.observationWindowClosesAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(tmpLedger, ledger2.map(JSON.stringify).join('\n') + '\n', 'utf-8');

  await checkObservationWindows();
  const stmt2 = await getUserFeeStatement({ userDiscordId: userId });

  // Cumulative: +7.69% - 6.67% - 30% = ~-28.97% → negative → fee suppression active
  if (stmt2.cumulativePnlPct < 0) {
    console.log(`  PASS [above-water]: cumulativePnlPct is negative (${stmt2.cumulativePnlPct.toFixed(4)}%)`);
  } else {
    console.error(`  FAIL [above-water]: expected negative cumulative P&L, got ${stmt2.cumulativePnlPct}`);
    failures++;
  }

  if (stmt2.isNetNegative === true) {
    console.log('  PASS [above-water]: isNetNegative is true');
  } else {
    console.error('  FAIL [above-water]: isNetNegative should be true');
    failures++;
  }

  // The BTC fee was accrued when cumulative was positive (+7.69% at that point),
  // but after ETH incorrect makes cumulative negative, above-water logic iterates chronologically.
  // After sig1 (BTC correct): cumPnl = +7.69% (positive → fee counts)
  // After sig2 (ETH incorrect): cumPnl = +7.69% - 6.67% = +1.03% (still positive → no additional fee from incorrect anyway)
  // After sig3 (ETH incorrect): cumPnl = +1.03% - 30% = -28.97% (negative → fee would NOT count, but sig3 has rawFeeAccrued=0 anyway)
  // So totalFeesOwed should still be the BTC fee (accrued when cumPnl was positive)
  if (stmt2.totalFeesOwed > 0 && Math.abs(stmt2.totalFeesOwed - expectedBtcFee) < 0.001) {
    console.log(`  PASS [above-water]: totalFeesOwed correctly includes only BTC fee from when P&L was positive`);
  } else {
    console.error(`  FAIL [above-water]: totalFeesOwed expected ${expectedBtcFee.toFixed(4)}, got ${stmt2.totalFeesOwed}`);
    failures++;
  }

  // --- 6. Notification string format ---
  console.log('\n=== generateSignalOutcomeNotification ===');
  const notifCorrect = await generateSignalOutcomeNotification({ signalId: sig1.signalId });
  const notifIncorrect = await generateSignalOutcomeNotification({ signalId: sig2.signalId });

  if (notifCorrect.includes('bitcoin') && notifCorrect.includes('bullish') && notifCorrect.includes('correct') && notifCorrect.includes('PFT')) {
    console.log(`  PASS [notification]: correct signal → "${notifCorrect}"`);
  } else {
    console.error(`  FAIL [notification]: unexpected format: "${notifCorrect}"`);
    failures++;
  }

  if (notifIncorrect.includes('ethereum') && notifIncorrect.includes('bullish') && notifIncorrect.includes('incorrect') && notifIncorrect.includes('PFT')) {
    console.log(`  PASS [notification]: incorrect signal → "${notifIncorrect}"`);
  } else {
    console.error(`  FAIL [notification]: unexpected format: "${notifIncorrect}"`);
    failures++;
  }

  // Check that correct notification has positive percentage
  if (notifCorrect.includes('+')) {
    console.log('  PASS [notification]: correct signal shows positive percentage');
  } else {
    console.error('  FAIL [notification]: correct signal should show + sign');
    failures++;
  }

  // Check that incorrect notification has negative percentage
  if (notifIncorrect.includes('-')) {
    console.log('  PASS [notification]: incorrect signal shows negative percentage');
  } else {
    console.error('  FAIL [notification]: incorrect signal should show - sign');
    failures++;
  }

  // --- Cleanup ---
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // --- Summary ---
  console.log(`\n=== Done: ${failures} failure(s) ===`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
