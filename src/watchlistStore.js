const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlists.json');

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(WATCHLIST_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
}

function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(store, null, 2));
}

function addAsset(userId, ticker) {
  const store = loadStore();
  if (!store[userId]) {
    store[userId] = [];
  }
  const upper = ticker.toUpperCase();
  if (store[userId].some(a => a.ticker === upper)) {
    return null; // already exists
  }
  const entry = { ticker: upper, addedAt: new Date().toISOString() };
  store[userId].push(entry);
  saveStore(store);
  return entry;
}

function removeAsset(userId, ticker) {
  const store = loadStore();
  if (!store[userId]) return false;
  const upper = ticker.toUpperCase();
  const idx = store[userId].findIndex(a => a.ticker === upper);
  if (idx === -1) return false;
  store[userId].splice(idx, 1);
  saveStore(store);
  return true;
}

function getWatchlist(userId) {
  const store = loadStore();
  return store[userId] || [];
}

module.exports = { addAsset, removeAsset, getWatchlist };
