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
      if (msg.content.length === 0) continue;

      // Include trade tickets posted by the bot
      const isTradeTicket = msg.author.bot && msg.content.includes('TRADE TICKET');

      if (msg.author.bot && !isTradeTicket) continue;
      if (msg.interaction && !isTradeTicket) continue; // skip slash command invocations

      // Strip leading ! so prefix-chat messages read cleanly as journal entries
      const content = msg.content.startsWith('!') ? msg.content.slice(1).trim() : msg.content;
      if (content.length === 0) continue;

      entries.push({
        author: msg.author.username,
        authorId: msg.author.id,
        content,
        timestamp: msg.createdAt,
        wordCount: content.split(/\s+/).filter(Boolean).length,
        charCount: content.length,
      });
    }

    lastId = messages.last().id;
    fetched += messages.size;
    if (messages.size < batchSize) break;
  }

  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

module.exports = { fetchJournalEntries };
