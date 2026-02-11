const { chat } = require('../openrouter');
const { wordCountOverTime, wordCountSummary, rollingAverage } = require('../stats');
const { renderChart, scatterWithLine } = require('../charts');
const { sendCharts, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Entry Length Trends** analysis.

You will receive computed word count statistics. Interpret the data and provide a concise narrative:
- Whether they're writing more or less over time
- What the distribution looks like (mostly short? variable? growing?)
- Their longest and shortest entry context
- One observation about what the trend might mean

Keep it to 3-5 sentences. Speak directly to the user.`;

module.exports = {
  name: 'length',
  description: 'How much are you writing? Charts word count trends over time.',
  async execute(interaction, entries) {
    if (entries.length === 0) return interaction.editReply('No journal entries found to analyze.');

    const overTime = wordCountOverTime(entries);
    const summary = wordCountSummary(entries);
    const rolling = rollingAverage(entries.map(e => e.wordCount));

    const scatterData = overTime.map(p => ({ x: p.dateLabel, y: p.wordCount }));

    const chart = await renderChart(scatterWithLine(
      `Entry Length Over Time (mean: ${summary.mean} words)`,
      scatterData,
      rolling,
      '10-entry rolling avg',
    ));

    await sendCharts(interaction, [chart]);

    const dataContext = `Total entries: ${summary.count}\nTotal words: ${summary.total}\nMean: ${summary.mean} words\nMedian: ${summary.median} words\nMin: ${summary.min} words\nMax: ${summary.max} words\nFirst entry word count: ${entries[0].wordCount}\nLast entry word count: ${entries[entries.length - 1].wordCount}`;
    const narrative = await chat(SYSTEM_PROMPT, dataContext);
    await sendLong(interaction, narrative);
  },
};
