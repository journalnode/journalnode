const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Temporal Focus** analysis.

Analyze whether the user's journal entries are past-focused, present-focused, or future-focused. Your analysis should include:
- Percentage breakdown: past / present / future focus
- Track regret/nostalgia/past language vs present-moment language vs aspiration/planning/future language
- Identify if the user is primarily ruminating, grounded, or planning
- Show how the temporal focus has shifted over time
- Flag any concerning patterns (excessive rumination, avoidance of present, etc.)

Be insightful and constructive. Use plain text formatting suitable for Discord.`;

module.exports = {
  name: 'focus',
  description: 'Past, present, or future? Analyzes temporal orientation.',
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
