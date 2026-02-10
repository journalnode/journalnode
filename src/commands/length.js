const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Entry Length Trends** analysis.

Analyze how much the user is writing over time. Your analysis should include:
- Word count trend over time (increasing, decreasing, stable)
- Shortest and longest entries (with dates)
- Average word count and how it's changed
- A text-based scatter/trend visualization if there's enough data
- Percentage change in entry length since they started
- Distribution insights (are entries mostly short, mostly long, or varied?)

Keep your response concise and data-driven. Use plain text formatting suitable for Discord.`;

module.exports = {
  name: 'length',
  description: 'How much are you writing? Word count trends and distribution.',
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
