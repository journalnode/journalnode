const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'model_reliability.db');

let db;

function getDb() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS predictions (
      id TEXT PRIMARY KEY,
      modelName TEXT NOT NULL,
      asset TEXT NOT NULL,
      assetClass TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      predictedDirection TEXT NOT NULL,
      predictedValue REAL,
      modeUsed TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      actualOutcome TEXT,
      score REAL
    )
  `);
  return db;
}

function recordPrediction({ modelName, asset, assetClass, timeframe, predictedDirection, predictedValue, modeUsed, timestamp }) {
  const database = getDb();
  const id = crypto.randomUUID();
  database.prepare(`
    INSERT INTO predictions (id, modelName, asset, assetClass, timeframe, predictedDirection, predictedValue, modeUsed, timestamp, actualOutcome, score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(id, modelName, asset, assetClass, timeframe, predictedDirection, predictedValue, modeUsed, timestamp);
  return id;
}

function scorePrediction(id, actualOutcome) {
  const database = getDb();
  const scoreMap = { correct: 1, partial: 0.5, incorrect: 0 };
  const score = scoreMap[actualOutcome];
  if (score === undefined) {
    throw new Error(`Invalid outcome: ${actualOutcome}. Must be "correct", "incorrect", or "partial".`);
  }
  const result = database.prepare(`
    UPDATE predictions SET actualOutcome = ?, score = ? WHERE id = ?
  `).run(actualOutcome, score, id);
  if (result.changes === 0) {
    throw new Error(`Prediction not found: ${id}`);
  }
  const row = database.prepare(`SELECT modelName, assetClass FROM predictions WHERE id = ?`).get(id);
  return getModelReliability(row.modelName, row.assetClass);
}

function getModelReliability(modelName, assetClass) {
  const database = getDb();
  const row = database.prepare(`
    SELECT COUNT(*) as total, COALESCE(SUM(score), 0) as scoreSum
    FROM predictions
    WHERE modelName = ? AND assetClass = ? AND score IS NOT NULL
  `).get(modelName, assetClass);
  if (row.total < 5) return 1.0;
  return row.scoreSum / row.total;
}

function getModelStats(modelName) {
  const database = getDb();
  const totalRow = database.prepare(`
    SELECT COUNT(*) as total FROM predictions WHERE modelName = ?
  `).get(modelName);
  const scoredRow = database.prepare(`
    SELECT COUNT(*) as scored FROM predictions WHERE modelName = ? AND score IS NOT NULL
  `).get(modelName);
  const classes = database.prepare(`
    SELECT DISTINCT assetClass FROM predictions WHERE modelName = ?
  `).all(modelName);
  const byAssetClass = {};
  for (const { assetClass } of classes) {
    const stats = database.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN score IS NOT NULL THEN 1 ELSE 0 END) as scored,
        SUM(CASE WHEN actualOutcome = 'correct' THEN 1 ELSE 0 END) as correct,
        SUM(CASE WHEN actualOutcome = 'partial' THEN 1 ELSE 0 END) as partial,
        SUM(CASE WHEN actualOutcome = 'incorrect' THEN 1 ELSE 0 END) as incorrect
      FROM predictions
      WHERE modelName = ? AND assetClass = ?
    `).get(modelName, assetClass);
    byAssetClass[assetClass] = {
      total: stats.total,
      scored: stats.scored,
      correct: stats.correct,
      partial: stats.partial,
      incorrect: stats.incorrect,
      reliability: getModelReliability(modelName, assetClass),
    };
  }
  return {
    modelName,
    totalPredictions: totalRow.total,
    scoredPredictions: scoredRow.scored,
    byAssetClass,
  };
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { recordPrediction, scorePrediction, getModelReliability, getModelStats, closeDb };
