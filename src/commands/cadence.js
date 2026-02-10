const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Entry Cadence** analysis.

Analyze HOW CONSISTENTLY the user writes based on timestamps. Your analysis should include:
- Average days between entries
- Current writing streak (consecutive days or near-consecutive)
- Longest streak
- Any notable gaps
- A text-based calendar/heatmap representation if there's enough data (like a GitHub contribution graph using characters)
- Overall consistency rating

Keep your response concise and insightful. Use plain text formatting suitable for Discord.`;

module.exports = {
  name: 'cadence',
  description: 'How consistent are you? Shows streaks, gaps, and writing frequency.',
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
