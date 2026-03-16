const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRADES_FILE = path.join(DATA_DIR, 'trades.json');

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(TRADES_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
}

function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(TRADES_FILE, JSON.stringify(store, null, 2));
}

function addTrade(userId, trade) {
  const store = loadStore();
  if (!store[userId]) {
    store[userId] = [];
  }
  const entry = {
    id: store[userId].length + 1,
    tradeId: crypto.randomUUID(),
    ...trade,
    createdAt: new Date().toISOString(),
  };
  store[userId].push(entry);
  saveStore(store);
  return entry;
}

function getUserTrades(userId) {
  const store = loadStore();
  return store[userId] || [];
}

function getTradeByTradeId(userId, tradeId) {
  const trades = getUserTrades(userId);
  return trades.find(t => t.tradeId === tradeId) || null;
}

function getOpenTrades(userId) {
  const trades = getUserTrades(userId);
  return trades.filter(t => t.status !== 'closed');
}

function closeTrade(userId, tradeId, closeData) {
  const store = loadStore();
  const trades = store[userId] || [];
  const trade = trades.find(t => t.tradeId === tradeId);
  if (!trade) return null;

  trade.status = 'closed';
  trade.outcome = closeData.outcome;
  trade.exitPrice = closeData.exitPrice || null;
  trade.reflection = closeData.reflection;
  trade.closeScreenshotUrl = closeData.closeScreenshotUrl || null;
  trade.closedAt = new Date().toISOString();

  // Optional P&L fields (populated by auto-close from Hyperliquid)
  if (closeData.pnl !== undefined) trade.pnl = closeData.pnl;
  if (closeData.pnlPercent !== undefined) trade.pnlPercent = closeData.pnlPercent;

  saveStore(store);
  return trade;
}

module.exports = { addTrade, getUserTrades, getTradeByTradeId, getOpenTrades, closeTrade };
