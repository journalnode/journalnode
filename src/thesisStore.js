const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const THESES_FILE = path.join(DATA_DIR, 'theses.json');

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(THESES_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(THESES_FILE, 'utf8'));
}

function saveStore(store) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(THESES_FILE, JSON.stringify(store, null, 2));
}

function saveThesis(userId, thesis) {
  const store = loadStore();
  if (!store[userId]) {
    store[userId] = [];
  }
  const entry = {
    thesisId: crypto.randomUUID(),
    ...thesis,
    createdAt: new Date().toISOString(),
  };
  store[userId].push(entry);
  saveStore(store);
  return entry;
}

function getUserTheses(userId) {
  const store = loadStore();
  return store[userId] || [];
}

module.exports = { saveThesis, getUserTheses };
