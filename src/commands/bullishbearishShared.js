const { EmbedBuilder } = require('discord.js');

const { createPublicGist, slugify } = require('../githubGist');

async function sendBullBearGistResult(interaction, request, result, options = {}) {
  const {
    commandName = 'bullishbearish',
    footerLabel = 'bullishbearish | standalone',
    userAgent = 'JournalNodeBullishBearish/0.1',
  } = options;

  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `${slugify(commandName, 'bullishbearish')}-${slugify(request.asset, 'asset')}-${dateStamp}.md`;
  const gist = await createPublicGist({
    description: `Bullish/Bearish thesis report for ${request.asset} via /${commandName}`,
    fileName,
    content: result.gist.markdown,
    userAgent,
  });

  const embed = new EmbedBuilder()
    .setColor(0x0f766e)
    .setTitle(`${result.title} | ${commandName === 'bullishbearish' ? 'standalone' : 'beta'}`)
    .setDescription([
      result.gist.oneLineSummary,
      '',
      `Public gist: ${gist.htmlUrl}`,
    ].join('\n'))
    .setFooter({ text: footerLabel });

  await interaction.editReply({
    content: `Public gist: ${gist.htmlUrl}`,
    embeds: [embed],
    files: [],
  });
}

module.exports = {
  sendBullBearGistResult,
};
