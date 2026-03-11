/**
 * Dynamic self-awareness: extracts the bot's registered slash commands
 * and formats them into a concise string for LLM system-prompt injection.
 *
 * This ensures the chat LLM always knows about every shipped command
 * without manual prompt updates.
 */

/**
 * Build a human-readable capabilities block from the Discord slash-command
 * JSON array (the same objects pushed to the REST API).
 *
 * @param {object[]} slashCommands – array of SlashCommandBuilder#toJSON() results
 * @returns {string} formatted capabilities block for the system prompt
 */
function buildCapabilities(slashCommands) {
  if (!slashCommands || slashCommands.length === 0) return '';

  const lines = slashCommands.map(cmd => {
    let entry = `/${cmd.name} — ${cmd.description}`;

    // Top-level options (non-subcommand)
    const opts = (cmd.options || []).filter(o => o.type !== 1); // type 1 = SUB_COMMAND
    if (opts.length > 0) {
      const optParts = opts.map(o => {
        const req = o.required ? '' : '?';
        let desc = o.name + req;
        // Include choices if defined (e.g. direction: Long|Short)
        if (o.choices && o.choices.length > 0) {
          desc += ` (${o.choices.map(c => c.name).join('|')})`;
        }
        return desc;
      });
      entry += `  [${optParts.join(', ')}]`;
    }

    // Subcommands
    const subs = (cmd.options || []).filter(o => o.type === 1);
    if (subs.length > 0) {
      const subParts = subs.map(s => {
        const subOpts = (s.options || []).filter(o => o.type !== 1);
        const inner = subOpts.length > 0
          ? ` (${subOpts.map(o => o.name + (o.required ? '' : '?')).join(', ')})`
          : '';
        return `${s.name}${inner}`;
      });
      entry += `  subcommands: ${subParts.join(', ')}`;
    }

    return `• ${entry}`;
  });

  // Also note the prefix chat interface
  lines.push('• ! <message> — Prefix chat (same as /chat but via message prefix)');

  return `REGISTERED COMMANDS (${slashCommands.length} slash commands + prefix chat):\n${lines.join('\n')}`;
}

module.exports = { buildCapabilities };
