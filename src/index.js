require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { fetchJournalEntries } = require('./history');
const { TIMEFRAME_CHOICES, filterByTimeframe, timeframeLabel } = require('./timeframe');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error('Error: DISCORD_TOKEN is not set. Create a .env file with your bot token.');
  process.exit(1);
}

// Load commands
const commands = new Map();
const analysisCommands = ['insight', 'rhythm', 'cadence', 'mood', 'length', 'focus', 'topics', 'questions', 'vocab'];
for (const file of analysisCommands) {
  const cmd = require(`./commands/${file}`);
  commands.set(cmd.name, cmd);
}
const chatCmd = require('./commands/chat');
commands.set(chatCmd.name, chatCmd);

// Build slash command definitions
function addTimeframeOption(builder) {
  return builder.addStringOption(opt =>
    opt.setName('timeframe')
      .setDescription('Time period to analyze (default: all time)')
      .setRequired(false)
      .addChoices(...TIMEFRAME_CHOICES)
  );
}

const slashCommands = [];

// Analysis commands: name + description + timeframe option
for (const file of analysisCommands) {
  const cmd = require(`./commands/${file}`);
  const builder = new SlashCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description);
  addTimeframeOption(builder);
  slashCommands.push(builder.toJSON());
}

// /chat: message (required) + timeframe option
const chatBuilder = new SlashCommandBuilder()
  .setName('chat')
  .setDescription(chatCmd.description)
  .addStringOption(opt =>
    opt.setName('message')
      .setDescription('What do you want to ask or discuss?')
      .setRequired(true)
  );
addTimeframeOption(chatBuilder);
slashCommands.push(chatBuilder.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('clientReady', async () => {
  console.log(`Journal Node online — logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
    const allNames = [...analysisCommands, 'chat'].map(c => `/${c}`).join(', ');
    console.log(`Registered ${slashCommands.length} slash commands: ${allNames}`);
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;

  const timeframe = interaction.options.getString('timeframe');
  const tfLabel = timeframeLabel(timeframe);
  console.log(`[Command] /${interaction.commandName} (${tfLabel}) by ${interaction.user.username}`);

  try {
    await interaction.deferReply();

    const allEntries = await fetchJournalEntries(interaction.channel, client.user.id);
    const entries = filterByTimeframe(allEntries, timeframe);

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
