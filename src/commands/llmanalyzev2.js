const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');

const {
  runBullBearMode,
  runMultiValuationMode,
  runStressTestMode,
  runVisionPipelineMode,
} = require('../llmAnalysisV2');
const { getGitHubGistToken } = require('../githubGist');
const { sendBullBearGistResult } = require('./bullishbearishShared');

const SESSION_TTL_MS = 1000 * 60 * 60 * 6;
const sessions = new Map();

const MODE_LABELS = {
  bullbear: 'Bullish/Bearish',
  multivaluation: 'Multi-Valuation',
  stresstest: 'Stress Test',
  visionpipeline: 'Vision Pipeline',
};

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

function truncate(value, max = 500) {
  if (!value || value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function createSessionId(interaction) {
  return `${interaction.id.slice(-8)}${Date.now().toString(36).slice(-4)}`;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
    }
  }
}

function buildCommand() {
  return new SlashCommandBuilder()
    .setName('llmanalyzev2')
    .setDescription('Beta four-mode crypto thesis analyzer aligned to the v2 whitepaper.')
    .addStringOption(opt =>
      opt.setName('asset')
        .setDescription('Asset symbol or name, e.g. BTC, ETH, PFT')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('direction')
        .setDescription('Thesis direction for Bullish/Bearish mode')
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
    )
    .addAttachmentOption(opt =>
      opt.setName('chart_image')
        .setDescription('Optional chart screenshot for Vision Pipeline mode')
        .setRequired(false)
    );
}

function buildButtons(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`llmv2:${sessionId}:bullbear`)
      .setLabel('Bullish/Bearish')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`llmv2:${sessionId}:multivaluation`)
      .setLabel('Multi-Valuation')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`llmv2:${sessionId}:stresstest`)
      .setLabel('Stress Test')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`llmv2:${sessionId}:visionpipeline`)
      .setLabel('Vision Pipeline')
      .setStyle(ButtonStyle.Success)
  );
}

function summarizeRequest(request) {
  const parts = [
    `**Asset** ${truncate(request.asset, 120)}`,
    `**Direction** ${request.direction || 'Not provided'}`,
    `**Thesis** ${truncate(request.thesis, 900)}`,
  ];
  if (request.timeframe) parts.push(`**Time Horizon** ${request.timeframe}`);
  if (typeof request.rangeLower === 'number' || typeof request.rangeUpper === 'number') {
    parts.push(`**Range** ${typeof request.rangeLower === 'number' ? request.rangeLower : 'n/a'} -> ${typeof request.rangeUpper === 'number' ? request.rangeUpper : 'n/a'}`);
  }
  if (typeof request.currentPrice === 'number') parts.push(`**Current Price** ${request.currentPrice}`);
  if (typeof request.marketCap === 'number') parts.push(`**Market Cap** ${request.marketCap}`);
  if (request.invalidation) parts.push(`**Invalidation** ${truncate(request.invalidation, 300)}`);
  if (request.catalyst) parts.push(`**Catalyst** ${truncate(request.catalyst, 300)}`);
  if (request.supportingData) parts.push(`**Supporting Data** ${truncate(request.supportingData, 1200)}`);
  parts.push(`**Vision Input** ${request.chartImageUrl ? 'Chart attached' : 'No chart attached'}`);
  return parts.join('\n');
}

function chunkText(text, size = 1900) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > size) {
    let cut = remaining.lastIndexOf('\n', size);
    if (cut <= 0) cut = size;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendModeResult(interaction, modeName, result) {
  const chunks = chunkText(result.description);
  const embed = new EmbedBuilder()
    .setColor(0x0f766e)
    .setTitle(`${result.title} | beta`)
    .setDescription(chunks[0])
    .setFooter({ text: `llmanalyzev2 | ${modeName}` });

  const files = [];
  if (chunks.length > 1) {
    files.push(new AttachmentBuilder(
      Buffer.from(chunks.slice(1).join('\n\n'), 'utf8'),
      { name: 'llmanalyzev2-output.txt' }
    ));
  }

  await interaction.editReply({ embeds: [embed], files });
}

module.exports = {
  name: 'llmanalyzev2',
  description: 'Beta four-mode crypto thesis analyzer with button-driven v2 outputs.',
  needsEntries: false,
  publicReply: true,
  buildCommand,
  async execute(interaction) {
    cleanupSessions();

    const chart = interaction.options.getAttachment('chart_image');
    const sessionId = createSessionId(interaction);
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
      chartImageUrl: chart?.url || null,
      createdAt: Date.now(),
      ownerId: interaction.user.id,
    };

    request.direction = request.direction || inferDirection(request);

    if (!request.direction) {
      await interaction.editReply({
        content: 'llmanalyzev2 failed: missing `direction`. Re-run with `BULLISH`, `BEARISH`, or `RANGE` after the slash-command options refresh.',
      });
      return;
    }

    if (!request.timeframe) {
      await interaction.editReply({
        content: 'llmanalyzev2 failed: missing `time_horizon`. Re-run with a timeframe like `7 days`, `30 days`, or `Q3 2026`.',
      });
      return;
    }

    if (request.direction === 'RANGE' && (!Number.isFinite(request.rangeLower) || !Number.isFinite(request.rangeUpper))) {
      await interaction.editReply({
        content: 'Range theses require both `range_lower` and `range_upper` before launching llmanalyzev2.',
      });
      return;
    }

    sessions.set(sessionId, request);

    const embed = new EmbedBuilder()
      .setColor(0x1d4ed8)
      .setTitle('/llmanalyzev2')
      .setDescription([
        'Beta command for the updated four-mode LLM optimization workflow.',
        '',
        summarizeRequest(request),
        '',
        'Choose a mode button below to run the corresponding v2 analysis.',
      ].join('\n'))
      .setFooter({ text: 'Modes: Bullish/Bearish | Multi-Valuation | Stress Test | Vision Pipeline' });

    await interaction.editReply({
      embeds: [embed],
      components: [buildButtons(sessionId)],
    });
  },
  isButtonInteraction(interaction) {
    return interaction.isButton() && interaction.customId.startsWith('llmv2:');
  },
  async handleButton(interaction) {
    cleanupSessions();

    const [, sessionId, mode] = interaction.customId.split(':');
    const request = sessions.get(sessionId);

    if (!request) {
      await interaction.reply({
        content: 'That llmanalyzev2 session has expired. Run the command again to create a fresh beta session.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.user.id !== request.ownerId) {
      await interaction.reply({
        content: 'Only the user who created this llmanalyzev2 session can run its mode buttons.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    let result;
    if (mode === 'bullbear') {
      if (!getGitHubGistToken()) {
        await interaction.editReply({
          content: 'Bullish/Bearish failed: GitHub gist publishing is not configured. Set `GITHUB_GIST_TOKEN` (preferred) or `GITHUB_TOKEN` with gist-write access for the journalnode account.',
        });
        return;
      }
      result = await runBullBearMode(request);
      await sendBullBearGistResult(interaction, request, result, {
        commandName: 'llmanalyzev2',
        footerLabel: 'llmanalyzev2 | Bullish/Bearish',
        userAgent: 'JournalNodeLlmAnalyzeV2/0.1',
      });
      return;
    }
    else if (mode === 'multivaluation') result = await runMultiValuationMode(request);
    else if (mode === 'stresstest') result = await runStressTestMode(request);
    else if (mode === 'visionpipeline') result = await runVisionPipelineMode(request);
    else throw new Error(`Unknown llmanalyzev2 mode: ${mode}`);

    await sendModeResult(interaction, MODE_LABELS[mode] || mode, result);
  },
};
