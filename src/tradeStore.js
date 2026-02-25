const fs = require('fs');
const path = require('path');

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

module.exports = { addTrade, getUserTrades };
