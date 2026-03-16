const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HL_FILE = path.join(DATA_DIR, 'hyperliquid.json');

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(HL_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(HL_FILE, 'utf8'));
}

function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(HL_FILE, JSON.stringify(store, null, 2));
}

/**
 * Link a Hyperliquid wallet address to a Discord user.
 * Each user can have one linked wallet. Relinking replaces the previous one.
 * Also stores the channelId where notifications should be posted.
 */
function linkWallet(userId, walletAddress, channelId) {
  const store = loadStore();
  store[userId] = {
    wallet: walletAddress.toLowerCase(),
    channelId,
    linkedAt: new Date().toISOString(),
  };
  saveStore(store);
  return store[userId];
}

/**
 * Unlink a user's Hyperliquid wallet.
 */
function unlinkWallet(userId) {
  const store = loadStore();
  if (!store[userId]) return false;
  delete store[userId];
  saveStore(store);
  return true;
}

/**
 * Get a user's linked Hyperliquid wallet info.
 * Returns { wallet, channelId, linkedAt } or null.
 */
function getLinkedWallet(userId) {
  const store = loadStore();
  return store[userId] || null;
}

/**
 * Get all linked wallets as an array of { userId, wallet, channelId, linkedAt }.
 */
function getAllLinkedWallets() {
  const store = loadStore();
  return Object.entries(store).map(([userId, data]) => ({
    userId,
    ...data,
  }));
}

module.exports = { linkWallet, unlinkWallet, getLinkedWallet, getAllLinkedWallets };
