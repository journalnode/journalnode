'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assembleDataPack } = require('./rawDataPack');

// ---------------------------------------------------------------------------
// Configurable fee rate — pending final design decision
// ---------------------------------------------------------------------------
const PFT_FEE_PCT = 0.05; // 5% of profitable signal move

const LEDGER_PATH = path.join(__dirname, '..', 'data', 'signalLedger.jsonl');
const DATA_DIR = path.join(__dirname, '..', 'data');

// ---------------------------------------------------------------------------
// Timeframe string → milliseconds conversion
// ---------------------------------------------------------------------------
const TIMEFRAME_MS = {
  '1D': 1 * 24 * 60 * 60 * 1000,
  '3D': 3 * 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '2W': 14 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Helpers: read / write ledger
// ---------------------------------------------------------------------------
function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  const raw = fs.readFileSync(LEDGER_PATH, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

function writeLedger(records) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(LEDGER_PATH, content, 'utf-8');
}

function appendRecord(record) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(record) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Allow tests to override the ledger path
// ---------------------------------------------------------------------------
let _ledgerPath = LEDGER_PATH;

function _setLedgerPath(p) {
  _ledgerPath = p;
}

function _getLedgerPath() {
  return _ledgerPath;
}

function _readLedger() {
  if (!fs.existsSync(_ledgerPath)) return [];
  const raw = fs.readFileSync(_ledgerPath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

function _writeLedger(records) {
  const dir = path.dirname(_ledgerPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(_ledgerPath, content, 'utf-8');
}

function _appendRecord(record) {
  const dir = path.dirname(_ledgerPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(_ledgerPath, JSON.stringify(record) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// 1. recordSignal
// ---------------------------------------------------------------------------
async function recordSignal({ ticketId, asset, signalDirection, signalPrice, userTimeframe, modeUsed, userDiscordId }) {
  const ms = TIMEFRAME_MS[userTimeframe];
  if (!ms) throw new Error(`Unsupported timeframe: ${userTimeframe}`);

  const createdAt = new Date().toISOString();
  const observationWindowClosesAt = new Date(Date.now() + ms).toISOString();

  const record = {
    signalId: crypto.randomUUID(),
    ticketId,
    asset,
    signalDirection,
    signalPrice,
    userTimeframe,
    modeUsed,
    userDiscordId,
    createdAt,
    observationWindowClosesAt,
    status: 'open',
  };

  _appendRecord(record);
  return record;
}

// ---------------------------------------------------------------------------
// 2. checkObservationWindows
// ---------------------------------------------------------------------------
async function checkObservationWindows() {
  const records = _readLedger();
  const now = Date.now();
  const results = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.status !== 'open') continue;
    if (new Date(rec.observationWindowClosesAt).getTime() > now) continue;

    // Window expired — fetch current price
    const pack = await assembleDataPack({
      ticker: rec.asset,
      assetClass: 'crypto',
      timeframe: rec.userTimeframe,
    });
    const currentPrice = pack.price_current;

    // Determine outcome
    const dir = rec.signalDirection.toLowerCase();
    const isBullish = dir === 'bullish' || dir === 'long';
    const isBearish = dir === 'bearish' || dir === 'short';

    let outcome;
    if (isBullish && currentPrice > rec.signalPrice) {
      outcome = 'correct';
    } else if (isBearish && currentPrice < rec.signalPrice) {
      outcome = 'correct';
    } else {
      outcome = 'incorrect';
    }

    // Compute raw fee (only for correct signals)
    let rawFeeAccrued = 0;
    if (outcome === 'correct') {
      const priceDeltaPct = Math.abs((currentPrice - rec.signalPrice) / rec.signalPrice * 100);
      rawFeeAccrued = Math.max(0, priceDeltaPct * PFT_FEE_PCT);
    }

    records[i] = {
      ...rec,
      status: 'closed',
      closedAt: new Date().toISOString(),
      outcome,
      currentPrice,
      rawFeeAccrued,
    };

    results.push(records[i]);
  }

  _writeLedger(records);
  return results;
}

// ---------------------------------------------------------------------------
// 3. getUserFeeStatement
// ---------------------------------------------------------------------------
async function getUserFeeStatement({ userDiscordId }) {
  const records = _readLedger();
  const userSignals = records
    .filter((r) => r.userDiscordId === userDiscordId && r.status === 'closed')
    .sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));

  let correctSignals = 0;
  let incorrectSignals = 0;
  let cumulativePnlPct = 0;
  let totalFeesOwed = 0;

  for (const sig of userSignals) {
    const priceDeltaPct = (sig.currentPrice - sig.signalPrice) / sig.signalPrice * 100;
    const dir = sig.signalDirection.toLowerCase();
    const isBullish = dir === 'bullish' || dir === 'long';

    // Signed P&L: positive when signal was correct
    const signedPnl = isBullish ? priceDeltaPct : -priceDeltaPct;

    if (sig.outcome === 'correct') {
      correctSignals++;
      cumulativePnlPct += Math.abs(signedPnl);
    } else {
      incorrectSignals++;
      cumulativePnlPct -= Math.abs(signedPnl);
    }

    // High-water mark: only accrue fees when cumulative P&L is positive
    if (cumulativePnlPct > 0 && sig.rawFeeAccrued > 0) {
      totalFeesOwed += sig.rawFeeAccrued;
    }
  }

  const totalSignals = userSignals.length;
  const highWaterMarkActive = cumulativePnlPct <= 0;

  return {
    totalSignals,
    correctSignals,
    incorrectSignals,
    cumulativePnlPct,
    totalFeesOwed,
    highWaterMarkActive,
    signals: userSignals,
  };
}

// ---------------------------------------------------------------------------
// 4. generateSignalOutcomeNotification
// ---------------------------------------------------------------------------
async function generateSignalOutcomeNotification({ signalId }) {
  const records = _readLedger();
  const sig = records.find((r) => r.signalId === signalId);
  if (!sig) throw new Error(`Signal not found: ${signalId}`);
  if (sig.status !== 'closed') throw new Error(`Signal ${signalId} is not yet closed`);

  const priceDeltaPct = (sig.currentPrice - sig.signalPrice) / sig.signalPrice * 100;
  const dir = sig.signalDirection.toLowerCase();
  const isBullish = dir === 'bullish' || dir === 'long';
  const signedPct = isBullish ? priceDeltaPct : -priceDeltaPct;
  const sign = signedPct >= 0 ? '+' : '';
  const dateStr = new Date(sig.createdAt).toLocaleDateString('en-US');
  const fee = sig.rawFeeAccrued.toFixed(2);

  return `Your ${sig.asset} ${sig.signalDirection} signal from ${dateStr} was ${sig.outcome} (${sign}${signedPct.toFixed(2)}%). Protocol fee: ${fee} PFT.`;
}

module.exports = {
  recordSignal,
  checkObservationWindows,
  getUserFeeStatement,
  generateSignalOutcomeNotification,
  PFT_FEE_PCT,
  _setLedgerPath,
  _getLedgerPath,
};
