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
  description: 'Emotional temperature — tracks fear/doubt vs confidence/conviction over time.',
  async execute(message, entries) {
    if (entries.length === 0) {
      return message.reply('No journal entries found to analyze.');
    }
    const stats = summarizeStats(entries);
    const formatted = formatEntries(entries);
    const userMsg = `Here is a summary of the journal:\n${stats}\n\nHere are the journal entries:\n\n${formatted}`;
    const reply = await chat(SYSTEM_PROMPT, userMsg);
    await sendLong(message, reply);
  },
};
