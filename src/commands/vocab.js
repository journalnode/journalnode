const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Vocabulary Expansion** analysis.

Analyze the sophistication and evolution of the user's language. Your analysis should include:
- Estimate of unique vocabulary size
- Whether vocabulary diversity is increasing, stable, or declining over time
- Notable new or unusual words that appeared in recent entries
- Average word length trend (as a proxy for complexity)
- Most frequently used words (excluding common stop words)
- Comparison between early and recent entries in terms of language sophistication
- Any notable verbal habits or crutch words

Be specific and encouraging. Use plain text formatting suitable for Discord.`;

module.exports = {
  name: 'vocab',
  description: 'Is your thinking evolving? Tracks vocabulary diversity and complexity.',
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
