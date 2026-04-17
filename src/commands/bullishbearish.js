const { SlashCommandBuilder } = require('discord.js');

const { runBullBearMode } = require('../llmAnalysisV2');
const { getGitHubGistToken } = require('../githubGist');
const { sendBullBearGistResult } = require('./bullishbearishShared');

function buildCommand() {
  return new SlashCommandBuilder()
    .setName('bullishbearish')
    .setDescription('Standalone bullish/bearish thesis analysis that returns a public gist report.')
    .addStringOption(opt =>
      opt.setName('asset')
        .setDescription('Asset symbol or name, e.g. BTC, ETH, PFT')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('thesis')
        .setDescription('Your trade thesis or setup in plain language')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('time_horizon')
        .setDescription('Time window or catalyst horizon')
        .setRequired(false)
    )
    .addNumberOption(opt =>
      opt.setName('current_price')
        .setDescription('Current asset price, if known')
        .setRequired(false)
    )
    .addNumberOption(opt =>
      opt.setName('market_cap')
        .setDescription('Current market cap in USD, if known')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('supporting_data')
        .setDescription('Optional metrics, peer comps, catalysts, or key facts')
        .setRequired(false)
    );
}

module.exports = {
  name: 'bullishbearish',
  description: 'Standalone bullish/bearish thesis analysis with public gist output.',
  needsEntries: false,
  publicReply: true,
  buildCommand,
  async execute(interaction) {
    if (!getGitHubGistToken()) {
      await interaction.editReply({
        content: 'Bullish/Bearish failed: GitHub gist publishing is not configured. Set `GITHUB_GIST_TOKEN` (preferred) or `GITHUB_TOKEN` with gist-write access for the journalnode account.',
      });
      return;
    }

    const request = {
      asset: interaction.options.getString('asset', true).trim(),
      thesis: interaction.options.getString('thesis', true).trim(),
      timeframe: interaction.options.getString('time_horizon'),
      currentPrice: interaction.options.getNumber('current_price'),
      marketCap: interaction.options.getNumber('market_cap'),
      supportingData: interaction.options.getString('supporting_data'),
      chartImageUrl: null,
      createdAt: Date.now(),
      ownerId: interaction.user.id,
    };

    const result = await runBullBearMode(request);
    await sendBullBearGistResult(interaction, request, result, {
      commandName: 'bullishbearish',
      footerLabel: 'bullishbearish | standalone',
      userAgent: 'JournalNodeBullishBearish/0.1',
    });
  },
};
