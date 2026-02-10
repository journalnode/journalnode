const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an AI that lives inside the user's journal. The user is asking for a general insight — a holistic read of their journal.

Provide a thoughtful, honest, and concise analysis. Touch on whatever stands out most:
- Overall emotional arc
- Key themes and preoccupations
- Patterns the user might not see themselves
- One concrete observation and one open question to reflect on

Speak directly to the user. Be real, not generic. Use plain text formatting suitable for Discord.`;

module.exports = {
  name: 'insight',
  description: 'General AI-powered holistic analysis of your journal.',
  async execute(interaction, entries) {
    if (entries.length === 0) {
      return interaction.editReply('No journal entries found to analyze.');
    }
    const stats = summarizeStats(entries);
    const formatted = formatEntries(entries);
    const userMsg = `Here is a summary of the journal:\n${stats}\n\nHere are the journal entries:\n\n${formatted}`;
    const reply = await chat(SYSTEM_PROMPT, userMsg);
    await interaction.editReply(reply.slice(0, 2000));
    if (reply.length > 2000) await sendLong(interaction, reply.slice(2000));
  },
};
