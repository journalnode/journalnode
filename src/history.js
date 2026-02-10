async function fetchJournalEntries(channel, botId, limit = 500) {
  const entries = [];
  let lastId = null;
  let fetched = 0;

  while (fetched < limit) {
    const batchSize = Math.min(100, limit - fetched);
    const options = { limit: batchSize };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    for (const msg of messages.values()) {
      if (msg.author.bot) continue;
      if (msg.content.length === 0) continue;
      if (msg.interaction) continue; // skip slash command invocations

      entries.push({
        author: msg.author.username,
        authorId: msg.author.id,
        content: msg.content,
        timestamp: msg.createdAt,
        wordCount: msg.content.split(/\s+/).filter(Boolean).length,
        charCount: msg.content.length,
      });
    }

    lastId = messages.last().id;
    fetched += messages.size;
    if (messages.size < batchSize) break;
  }

  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

module.exports = { fetchJournalEntries };
