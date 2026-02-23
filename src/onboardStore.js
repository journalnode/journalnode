const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ONBOARD_FILE = path.join(DATA_DIR, 'onboarding.json');

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(ONBOARD_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(ONBOARD_FILE, 'utf8'));
}

function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(ONBOARD_FILE, JSON.stringify(store, null, 2));
}

function getUserPurpose(userId) {
  const store = loadStore();
  return store[userId] || null;
}

function setUserPurpose(userId, purpose) {
  const store = loadStore();
  store[userId] = {
    purpose,
    updatedAt: new Date().toISOString(),
  };
  saveStore(store);
}

module.exports = { getUserPurpose, setUserPurpose };
