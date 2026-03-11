/**
 * B.O.B. Thesis Detection — reusable module for identifying and extracting
 * B.O.B. (jollyadvisorbot) thesis messages from Discord channel history.
 */

const BOB_USERNAME = 'jollyadvisorbot';

/**
 * Extract readable text from a Discord message (plain content or embeds).
 * Returns null if the message has no substantial text (>200 chars).
 */
function getBobText(msg) {
  if (msg.content && msg.content.length > 200) return msg.content;
  if (msg.embeds?.length > 0) {
    for (const embed of msg.embeds) {
      const text = [
        embed.title,
        embed.description,
        ...(embed.fields || []).map(f => `${f.name}\n${f.value}`),
      ]
        .filter(Boolean)
        .join('\n');
      if (text.length > 200) return text;
    }
  }
  return null;
}

/**
 * Find the most recent B.O.B. thesis message in a channel.
 * Scans last 100 messages.
 * @returns {{ message, text }|null}
 */
async function findLatestBobThesis(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  for (const [, msg] of messages) {
    if (msg.author.username !== BOB_USERNAME) continue;
    const text = getBobText(msg);
    if (!text) continue;
    if (!/thesis/i.test(text)) continue;
    return { message: msg, text };
  }
  return null;
}

/**
 * Fetch all B.O.B. thesis messages within a date range.
 * Scans channel history in batches (up to 500 messages).
 */
async function findBobThesesInRange(channel, startDate, endDate) {
  const theses = [];
  let lastId = null;
  const maxBatches = 5;

  for (let i = 0; i < maxBatches; i++) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    for (const [, msg] of messages) {
      if (msg.createdAt < startDate) return theses;
      if (msg.author.username !== BOB_USERNAME) continue;
      if (msg.createdAt > endDate) continue;

      const text = getBobText(msg);
      if (!text) continue;
      if (!/thesis/i.test(text)) continue;

      theses.push({ message: msg, text });
    }

    lastId = messages.last()?.id;
    if (!lastId) break;
  }

  return theses;
}

module.exports = {
  BOB_USERNAME,
  getBobText,
  findLatestBobThesis,
  findBobThesesInRange,
};
