const openrouterPath = require.resolve('./openrouter');
require.cache[openrouterPath] = {
  id: openrouterPath,
  filename: openrouterPath,
  loaded: true,
  exports: {
    chat: async () => JSON.stringify({
      commandValidity: 'VALID',
      thesisSummary: 'PFT is a bullish 90-day thesis that depends on validator demand and treasury credibility rerating the token.',
      claimTable: [
        { id: 1, claim: 'Protocol revenue is rising', source: 'team dashboard', tier: 'T3', loadBearing: true, classification: 'PLAUSIBLE-SELFREPORTED' },
        { id: 2, claim: 'Major exchange listing next month', source: 'rumor flow', tier: 'T4', loadBearing: true, classification: 'UNVERIFIABLE' },
      ],
      verificationRecords: [
        { claimId: 1, claim: 'Protocol revenue is rising', toolCalled: 'none', sourceReturned: 'UNREACHED', tierReturned: 'UNREACHED', timestamp: 'unknown', match: false, qualified: false },
      ],
      counterCase: [
        { text: 'The treasury narrative is still self-reported and may not transmit to price.', strongest: true },
        { text: 'Liquidity can break down if the catalyst slips.', strongest: false },
      ],
      dimensionScores: {
        dataGrounding: 8,
        thesisCoherence: 13,
        counterThesis: 10,
        riskIdentification: 11,
        consensusEngagement: 9,
        timingCatalyst: 12,
        catalystSubscore: 6,
        whyNotPricedInSubscore: 6,
      },
      edgeClass: 'CONVENTIONAL',
      keyReasons: {
        dataGrounding: 'Current claims are mostly unverified in-session.',
        thesisCoherence: 'The causal chain exists but is not differentiated.',
        counterThesis: 'The strongest objection is only partially answered.',
        riskIdentification: 'Invalidation exists but remains loose.',
        consensusEngagement: 'The thesis gestures at consensus but does not map it tightly.',
        timingCatalyst: 'There is a catalyst window, but the why-not-priced-in case is thin.',
      },
      deductionLog: {
        dataGrounding: 'Verification cap binds because there are no qualified VRs.',
        thesisCoherence: 'Conventional thesis with limited edge.',
        counterThesis: 'Strongest opposing case remains partly unresolved.',
        riskIdentification: 'Downside is not quantified precisely.',
        consensusEngagement: 'Consensus state is asserted more than evidenced.',
        timingCatalyst: 'Catalyst exists, but timing precision is moderate.',
      },
      capsApplied: {
        individual: 'Data Grounding capped at 10/20 because no claims are verifiable.',
        globalFloor: 'No global floor applied.',
      },
      missingStructuralElements: ['why-not-priced-in theory'],
      composite: {
        bbRaw: 63,
        bbScore: 53,
        classification: 'Developing',
      },
      skepticismReview: {
        triggered: false,
        adversarialSummary: 'n/a',
        rescoredComposite: 'n/a',
        finalComposite: '53',
      },
      verdict: 'The thesis is directionally coherent but not yet investable at high confidence because its load-bearing claims are unverified.',
      highestImpactFixes: [
        'Replace rumor-based catalyst claims with named, dated evidence.',
        'Quantify invalidation and downside.',
        'Explain why the rerating is not already priced in.',
      ],
      calibrationLog: {
        thesisId: 'test-thesis-1',
        settlementTargetDate: '2026-08-01',
        vrQualifiedRatio: '0 / 2',
      },
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
      direction: 'BULLISH',
      thesis: 'PFT can rerate if validator demand and treasury credibility improve together.',
      timeframe: '90 days',
      currentPrice: 0.42,
      marketCap: 42000000,
      supportingData: 'Treasury buyback rumors are circulating, but there is no official confirmation yet.',
    });

    assert(result.title === 'Bullish/Bearish v2.0.1', `unexpected title: ${result.title}`);
    assert(typeof result.analysis === 'object' && result.analysis !== null, 'analysis object missing');
    assert(result.analysis.commandValidity === 'VALID', `unexpected validity: ${result.analysis.commandValidity}`);
    assert(result.analysis.composite.bbScore === 53, `unexpected score: ${result.analysis.composite.bbScore}`);
    assert(result.analysis.counterCase[0].text === 'The treasury narrative is still self-reported and may not transmit to price.', 'strongest counter mismatch');
    assert(Array.isArray(result.analysis.highestImpactFixes) && result.analysis.highestImpactFixes.length === 3, 'highest-impact fixes missing');
    assert(typeof result.gist?.markdown === 'string' && result.gist.markdown.length > 0, 'gist markdown missing');
    assert(result.gist.markdown.includes('## Bullish/Bearish/Range Thesis Score Report (v2.0.1)'), 'gist markdown missing report title');
    assert(result.gist.markdown.includes('### 3. Verification Records'), 'gist markdown missing verification section');
    assert(result.gist.markdown.includes('### 11. Highest-Impact Fixes'), 'gist markdown missing fixes section');
    assert(typeof result.gist.oneLineSummary === 'string' && result.gist.oneLineSummary.includes('PFT: 53/100 Developing | BULLISH'), 'one-line summary missing expected content');
  });
}

runAll().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
