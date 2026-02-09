require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { insertEntry, close } = require('./db');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const JOURNAL_CHANNEL_ID = process.env.JOURNAL_CHANNEL_ID || null;

if (!DISCORD_TOKEN) {
  console.error('Error: DISCORD_TOKEN is not set. Create a .env file with your bot token.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`Journal Node online — logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // If a specific channel is configured, only listen there
  if (JOURNAL_CHANNEL_ID && message.channel.id !== JOURNAL_CHANNEL_ID) return;

  const content = message.content.trim();
  if (!content) return;

  const timestampUtc = new Date().toISOString();

  try {
    const { id, wordCount, charCount } = insertEntry({
      userId: message.author.id,
      username: message.author.username,
      content,
      timestampUtc,
    });

    console.log(`[Entry #${id}] ${timestampUtc} | ${message.author.username} | ${wordCount} words, ${charCount} chars`);

    await message.reply(
      `Journal entry saved. (Entry #${id} — ${wordCount} words, ${charCount} chars — ${timestampUtc})`
    );
  } catch (err) {
    console.error('Failed to save journal entry:', err);
    await message.reply('Something went wrong saving your entry. Please try again.').catch(() => {});
  }
});

process.on('SIGINT', () => {
  console.log('\nShutting down Journal Node...');
  close();
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_TOKEN);
