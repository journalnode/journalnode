const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'journal.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp_utc TEXT NOT NULL,
        word_count INTEGER NOT NULL,
        char_count INTEGER NOT NULL
      )
    `);
  }
  return db;
}

function insertEntry({ userId, username, content, timestampUtc }) {
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const charCount = content.length;
  const stmt = getDb().prepare(`
    INSERT INTO journal_entries (user_id, username, content, timestamp_utc, word_count, char_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(userId, username, content, timestampUtc, wordCount, charCount);
  return { id: info.lastInsertRowid, wordCount, charCount };
}

function getEntryById(id) {
  return getDb().prepare('SELECT * FROM journal_entries WHERE id = ?').get(id);
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, insertEntry, getEntryById, close };
