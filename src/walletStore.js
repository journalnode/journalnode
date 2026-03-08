const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WALLETS_FILE = path.join(DATA_DIR, 'wallets.json');
const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
  const secret = process.env.WALLET_ENCRYPTION_KEY || process.env.DISCORD_TOKEN;
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return {
    data: encrypted,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decrypt(encrypted) {
  const key = getEncryptionKey();
  const iv = Buffer.from(encrypted.iv, 'base64');
  const tag = Buffer.from(encrypted.tag, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted.data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(WALLETS_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
}

function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(store, null, 2));
}

function getUserWallets(userId) {
  const store = loadStore();
  return store[userId] || { activeAddress: null, wallets: [] };
}

function addWallet(userId, address, seed, publicKey) {
  const store = loadStore();
  if (!store[userId]) {
    store[userId] = { activeAddress: null, wallets: [] };
  }

  // Don't add duplicates
  if (store[userId].wallets.some(w => w.address === address)) {
    return false;
  }

  store[userId].wallets.push({
    address,
    encryptedSeed: encrypt(seed),
    publicKey,
    createdAt: new Date().toISOString(),
  });

  // Auto-set active if this is the first wallet
  if (!store[userId].activeAddress) {
    store[userId].activeAddress = address;
  }

  saveStore(store);
  return true;
}

function removeWallet(userId, address) {
  const store = loadStore();
  if (!store[userId]) return false;

  const before = store[userId].wallets.length;
  store[userId].wallets = store[userId].wallets.filter(w => w.address !== address);
  if (store[userId].wallets.length === before) return false;

  // If we deleted the active wallet, switch to the first remaining or null
  if (store[userId].activeAddress === address) {
    store[userId].activeAddress = store[userId].wallets.length > 0
      ? store[userId].wallets[0].address
      : null;
  }

  saveStore(store);
  return true;
}

function setActiveWallet(userId, address) {
  const store = loadStore();
  if (!store[userId]) return false;

  const wallet = store[userId].wallets.find(w => w.address === address);
  if (!wallet) return false;

  store[userId].activeAddress = address;
  saveStore(store);
  return true;
}

function getActiveWallet(userId) {
  const user = getUserWallets(userId);
  if (!user.activeAddress) return null;
  return user.wallets.find(w => w.address === user.activeAddress) || null;
}

function getWalletSeed(userId, address) {
  const user = getUserWallets(userId);
  const wallet = user.wallets.find(w => w.address === address);
  if (!wallet) return null;
  return decrypt(wallet.encryptedSeed);
}

function findUserByAddress(address) {
  const store = loadStore();
  for (const [userId, userData] of Object.entries(store)) {
    const wallet = userData.wallets.find(w => w.address === address);
    if (wallet) return { userId, address: wallet.address };
  }
  return null;
}

module.exports = {
  getUserWallets,
  addWallet,
  removeWallet,
  setActiveWallet,
  getActiveWallet,
  getWalletSeed,
  findUserByAddress,
};
