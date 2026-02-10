const { chat } = require('../openrouter');
const { entriesByDayOfWeek, entriesByTimeSlot } = require('../stats');
const { renderChart, barChart, ORANGE } = require('../charts');
const { sendCharts, sendLong } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Writing Rhythm** analysis.

You will receive computed data about WHEN the user writes. Interpret the data and provide a concise narrative:
- What patterns stand out (e.g. "You're a morning writer" or "Fridays are your peak day")
- Any surprising gaps or spikes
- One actionable observation

Keep it to 3-5 sentences. Speak directly to the user. No headers or bullet points — just a clean paragraph.`;

module.exports = {
  name: 'rhythm',
  description: 'When do you write? Analyzes your writing times and patterns.',
  async execute(message, entries) {
    if (entries.length === 0) return message.reply('No journal entries found to analyze.');

    const byDay = entriesByDayOfWeek(entries);
    const byTime = entriesByTimeSlot(entries);

    const [chart1, chart2] = await Promise.all([
      renderChart(barChart('Entries by Day of Week', Object.keys(byDay), Object.values(byDay))),
      renderChart(barChart('Entries by Time of Day', Object.keys(byTime), Object.values(byTime), ORANGE)),
    ]);

    await sendCharts(message, [chart1, chart2]);

    const dataContext = `Entries by Day of Week: ${JSON.stringify(byDay)}\nEntries by Time of Day: ${JSON.stringify(byTime)}\nTotal entries: ${entries.length}`;
    const narrative = await chat(SYSTEM_PROMPT, dataContext);
    await sendLong(message, narrative);
  },
};
