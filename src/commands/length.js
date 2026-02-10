const { chat } = require('../openrouter');
const { wordCountOverTime, wordCountDistribution, wordCountSummary, rollingAverage } = require('../stats');
const { renderChart, scatterWithLine, histogram } = require('../charts');
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
  description: 'How much are you writing? Word count trends and distribution.',
  async execute(message, entries) {
    if (entries.length === 0) return message.reply('No journal entries found to analyze.');

    const overTime = wordCountOverTime(entries);
    const dist = wordCountDistribution(entries);
    const summary = wordCountSummary(entries);
    const rolling = rollingAverage(entries.map(e => e.wordCount));

    const scatterData = overTime.map(p => ({ x: p.dateLabel, y: p.wordCount }));

    const [chart1, chart2] = await Promise.all([
      renderChart(scatterWithLine(
        'Entry Length Over Time',
        scatterData,
        rolling,
        '10-entry rolling avg',
      )),
      renderChart(histogram(
        'Entry Length Distribution',
        dist.bins,
        dist.frequencies,
        summary.mean,
        dist.binSize,
      )),
    ]);

    await sendCharts(message, [chart1, chart2]);

    const dataContext = `Total entries: ${summary.count}\nTotal words: ${summary.total}\nMean: ${summary.mean} words\nMedian: ${summary.median} words\nMin: ${summary.min} words\nMax: ${summary.max} words\nFirst entry word count: ${entries[0].wordCount}\nLast entry word count: ${entries[entries.length - 1].wordCount}`;
    const narrative = await chat(SYSTEM_PROMPT, dataContext);
    await sendLong(message, narrative);
  },
};
