const { SlashCommandBuilder } = require('discord.js');

const { runBullBearMode } = require('../llmAnalysisV2');
const { getGitHubGistToken } = require('../githubGist');
const { sendBullBearGistResult } = require('./bullishbearishShared');

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function inferDirection(request) {
  const haystack = [
    request.thesis,
    request.supportingData,
    request.catalyst,
    request.consensusBlock,
  ].filter(Boolean).join(' ').toUpperCase();

  if (Number.isFinite(request.rangeLower) && Number.isFinite(request.rangeUpper)) return 'RANGE';
  if (/\bRANGE\b|\bRANGEBOUND\b|\bSIDEWAYS\b/.test(haystack)) return 'RANGE';
  if (/\bBEARISH\b|\bSHORT\b|\bDOWNSIDE\b/.test(haystack)) return 'BEARISH';
  if (/\bBULLISH\b|\bLONG\b|\bUPSIDE\b/.test(haystack)) return 'BULLISH';
  return null;
}

function buildCommand() {
  return new SlashCommandBuilder()
    .setName('bullishbearish')
    .setDescription('Standalone bullish/bearish/range thesis scoring that returns a public gist report.')
    .addStringOption(opt =>
      opt.setName('asset')
        .setDescription('Asset symbol or name, e.g. BTC, ETH, PFT')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('direction')
        .setDescription('Thesis direction')
        .setRequired(true)
        .addChoices(
          { name: 'BULLISH', value: 'BULLISH' },
          { name: 'BEARISH', value: 'BEARISH' },
          { name: 'RANGE', value: 'RANGE' },
        )
    )
    .addStringOption(opt =>
      opt.setName('thesis')
        .setDescription('Your trade thesis or setup in plain language')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('time_horizon')
        .setDescription('Time window or catalyst horizon')
        .setRequired(true)
    )
    .addNumberOption(opt =>
      opt.setName('range_lower')
        .setDescription('Required when direction is RANGE')
        .setRequired(false)
    )
    .addNumberOption(opt =>
      opt.setName('range_upper')
        .setDescription('Required when direction is RANGE')
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
    )
    .addStringOption(opt =>
      opt.setName('invalidation')
        .setDescription('What would make this thesis wrong')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('catalyst')
        .setDescription('Primary catalyst or catalyst window')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('author_counter_case')
        .setDescription('Optional explicit counter-case authored by the user')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('consensus_block')
        .setDescription('Optional consensus positioning or sentiment block')
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
      direction: normalizeOptionalString(interaction.options.getString('direction'))?.toUpperCase() || null,
      thesis: interaction.options.getString('thesis', true).trim(),
      timeframe: normalizeOptionalString(interaction.options.getString('time_horizon')),
      rangeLower: interaction.options.getNumber('range_lower'),
      rangeUpper: interaction.options.getNumber('range_upper'),
      currentPrice: interaction.options.getNumber('current_price'),
      marketCap: interaction.options.getNumber('market_cap'),
      supportingData: normalizeOptionalString(interaction.options.getString('supporting_data')),
      invalidation: normalizeOptionalString(interaction.options.getString('invalidation')),
      catalyst: normalizeOptionalString(interaction.options.getString('catalyst')),
      authorCounterCase: normalizeOptionalString(interaction.options.getString('author_counter_case')),
      consensusBlock: normalizeOptionalString(interaction.options.getString('consensus_block')),
      chartImageUrl: null,
      createdAt: Date.now(),
      ownerId: interaction.user.id,
    };

    request.direction = request.direction || inferDirection(request);

    if (!request.direction) {
      await interaction.editReply({
        content: 'Bullish/Bearish failed: missing `direction`. Re-run the command with `BULLISH`, `BEARISH`, or `RANGE`. If Discord is still showing the old command form, wait for slash-command refresh or restart the bot so the new options register.',
      });
      return;
    }

    if (!request.timeframe) {
      await interaction.editReply({
        content: 'Bullish/Bearish failed: missing `time_horizon`. Re-run the command with a timeframe like `7 days`, `30 days`, or `Q3 2026`.',
      });
      return;
    }

    if (request.direction === 'RANGE' && (!Number.isFinite(request.rangeLower) || !Number.isFinite(request.rangeUpper))) {
      await interaction.editReply({
        content: 'Bullish/Bearish failed: RANGE theses require both `range_lower` and `range_upper`.',
      });
      return;
    }

    const result = await runBullBearMode(request);
    await sendBullBearGistResult(interaction, request, result, {
      commandName: 'bullishbearish',
      footerLabel: 'bullishbearish | standalone',
      userAgent: 'JournalNodeBullishBearish/0.1',
    });
  },
};
