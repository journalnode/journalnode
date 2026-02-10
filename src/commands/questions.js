const { chat } = require('../openrouter');
const { questionsPerMonth, totalQuestions } = require('../stats');
const { renderChart, barChart, TEAL } = require('../charts');
const { sendCharts, sendLong, formatEntries } = require('./helpers');

const SYSTEM_PROMPT = `You are Journal Node, an analytical journaling assistant. The user is asking for their **Question Density** analysis.

You will receive computed data about how many questions the user asks per entry, plus recent journal entries for context. Analyze:
- Trend: are they asking more or fewer questions over time?
- What the questions tend to be about (self-reflective, planning, existential, rhetorical)
- High-question periods often correlate with uncertainty or growth — note any patterns
- Quote 1-2 standout questions from the entries if any are particularly revealing

Keep it concise — a short paragraph plus 1-2 quoted questions.`;

module.exports = {
  name: 'questions',
  description: 'Self-questioning patterns — charts questions per entry over time.',
  async execute(interaction, entries) {
    if (entries.length === 0) return interaction.editReply('No journal entries found to analyze.');

    const perMonth = questionsPerMonth(entries);
    const total = totalQuestions(entries);

    const chart = await renderChart(
      barChart('Average Questions per Entry by Month', Object.keys(perMonth), Object.values(perMonth), TEAL)
    );

    await sendCharts(interaction, [chart]);

    const dataContext = `Avg questions per entry by month: ${JSON.stringify(perMonth)}\nTotal question marks across all entries: ${total}\nTotal entries: ${entries.length}\n\nRecent entries for context:\n${formatEntries(entries, 30)}`;
    const narrative = await chat(SYSTEM_PROMPT, dataContext);
    await sendLong(interaction, narrative);
  },
};
