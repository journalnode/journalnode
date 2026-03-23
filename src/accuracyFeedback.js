const fs = require('fs');
const path = require('path');
const { getTicketById, _JOURNAL_PATH } = require('./tradeTicket');
const { recordPrediction, scorePrediction } = require('./modelReliability');

const JOURNAL_PATH = _JOURNAL_PATH;

// --- Helpers ---

function consensusMatchesDirection(modelConsensus, direction) {
  const bullish = ['bullish', 'long'];
  const bearish = ['bearish', 'short'];
  if (direction === 'long') return bullish.includes(modelConsensus);
  if (direction === 'short') return bearish.includes(modelConsensus);
  return false;
}

function determineCorrectness(outcome, modelConsensus, direction) {
  if (modelConsensus === 'mixed' || modelConsensus === 'neutral') return 'partial';
  const matched = consensusMatchesDirection(modelConsensus, direction);
  if (matched) {
    if (outcome === 'win') return 'correct';
    if (outcome === 'loss') return 'incorrect';
    return 'partial';
  }
  return 'partial';
}

function extractContributingModels(sapOutput) {
  const models = new Set();
  // Mode B: sapOutput.models[].modelName
  if (Array.isArray(sapOutput.models)) {
    for (const m of sapOutput.models) {
      if (m.modelName) models.add(m.modelName);
    }
  }
  // Mode D: sapOutput.runs[].modelName
  if (Array.isArray(sapOutput.runs)) {
    for (const r of sapOutput.runs) {
      if (r.modelName) models.add(r.modelName);
    }
  }
  return [...models];
}

function readAllRecords() {
  if (!fs.existsSync(JOURNAL_PATH)) return [];
  const lines = fs.readFileSync(JOURNAL_PATH, 'utf-8').split('\n').filter(l => l.trim());
  return lines.map(l => JSON.parse(l));
}

// --- Exported functions ---

async function processTradeClosure({ ticketId }) {
  const ticket = getTicketById(ticketId);
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);
  if (ticket.status !== 'closed') throw new Error(`Ticket not closed: ${ticketId}`);

  const { modeUsed, modelConsensus, outcome, direction, sapOutput,
          ticker, assetClass, timeframe, scsScoreAtEntry, createdAt } = ticket;

  const score = determineCorrectness(outcome, modelConsensus, direction);
  const contributingModels = extractContributingModels(sapOutput);

  const results = [];
  for (const modelName of contributingModels) {
    const predictionId = recordPrediction({
      modelName,
      asset: ticker,
      assetClass,
      timeframe,
      predictedDirection: modelConsensus,
      predictedValue: scsScoreAtEntry,
      modeUsed,
      timestamp: createdAt
    });
    const reliability = scorePrediction(predictionId, score);
    results.push({ modelName, score, reliability });
  }

  return { ticketId, score, contributingModels, results };
}

async function getModeAccuracyStats({ userDiscordId }) {
  const records = readAllRecords();
  const closed = records.filter(r => r.status === 'closed' && r.userDiscordId === userDiscordId);

  const modes = {};
  for (const ticket of closed) {
    const mode = `mode_${ticket.modeUsed.toLowerCase()}`;
    if (!modes[mode]) modes[mode] = { total: 0, correct: 0, incorrect: 0, partial: 0 };
    const correctness = determineCorrectness(ticket.outcome, ticket.modelConsensus, ticket.direction);
    modes[mode].total++;
    modes[mode][correctness]++;
  }

  const result = {};
  for (const [mode, stats] of Object.entries(modes)) {
    if (stats.total < 3) {
      result[mode] = null;
    } else {
      result[mode] = {
        ...stats,
        accuracyPct: (stats.correct + 0.5 * stats.partial) / stats.total * 100
      };
    }
  }

  return result;
}

async function getPersonalCalibrationScore({ userDiscordId }) {
  const records = readAllRecords();
  const closed = records.filter(r => r.status === 'closed' && r.userDiscordId === userDiscordId);

  if (closed.length === 0) {
    return { calibrationScore: 0, totalSignals: 0, trend: 'stable' };
  }

  closed.sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));

  const scores = closed.map(ticket => {
    const correctness = determineCorrectness(ticket.outcome, ticket.modelConsensus, ticket.direction);
    if (correctness === 'correct') return 1;
    if (correctness === 'partial') return 0.5;
    return 0;
  });

  const totalSignals = scores.length;
  const calibrationScore = (scores.reduce((sum, s) => sum + s, 0) / totalSignals) * 100;

  let trend = 'stable';
  if (totalSignals >= 5) {
    const last5 = scores.slice(-5);
    const last5Avg = (last5.reduce((sum, s) => sum + s, 0) / last5.length) * 100;
    if (last5Avg > calibrationScore + 10) trend = 'improving';
    else if (last5Avg < calibrationScore - 10) trend = 'declining';
  }

  return { calibrationScore, totalSignals, trend };
}

module.exports = { processTradeClosure, getModeAccuracyStats, getPersonalCalibrationScore };
