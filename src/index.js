require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { fetchJournalEntries, COMMAND_PREFIX } = require('./history');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const JOURNAL_CHANNEL_ID = process.env.JOURNAL_CHANNEL_ID || null;

if (!DISCORD_TOKEN) {
  console.error('Error: DISCORD_TOKEN is not set. Create a .env file with your bot token.');
  process.exit(1);
}

// Load commands
const commands = new Map();
const commandFiles = ['help', 'insight', 'rhythm', 'cadence', 'mood', 'length', 'focus', 'topics', 'questions', 'vocab'];
for (const file of commandFiles) {
  const cmd = require(`./commands/${file}`);
  commands.set(cmd.name, cmd);
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

client.once('clientReady', () => {
  console.log(`Journal Node online — logged in as ${client.user.tag}`);
  console.log(`Commands: ${[...commands.keys()].map(c => `!${c}`).join(', ')}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (JOURNAL_CHANNEL_ID && message.channel.id !== JOURNAL_CHANNEL_ID) return;

  const content = message.content.trim();
  if (!content) return;

  // Command handling
  if (content.startsWith(COMMAND_PREFIX)) {
    const args = content.slice(COMMAND_PREFIX.length).split(/\s+/);
    const cmdName = args[0].toLowerCase();
    const cmd = commands.get(cmdName);

    if (!cmd) {
      await message.reply(`Unknown command \`!${cmdName}\`. Type \`!help\` for available commands.`);
      return;
    }

    console.log(`[Command] !${cmdName} by ${message.author.username}`);

    try {
      if (cmd.name === 'help') {
        await cmd.execute(message, null, commands);
      } else {
        await message.react('🔍');
        const entries = await fetchJournalEntries(message.channel, client.user.id);
        await cmd.execute(message, entries);
      }
    } catch (err) {
      console.error(`Command !${cmdName} failed:`, err);
      await message.reply('Something went wrong running that command. Check your OPENROUTER_API_KEY and try again.').catch(() => {});
    }
    return;
  }

  // Silent logging — no reply, just react
  try {
    await message.react('📓');
  } catch (err) {
    // Reaction may fail if bot lacks permissions — that's fine, stay silent
  }
});

process.on('SIGINT', () => {
  console.log('\nShutting down Journal Node...');
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_TOKEN);
