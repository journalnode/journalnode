'use strict';

const { runModeA } = require('./modeA');
const { runModeB } = require('./modeB');
const { runModeC } = require('./modeC');
const { runModeD } = require('./modeD');
const { anchorOutput } = require('./onChainAnchor');
const { createTradeTicket, closeTradeTicket } = require('./tradeTicket');
const { recordSignal, checkObservationWindows } = require('./pftFee');
const { processTradeClosure } = require('./accuracyFeedback');

// ---------------------------------------------------------------------------
// 1. runAnalysis — routes to correct mode, auto-anchors
// ---------------------------------------------------------------------------
async function runAnalysis({
  ticker,
  assetClass,
  timeframe,
  mode,
  selectedModels,
  imagePath,
  targetDate,
  userDiscordId,
  _handlerOverride,
  _visionHandler,
  _modelHandler,
  _trapHandler,
}) {
  if (!['A', 'B', 'C', 'D'].includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Must be A, B, C, or D.`);
  }

  let result;

  if (mode === 'A') {
    const primaryModel = selectedModels && selectedModels[0];
    result = await runModeA({
      ticker,
      assetClass,
      timeframe,
      primaryModel,
      _handlerOverride,
    });
  } else if (mode === 'B') {
    result = await runModeB({
      ticker,
      assetClass,
      targetDate,
      selectedModels,
      _handlerOverride,
    });
  } else if (mode === 'C') {
    const selectedModel = selectedModels && selectedModels[0];
    result = await runModeC({
      ticker,
      assetClass,
      targetDate,
      selectedModel,
      _handlerOverride,
    });
  } else if (mode === 'D') {
    result = await runModeD({
      imagePath,
      selectedModels,
      ticker,
      _visionHandler,
      _modelHandler,
      _trapHandler,
    });
  }

  // Auto-anchor the result
  const modeLabel = `mode_${mode.toLowerCase()}`;
  const anchor = await anchorOutput({
    sapOutput: result,
    ticker,
    modeUsed: modeLabel,
    userDiscordId,
  });

  return { ...result, anchor: { contentHash: anchor.contentHash, txHash: anchor.txHash } };
}

// ---------------------------------------------------------------------------
// 2. openTrade — creates ticket + records signal
// ---------------------------------------------------------------------------
async function openTrade({
  ticker,
  assetClass,
  direction,
  entryPrice,
  stopLoss,
  takeProfit,
  timeframe,
  sapOutput,
  userAlignment,
  userDiscordId,
}) {
  const ticket = await createTradeTicket({
    ticker,
    assetClass,
    direction,
    entryPrice,
    stopLoss,
    takeProfit,
    timeframe,
    sapOutput,
    userAlignment,
  });

  const signal = await recordSignal({
    ticketId: ticket.id,
    asset: ticker,
    signalDirection: ticket.modelConsensus,
    signalPrice: ticket.signalPriceAtEntry || entryPrice,
    userTimeframe: timeframe,
    modeUsed: ticket.modeUsed,
    userDiscordId,
  });

  return { ticket, signal };
}

// ---------------------------------------------------------------------------
// 3. closeTrade — closes ticket + processes accuracy + checks windows
// ---------------------------------------------------------------------------
async function closeTrade({ ticketId, exitPrice, outcome, userDiscordId }) {
  const closedTicket = await closeTradeTicket({
    id: ticketId,
    exitPrice,
    outcome,
  });

  const accuracyResult = await processTradeClosure({ ticketId });

  const windowResults = await checkObservationWindows();

  return {
    closedTicket,
    accuracyResult,
    windowResults,
  };
}

// ---------------------------------------------------------------------------
// CLI interface
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      args[key] = val;
      if (val !== 'true') i++;
    }
  }
  return args;
}

if (require.main === module) {
  const command = process.argv[2];
  const flags = parseArgs(process.argv.slice(3));

  (async () => {
    try {
      if (command === 'analyze') {
        const result = await runAnalysis({
          ticker: flags.ticker,
          assetClass: flags.assetClass,
          mode: flags.mode,
          timeframe: flags.timeframe || '1W',
          selectedModels: flags.models ? flags.models.split(',') : undefined,
          imagePath: flags.imagePath,
          targetDate: flags.targetDate,
          userDiscordId: flags.userDiscordId,
        });
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'open-trade') {
        console.error('open-trade requires sapOutput via programmatic API');
        process.exit(1);
      } else if (command === 'close-trade') {
        const result = await closeTrade({
          ticketId: flags.ticketId,
          exitPrice: parseFloat(flags.exitPrice),
          outcome: flags.outcome,
          userDiscordId: flags.userDiscordId,
        });
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error('Usage: node journalNode.js <analyze|open-trade|close-trade> [--flags]');
        console.error('  analyze    --ticker BTC --assetClass crypto --mode A --timeframe 1W');
        console.error('  open-trade (programmatic API only — requires sapOutput object)');
        console.error('  close-trade --ticketId <id> --exitPrice 70000 --outcome win');
        process.exit(1);
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = { runAnalysis, openTrade, closeTrade };
