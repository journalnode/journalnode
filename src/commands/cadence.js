const { chat } = require('../openrouter');
const { entriesByMonth, computeStreaks, cumulativeEntries } = require('../stats');
const { renderChart, barChart, areaChart, TEAL } = require('../charts');
const { sendCharts, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Entry Cadence** analysis.

You will receive computed data about writing consistency. Interpret the data and provide a concise narrative:
- Their current streak and how it compares to their best
- Whether their output is increasing, declining, or steady
- Any notable gaps or surges
- One encouraging or constructive observation

Keep it to 3-5 sentences. Speak directly to the user.`;

module.exports = {
  name: 'cadence',
  description: 'How consistent are you? Charts for streaks, gaps, and monthly frequency.',
  async execute(interaction, entries) {
    if (entries.length === 0) return interaction.editReply('No journal entries found to analyze.');

    const byMonth = entriesByMonth(entries);
    const streaks = computeStreaks(entries);
    const cumulative = cumulativeEntries(entries);

    const [chart1, chart2] = await Promise.all([
      renderChart(barChart('Entries Per Month', Object.keys(byMonth), Object.values(byMonth))),
      renderChart(areaChart(
        `Cumulative Entries Over Time (${entries.length} total)`,
        cumulative.map(c => c.date),
        cumulative.map(c => c.total),
        TEAL,
      )),
    ]);

    await sendCharts(interaction, [chart1, chart2]);

    const dataContext = `Entries by month: ${JSON.stringify(byMonth)}\nCurrent streak: ${streaks.current} days\nLongest streak: ${streaks.longest} days\nAvg days between entries: ${streaks.avgGap}\nTotal unique days with entries: ${streaks.totalDays}\nTotal entries: ${entries.length}`;
    const narrative = await chat(SYSTEM_PROMPT, dataContext);
    await sendLong(interaction, narrative);
  },
};
