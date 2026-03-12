const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ANALYSIS_FILE = path.join(DATA_DIR, 'analyses.json');

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(ANALYSIS_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf8'));
}

function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(store, null, 2));
}

function saveAnalysis(userId, record) {
  const store = loadStore();
  if (!store[userId]) {
    store[userId] = [];
  }
  const entry = {
    analysisId: crypto.randomUUID(),
    ...record,
    createdAt: new Date().toISOString(),
  };
  store[userId].push(entry);
  saveStore(store);
  return entry;
}

function getAnalysesByTradeId(userId, tradeId) {
  const store = loadStore();
  const all = store[userId] || [];
  return all.filter(a => a.tradeId === tradeId);
}

function getUserAnalyses(userId) {
  const store = loadStore();
  return store[userId] || [];
}

module.exports = { saveAnalysis, getAnalysesByTradeId, getUserAnalyses };
