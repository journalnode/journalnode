const { chat } = require('../openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./helpers');
const { timeframeLabel } = require('../timeframe');

const SYSTEM_PROMPT = `You are Journal Node, an AI that lives inside the user's journal. You have read all of their journal entries and know their story intimately.

The user is having a conversation with you. They might:
- Ask for advice grounded in their own patterns and history
- Want to talk through an idea or decision
- Ask you to reflect on a specific event or period
- Seek encouragement or honest feedback

Rules:
- Ground your responses in their actual journal entries — reference specific things they wrote when relevant
- Be direct and honest, not generic or motivational-poster-like
- Speak like a trusted friend who has read everything, not a therapist
- Keep responses concise but substantive

Use plain text formatting suitable for Discord.`;

module.exports = {
  name: 'chat',
  description: 'Talk to your journal — ask questions, get advice, explore ideas.',
  async execute(interaction, entries) {
    const userMessage = interaction.options.getString('message');
    const timeframe = interaction.options.getString('timeframe');
    const tfLabel = timeframeLabel(timeframe);

    if (entries.length === 0) {
      return interaction.editReply(`No journal entries found for ${tfLabel}. Write some entries first, then come back.`);
    }

    const stats = summarizeStats(entries);
    const formatted = formatEntries(entries);
    const context = `Context window: ${tfLabel}\nJournal summary: ${stats}\n\nJournal entries:\n\n${formatted}\n\n---\nUser's message: ${userMessage}`;
    const reply = await chat(SYSTEM_PROMPT, context);
    await interaction.editReply(reply.slice(0, 2000));
    if (reply.length > 2000) await sendLong(interaction, reply.slice(2000));
  },
};
