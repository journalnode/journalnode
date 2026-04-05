const { SlashCommandBuilder } = require('discord.js');
const {
  AUDIT_MODELS,
  createPublicAuditGist,
  getAuditGistToken,
  runValidatorAudit,
  validatePublicUrl,
} = require('../audit');

function buildCommand() {
  return new SlashCommandBuilder()
    .setName('audit')
    .setDescription('Run the canonical validator-page audit and publish the report as a public gist.')
    .addStringOption(opt =>
      opt.setName('url')
        .setDescription('A public validator webpage URL to audit')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('model')
        .setDescription('Which LLM should run the audit')
        .setRequired(true)
        .addChoices(...AUDIT_MODELS.map(model => ({ name: model.name, value: model.id })))
    );
}

module.exports = {
  name: 'audit',
  description: 'Audit one public validator webpage and publish the report to a public GitHub gist.',
  needsEntries: false,
  publicReply: true,
  buildCommand,
  async execute(interaction) {
    const rawUrl = interaction.options.getString('url', true).trim();
    const modelId = interaction.options.getString('model', true);
    const validation = validatePublicUrl(rawUrl);

    if (!validation.ok) {
      await interaction.editReply({ content: `Audit failed: ${validation.error}` });
      return;
    }

    if (!getAuditGistToken()) {
      await interaction.editReply({
        content: 'Audit failed: GitHub gist publishing is not configured. Set `GITHUB_GIST_TOKEN` (preferred) or `GITHUB_TOKEN` with gist-write access for the journalnode account.',
      });
      return;
    }

    try {
      const audit = await runValidatorAudit({
        url: validation.normalizedUrl,
        modelId,
      });

      const gist = await createPublicAuditGist({
        pageUrl: audit.page.finalUrl,
        modelId,
        report: audit.report,
      });

      const redirectLine = audit.page.finalUrl !== validation.normalizedUrl
        ? `Resolved URL: ${audit.page.finalUrl}\n`
        : '';

      await interaction.editReply({
        content: [
          `Audit complete for ${validation.normalizedUrl}`,
          redirectLine.trim(),
          `Model: ${audit.model.name} (${audit.model.id})`,
          `Public gist: ${gist.htmlUrl}`,
        ].filter(Boolean).join('\n'),
      });
    } catch (err) {
      console.error('[/audit] Command failed:', err);
      await interaction.editReply({
        content: `Audit failed: ${err.message || 'Unknown error.'}`,
      });
    }
  },
};
