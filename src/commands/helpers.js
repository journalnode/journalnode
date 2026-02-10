function formatEntries(entries) {
  return entries.map(e => {
    const ts = e.timestamp.toISOString();
    return `[${ts}] (${e.wordCount} words) ${e.content}`;
  }).join('\n\n');
}

function summarizeStats(entries) {
  const total = entries.length;
  if (total === 0) return 'No journal entries found in this channel.';

  const words = entries.map(e => e.wordCount);
  const totalWords = words.reduce((a, b) => a + b, 0);
  const avgWords = Math.round(totalWords / total);
  const first = entries[0].timestamp.toISOString().split('T')[0];
  const last = entries[total - 1].timestamp.toISOString().split('T')[0];

  return `${total} entries from ${first} to ${last} | ${totalWords} total words | avg ${avgWords} words/entry`;
}

const DISCORD_MAX = 2000;

async function sendLong(message, text) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > DISCORD_MAX) {
    let cut = remaining.lastIndexOf('\n', DISCORD_MAX);
    if (cut <= 0) cut = DISCORD_MAX;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, '');
  }
  if (remaining.length > 0) chunks.push(remaining);

  for (const chunk of chunks) {
    await message.channel.send(chunk);
  }
}

module.exports = { formatEntries, summarizeStats, sendLong };
