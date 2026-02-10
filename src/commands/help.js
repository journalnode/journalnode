module.exports = {
  name: 'help',
  description: 'Show all available commands.',
  async execute(message, _entries, commands) {
    const lines = ['**Journal Node — Commands**\n'];
    for (const cmd of commands.values()) {
      lines.push(`\`!${cmd.name}\` — ${cmd.description}`);
    }
    lines.push('\nJust write normally to journal. Your messages are your entries — the bot reads them from channel history on demand.');
    await message.reply(lines.join('\n'));
  },
};
