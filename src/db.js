const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'journal.json');

let data;

function load() {
  if (!data) {
    if (fs.existsSync(DB_PATH)) {
      data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } else {
      data = { nextId: 1, entries: [] };
      save();
    }
  }
  return data;
}

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function insertEntry({ userId, username, content, timestampUtc }) {
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const charCount = content.length;
  const store = load();
  const id = store.nextId++;
  store.entries.push({ id, userId, username, content, timestampUtc, wordCount, charCount });
  save();
  return { id, wordCount, charCount };
}

function getEntryById(id) {
  return load().entries.find(e => e.id === id) || null;
}

function close() {
  // no-op for JSON store, kept for API compatibility
}

module.exports = { insertEntry, getEntryById, close };
