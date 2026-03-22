const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assembleDataPack } = require('./rawDataPack');
const { recordPrediction } = require('./modelReliability');

const JOURNAL_PATH = path.join(__dirname, '..', 'data', 'tradeJournal.jsonl');
const DATA_DIR = path.join(__dirname, '..', 'data');

const IMMUTABLE_FIELDS = [
  'modelConsensus',
  'scsScoreAtEntry',
  'modeUsed',
  'userAlignment',
  'signalPriceAtEntry'
];

// --- Mode detection from sapOutput shape ---

function detectMode(sapOutput) {
  if (sapOutput.bullPct !== undefined) return 'A';
  if (sapOutput.vac !== undefined) return 'B';
  if (Array.isArray(sapOutput.runs) && sapOutput.runs.some(r => r.stabilityBadge !== undefined) || sapOutput.stabilityBadge !== undefined) return 'C';
  if (sapOutput.voteTally !== undefined) return 'D';
  throw new Error('Unable to detect SAP mode from sapOutput shape');
}

// --- Consensus derivation per mode ---

function deriveConsensus(sapOutput, mode) {
  if (mode === 'A') {
    const { bullPct, bearPct } = sapOutput;
    if (bullPct > bearPct + 10) return 'bullish';
    if (bearPct > bullPct + 10) return 'bearish';
    return 'mixed';
  }
  if (mode === 'B') {
    // VAC-based: if vac > current price context → bullish
    // Without price context here, use scsScore sign
    const scs = sapOutput.scsScore;
    if (scs !== undefined && scs !== null) {
      if (scs > 10) return 'bullish';
      if (scs < -10) return 'bearish';
      return 'mixed';
    }
    return 'mixed';
  }
  if (mode === 'C') {
    const scs = sapOutput.scsScore;
    if (scs !== undefined && scs !== null) {
      if (scs > 10) return 'bullish';
      if (scs < -10) return 'bearish';
      return 'mixed';
    }
    return 'mixed';
  }
  if (mode === 'D') {
    const tally = sapOutput.voteTally || {};
    if ((tally.long || 0) > (tally.short || 0)) return 'long';
    if ((tally.short || 0) > (tally.long || 0)) return 'short';
    return 'mixed';
  }
  return 'mixed';
}

// --- JSONL helpers ---

function readAllRecords() {
  if (!fs.existsSync(JOURNAL_PATH)) return [];
  const lines = fs.readFileSync(JOURNAL_PATH, 'utf-8').split('\n').filter(l => l.trim());
  return lines.map(l => JSON.parse(l));
}

function appendRecord(record) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.appendFileSync(JOURNAL_PATH, JSON.stringify(record) + '\n');
}

function rewriteRecords(records) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(JOURNAL_PATH, records.map(r => JSON.stringify(r)).join('\n') + '\n');
}

// --- Exported functions ---

async function createTradeTicket({
  ticker,
  assetClass,
  direction,
  entryPrice,
  stopLoss,
  takeProfit,
  timeframe,
  sapOutput,
  userAlignment,
  notes
}) {
  const modeUsed = detectMode(sapOutput);
  const modelConsensus = deriveConsensus(sapOutput, modeUsed);
  const scsScoreAtEntry = modeUsed === 'D' ? null : (sapOutput.scsScore !== undefined ? sapOutput.scsScore : null);

  // Fetch current price via assembleDataPack
  let signalPriceAtEntry = null;
  try {
    const dataPack = await assembleDataPack({ ticker, assetClass, timeframe: timeframe || '1W' });
    signalPriceAtEntry = dataPack.price_current;
  } catch (_) {
    // If data fetch fails, leave as null
  }

  const record = {
    id: crypto.randomUUID(),
    ticker,
    assetClass,
    direction,
    entryPrice,
    stopLoss,
    takeProfit,
    timeframe: timeframe || '1W',
    modeUsed,
    modelConsensus,
    scsScoreAtEntry,
    signalPriceAtEntry,
    userAlignment,
    notes: notes || null,
    sapOutput,
    status: 'open',
    createdAt: new Date().toISOString(),
    immutableFields: IMMUTABLE_FIELDS
  };

  appendRecord(record);
  return record;
}

async function closeTradeTicket({ id, exitPrice, outcome }) {
  const validOutcomes = ['win', 'loss', 'breakeven'];
  if (!validOutcomes.includes(outcome)) {
    throw new Error(`Invalid outcome: ${outcome}. Must be one of: ${validOutcomes.join(', ')}`);
  }

  const records = readAllRecords();
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) {
    throw new Error(`Trade ticket not found: ${id}`);
  }

  const record = records[idx];
  if (record.status === 'closed') {
    throw new Error(`Trade ticket already closed: ${id}`);
  }

  record.exitPrice = exitPrice;
  record.closedAt = new Date().toISOString();
  record.outcome = outcome;
  record.status = 'closed';

  rewriteRecords(records);

  // Map trade outcome to prediction outcome for modelReliability
  const outcomeMap = { win: 'correct', loss: 'incorrect', breakeven: 'partial' };
  const predictedDirection = record.modelConsensus;

  recordPrediction({
    modelName: `sap-mode-${record.modeUsed}`,
    asset: record.ticker,
    assetClass: record.assetClass,
    timeframe: record.timeframe,
    predictedDirection,
    predictedValue: record.scsScoreAtEntry,
    modeUsed: record.modeUsed,
    timestamp: record.createdAt
  });

  return record;
}

function getOpenTickets() {
  return readAllRecords().filter(r => r.status === 'open');
}

function getTicketById(id) {
  const records = readAllRecords();
  return records.find(r => r.id === id) || null;
}

module.exports = {
  createTradeTicket,
  closeTradeTicket,
  getOpenTickets,
  getTicketById,
  _JOURNAL_PATH: JOURNAL_PATH
};
