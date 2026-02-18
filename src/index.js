require('dotenv').config();

const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
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
const postfiatCmd = require('./commands/postfiat');
commands.set(postfiatCmd.name, postfiatCmd);
const walletsCmd = require('./commands/wallets');
commands.set(walletsCmd.name, walletsCmd);

const { chat: llmChat } = require('./openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./commands/helpers');

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

// /postfiat: no options needed
const postfiatBuilder = new SlashCommandBuilder()
  .setName('postfiat')
  .setDescription(postfiatCmd.description);
slashCommands.push(postfiatBuilder.toJSON());

// /wallets: subcommands for wallet management
const walletsBuilder = new SlashCommandBuilder()
  .setName('wallets')
  .setDescription(walletsCmd.description)
  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('View all your saved wallets.'))
  .addSubcommand(sub => sub
    .setName('create')
    .setDescription('Generate a new wallet and save it.'))
  .addSubcommand(sub => sub
    .setName('import')
    .setDescription('Import an existing wallet with a seed phrase or private key.')
    .addStringOption(opt => opt
      .setName('seed')
      .setDescription('Your 24-word seed phrase or private key')
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName('delete')
    .setDescription('Remove a wallet from your profile.')
    .addStringOption(opt => opt
      .setName('address')
      .setDescription('The wallet address to remove')
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName('set-active')
    .setDescription('Set which wallet is your active wallet.')
    .addStringOption(opt => opt
      .setName('address')
      .setDescription('The wallet address to set as active')
      .setRequired(true)));
slashCommands.push(walletsBuilder.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once('clientReady', async () => {
  console.log(`Journal Node online — logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
    const allNames = [...analysisCommands, 'chat', 'postfiat', 'wallets'].map(c => `/${c}`).join(', ');
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
    // Commands that don't need journal entries (e.g. /postfiat)
    if (cmd.needsEntries === false) {
      await interaction.deferReply({ flags: 64 }); // ephemeral — only visible to user
      await cmd.execute(interaction);
      return;
    }

    await interaction.deferReply();

    // In DMs, interaction.channel can be null — fetch it explicitly
    const channel = interaction.channel ?? await client.channels.fetch(interaction.channelId);
    const allEntries = await fetchJournalEntries(channel, client.user.id);
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

// Prefix chat: ! followed by message text
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const userText = message.content.slice(1).trim();
  if (!userText) return;

  console.log(`[!chat] ${message.author.username}: ${userText.slice(0, 80)}`);

  try {
    await message.channel.sendTyping();

    const allEntries = await fetchJournalEntries(message.channel, client.user.id);
    if (allEntries.length === 0) {
      await message.reply('No journal entries found yet. Write some entries first, then come back.');
      return;
    }

    const stats = summarizeStats(allEntries);
    const formatted = formatEntries(allEntries);
    const context = `Context window: all time\nJournal summary: ${stats}\n\nJournal entries:\n\n${formatted}\n\n---\nUser's message: ${userText}`;
    const reply = await llmChat(chatCmd.SYSTEM_PROMPT, context);

    if (reply.length <= 2000) {
      await message.reply(reply);
    } else {
      await message.reply(reply.slice(0, 2000));
      await sendLong(message, reply.slice(2000));
    }
  } catch (err) {
    console.error('Prefix chat failed:', err);
    await message.reply('Something went wrong. Check your OPENROUTER_API_KEY and try again.').catch(() => {});
  }
});

process.on('SIGINT', () => {
  console.log('\nShutting down Journal Node...');
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_TOKEN);
