const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Topic Evolution** analysis.

Analyze what subjects and themes dominate the journal over time. Your analysis should include:
- Identify the top recurring topics/themes (work, relationships, health, money, creativity, family, etc.)
- Show how topic prominence has shifted over time
- Detect any recent topic shifts (e.g. "In recent entries, 'health' overtook 'work' as your primary focus")
- Note topics that have appeared and disappeared
- Identify any topics that are conspicuously absent

Be observant and specific. Use plain text formatting suitable for Discord.`;

module.exports = {
  name: 'topics',
  description: 'What\'s on your mind? Tracks theme and topic evolution.',
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
