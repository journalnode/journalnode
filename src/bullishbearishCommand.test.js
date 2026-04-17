const llmAnalysisV2Path = require.resolve('./llmAnalysisV2');
require.cache[llmAnalysisV2Path] = {
  id: llmAnalysisV2Path,
  filename: llmAnalysisV2Path,
  loaded: true,
  exports: {
    runBullBearMode: async request => ({
      title: 'Bullish/Bearish v2',
      gist: {
        markdown: `# Report\n\nAsset: ${request.asset}`,
        oneLineSummary: `${request.asset}: Bullish | arbiter +42`,
      },
    }),
  },
};

const githubGistPath = require.resolve('./githubGist');
require.cache[githubGistPath] = {
  id: githubGistPath,
  filename: githubGistPath,
  loaded: true,
  exports: {
    getGitHubGistToken: () => 'test-token',
    slugify: value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report',
    createPublicGist: async ({ description, fileName, content, userAgent }) => ({
      htmlUrl: `https://gist.github.com/test/${encodeURIComponent(fileName)}`,
      id: 'gist-123',
      meta: { description, content, userAgent },
    }),
  },
};

const bullishBearishCmd = require('./commands/bullishbearish');

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

function buildInteraction() {
  const state = { edits: [] };
  return {
    user: { id: 'user-1' },
    options: {
      getString(name) {
        const map = {
          asset: 'PFT',
          thesis: 'Validator demand and treasury credibility can rerate the token.',
          time_horizon: '90 days',
          supporting_data: 'Revenue is improving and supply unlock pressure is easing.',
        };
        return map[name] ?? null;
      },
      getNumber(name) {
        const map = {
          current_price: 0.42,
          market_cap: 42000000,
        };
        return map[name] ?? null;
      },
    },
    async editReply(payload) {
      state.edits.push(payload);
    },
    __state: state,
  };
}

async function runAll() {
  console.log('\n=== BullishBearish Command Tests ===\n');

  await test('buildCommand registers slash command name', async () => {
    const json = bullishBearishCmd.buildCommand().toJSON();
    assert(json.name === 'bullishbearish', `unexpected command name: ${json.name}`);
    assert(json.options.some(opt => opt.name === 'thesis'), 'thesis option missing');
  });

  await test('execute runs bull/bear report and returns public gist link', async () => {
    const interaction = buildInteraction();
    await bullishBearishCmd.execute(interaction);

    assert(interaction.__state.edits.length === 1, 'expected one editReply call');
    const payload = interaction.__state.edits[0];
    assert(typeof payload.content === 'string' && payload.content.includes('https://gist.github.com/test/'), 'gist url missing from content');
    assert(Array.isArray(payload.embeds) && payload.embeds.length === 1, 'expected one embed');
  });
}

runAll().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
