const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Question Density** analysis.

Analyze how much the user interrogates themselves in their journal. Your analysis should include:
- Average number of questions per entry
- Entries with the most questions (with dates)
- Trend: are they asking more or fewer questions over time?
- Types of questions (rhetorical, self-reflective, planning, existential)
- Patterns: do they ask more questions on certain days or during certain emotional states?
- Insight: high question periods often correlate with uncertainty or growth

Be specific — quote actual questions from the entries when relevant. Use plain text formatting suitable for Discord.`;

module.exports = {
  name: 'questions',
  description: 'How much are you interrogating yourself? Tracks self-questioning patterns.',
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
