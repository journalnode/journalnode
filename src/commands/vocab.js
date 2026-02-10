const { chat } = require('../openrouter');
const { vocabByMonth, avgWordLength, topWords } = require('../stats');
const { renderChart, lineChart } = require('../charts');
const { sendCharts, sendLong, formatEntries } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Vocabulary Expansion** analysis.

You will receive computed vocabulary data plus their most frequently used words and recent entries. Analyze:
- Whether vocabulary diversity is increasing, stable, or declining
- What the top words reveal about their preoccupations
- Any notable evolution in language sophistication
- One specific observation about their writing style

Keep it concise — one focused paragraph.`;

module.exports = {
  name: 'vocab',
  description: 'Is your thinking evolving? Charts vocabulary diversity over time.',
  async execute(interaction, entries) {
    if (entries.length === 0) return interaction.editReply('No journal entries found to analyze.');

    const byMonth = vocabByMonth(entries);
    const avgLen = avgWordLength(entries);
    const top = topWords(entries, 15);

    const chart = await renderChart(
      lineChart('Unique Words per Month (excluding stop words)', Object.keys(byMonth), Object.values(byMonth))
    );

    await sendCharts(interaction, [chart]);

    const topFormatted = top.map(([w, c]) => `${w} (${c})`).join(', ');
    const dataContext = `Unique words per month: ${JSON.stringify(byMonth)}\nAverage word length: ${avgLen} chars\nTop 15 words: ${topFormatted}\nTotal entries: ${entries.length}\n\nRecent entries for context:\n${formatEntries(entries, 20)}`;
    const narrative = await chat(SYSTEM_PROMPT, dataContext);
    await sendLong(interaction, narrative);
  },
};
