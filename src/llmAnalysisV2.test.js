const openrouterPath = require.resolve('./openrouter');
require.cache[openrouterPath] = {
  id: openrouterPath,
  filename: openrouterPath,
  loaded: true,
  exports: {
    chat: async () => JSON.stringify({
      bullScore: 74,
      bearScore: 31,
      arbiterScore: 42,
      semanticDecay: false,
      recursiveResearch: false,
      debateWinner: 'bullish',
      dataGrounding: [
        { claim: 'Protocol revenue is rising', classification: 'PLAUSIBLE' },
        { claim: 'Major exchange listing next month', classification: 'UNVERIFIABLE' },
      ],
      bullPoints: [
        'Revenue momentum is improving faster than peers.',
        'Catalyst calendar is front-loaded over the next quarter.',
      ],
      bearPoints: [
        'The thesis still depends on multiple execution assumptions.',
        'Liquidity can break down if the catalyst slips.',
      ],
      arbiterSummary: 'The setup has upside, but it is only investable if the catalyst path is real.',
      consensusAlignmentNote: 'Useful for testing whether the market narrative is ahead of the facts.',
      thesisCoherenceNote: 'Needs tighter evidence on the claimed catalyst path.',
      riskFlags: [
        'The listing claim is not independently verified.',
        'Thin liquidity could amplify downside.',
      ],
      confidenceLabel: 'MEDIUM',
    }),
    chatWithMessages: async () => {
      throw new Error('chatWithMessages should not be called in Bull/Bear mode tests.');
    },
  },
};

const { runBullBearMode } = require('./llmAnalysisV2');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAll() {
  console.log('\n=== LLM Analysis V2 Tests ===\n');

  await test('bull/bear mode returns gist-ready structured output', async () => {
    const result = await runBullBearMode({
      asset: 'PFT',
      thesis: 'PFT can rerate if validator demand and treasury credibility improve together.',
      timeframe: '90 days',
      currentPrice: 0.42,
      marketCap: 42000000,
      supportingData: 'Treasury buyback rumors are circulating, but there is no official confirmation yet.',
    });

    assert(result.title === 'Bullish/Bearish v2', `unexpected title: ${result.title}`);
    assert(typeof result.analysis === 'object' && result.analysis !== null, 'analysis object missing');
    assert(result.analysis.directionalVerdict === 'Bullish', `unexpected verdict: ${result.analysis.directionalVerdict}`);
    assert(result.analysis.strongestBullCase === 'Revenue momentum is improving faster than peers.', 'strongest bull case mismatch');
    assert(result.analysis.strongestBearCase === 'The thesis still depends on multiple execution assumptions.', 'strongest bear case mismatch');
    assert(Array.isArray(result.analysis.keyUncertainties) && result.analysis.keyUncertainties.length === 2, 'key uncertainties missing');
    assert(Array.isArray(result.analysis.refinementNotes) && result.analysis.refinementNotes.length >= 2, 'refinement notes missing');
    assert(typeof result.gist?.markdown === 'string' && result.gist.markdown.length > 0, 'gist markdown missing');
    assert(result.gist.markdown.includes('## Directional Verdict'), 'gist markdown missing verdict section');
    assert(result.gist.markdown.includes('## Strongest Bull Case'), 'gist markdown missing bull section');
    assert(result.gist.markdown.includes('## Strongest Bear Case'), 'gist markdown missing bear section');
    assert(result.gist.markdown.includes('## Key Uncertainties And Caveats'), 'gist markdown missing uncertainty section');
    assert(result.gist.markdown.includes('## Refinement Notes'), 'gist markdown missing refinement section');
    assert(typeof result.gist.oneLineSummary === 'string' && result.gist.oneLineSummary.includes('PFT: Bullish | arbiter +42'), 'one-line summary missing expected content');
  });
}

runAll().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
