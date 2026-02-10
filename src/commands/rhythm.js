const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Writing Rhythm** analysis.

Analyze WHEN the user writes based on the timestamps of their journal entries. Your analysis should include:
- What times of day they tend to write (morning, afternoon, evening, night)
- Which days of the week are most active
- Any notable patterns (e.g. "You're a 5 AM thinker" or "You process at night")
- A simple text-based dot plot showing entry times across dates if there's enough data

Keep your response concise and insightful. Use plain text formatting suitable for Discord (no markdown headers, use **bold** and line breaks).`;

module.exports = {
  name: 'rhythm',
  description: 'When do you write? Analyzes your writing times and patterns.',
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
