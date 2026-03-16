const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HL_FILE = path.join(DATA_DIR, 'hyperliquid.json');

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(HL_FILE)) {
    return {};
  }
  const store = JSON.parse(fs.readFileSync(HL_FILE, 'utf8'));
  // Migrate legacy single-wallet entries to multi-wallet format
  for (const [userId, data] of Object.entries(store)) {
    if (data.wallet && !data.wallets) {
      store[userId] = {
        wallets: [{
          id: crypto.randomUUID(),
          wallet: data.wallet,
          label: 'Main',
          channelId: data.channelId,
          active: true,
          linkedAt: data.linkedAt,
        }],
      };
    }
  }
  return store;
}

function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(HL_FILE, JSON.stringify(store, null, 2));
}

/**
 * Add a Hyperliquid wallet for a user with a label.
 * Returns the new wallet entry.
 */
function addWallet(userId, walletAddress, label, channelId) {
  const store = loadStore();
  if (!store[userId]) {
    store[userId] = { wallets: [] };
  }
  const entry = {
    id: crypto.randomUUID(),
    wallet: walletAddress.toLowerCase(),
    label: label || 'Main',
    channelId,
    active: true,
    linkedAt: new Date().toISOString(),
  };
  store[userId].wallets.push(entry);
  saveStore(store);
  return entry;
}

/**
 * Remove a wallet by its ID for a user.
 * Returns true if removed, false if not found.
 */
function removeWallet(userId, walletId) {
  const store = loadStore();
  if (!store[userId]) return false;
  const before = store[userId].wallets.length;
  store[userId].wallets = store[userId].wallets.filter(w => w.id !== walletId);
  if (store[userId].wallets.length === before) return false;
  if (store[userId].wallets.length === 0) {
    delete store[userId];
  }
  saveStore(store);
  return true;
}

/**
 * Rename the label on a wallet.
 * Returns the updated wallet entry or null.
 */
function renameWallet(userId, walletId, newLabel) {
  const store = loadStore();
  if (!store[userId]) return null;
  const wallet = store[userId].wallets.find(w => w.id === walletId);
  if (!wallet) return null;
  wallet.label = newLabel;
  saveStore(store);
  return wallet;
}

/**
 * Get all wallets for a user.
 * Returns an array of wallet entries or empty array.
 */
function getUserWallets(userId) {
  const store = loadStore();
  if (!store[userId]) return [];
  return store[userId].wallets;
}

/**
 * Get all active wallets for a user.
 */
function getActiveWallets(userId) {
  return getUserWallets(userId).filter(w => w.active);
}

/**
 * Get a specific wallet by ID for a user.
 */
function getWalletById(userId, walletId) {
  const wallets = getUserWallets(userId);
  return wallets.find(w => w.id === walletId) || null;
}

/**
 * Find wallet entry by address for a user.
 */
function getWalletByAddress(userId, address) {
  const wallets = getUserWallets(userId);
  return wallets.find(w => w.wallet === address.toLowerCase()) || null;
}

/**
 * Get all linked wallets across all users as a flat array.
 * Each entry: { userId, id, wallet, label, channelId, active, linkedAt }
 */
function getAllLinkedWallets() {
  const store = loadStore();
  const result = [];
  for (const [userId, data] of Object.entries(store)) {
    if (!data.wallets) continue;
    for (const w of data.wallets) {
      if (w.active) {
        result.push({ userId, ...w });
      }
    }
  }
  return result;
}

// Legacy compatibility: get the first linked wallet for a user
function getLinkedWallet(userId) {
  const wallets = getUserWallets(userId);
  if (wallets.length === 0) return null;
  return { wallet: wallets[0].wallet, channelId: wallets[0].channelId, linkedAt: wallets[0].linkedAt };
}

// Legacy compatibility: unlink all wallets for a user
function unlinkWallet(userId) {
  const store = loadStore();
  if (!store[userId]) return false;
  delete store[userId];
  saveStore(store);
  return true;
}

// Legacy compatibility: link a single wallet (adds as first wallet or replaces)
function linkWallet(userId, walletAddress, channelId) {
  const store = loadStore();
  store[userId] = {
    wallets: [{
      id: crypto.randomUUID(),
      wallet: walletAddress.toLowerCase(),
      label: 'Main',
      channelId,
      active: true,
      linkedAt: new Date().toISOString(),
    }],
  };
  saveStore(store);
  return store[userId].wallets[0];
}

module.exports = {
  addWallet,
  removeWallet,
  renameWallet,
  getUserWallets,
  getActiveWallets,
  getWalletById,
  getWalletByAddress,
  getAllLinkedWallets,
  // Legacy exports
  linkWallet,
  unlinkWallet,
  getLinkedWallet,
};
