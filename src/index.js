require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { fetchJournalEntries } = require('./history');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error('Error: DISCORD_TOKEN is not set. Create a .env file with your bot token.');
  process.exit(1);
}

// Load commands
const commands = new Map();
const commandFiles = ['insight', 'rhythm', 'cadence', 'mood', 'length', 'focus', 'topics', 'questions', 'vocab'];
for (const file of commandFiles) {
  const cmd = require(`./commands/${file}`);
  commands.set(cmd.name, cmd);
}

// Build slash command definitions for Discord API
const slashCommands = commandFiles.map(file => {
  const cmd = require(`./commands/${file}`);
  return new SlashCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description)
    .toJSON();
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('clientReady', async () => {
  console.log(`Journal Node online — logged in as ${client.user.tag}`);

  // Register slash commands globally
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
    console.log(`Registered ${slashCommands.length} slash commands: ${commandFiles.map(c => `/${c}`).join(', ')}`);
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;

  console.log(`[Command] /${interaction.commandName} by ${interaction.user.username}`);

  try {
    // Defer reply since analysis takes time (charts + LLM call)
    await interaction.deferReply();

    const entries = await fetchJournalEntries(interaction.channel, client.user.id);
    await cmd.execute(interaction, entries);
  } catch (err) {
    console.error(`Command /${interaction.commandName} failed:`, err);
    const errorMsg = 'Something went wrong running that command. Check your OPENROUTER_API_KEY and try again.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errorMsg).catch(() => {});
    } else {
      await interaction.reply(errorMsg).catch(() => {});
    }
  }
});

process.on('SIGINT', () => {
  console.log('\nShutting down Journal Node...');
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_TOKEN);
