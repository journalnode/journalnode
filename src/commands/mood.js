const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Emotional Temperature** analysis.

Analyze the emotional arc of the journal entries over time. Your analysis should include:
- Track fear/doubt language vs confidence/conviction language across entries
- Identify crisis periods and peak confidence moments
- Show the overall emotional trajectory (improving, declining, volatile, stable)
- Highlight specific entries that mark emotional turning points
- Give a current "emotional temperature" reading

Be empathetic but honest. Use plain text formatting suitable for Discord.`;

module.exports = {
  name: 'mood',
  description: 'Emotional temperature — fear/doubt vs confidence over time.',
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
