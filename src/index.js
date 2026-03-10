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
const chatCmd = require('./commands/chat');
commands.set(chatCmd.name, chatCmd);
const postfiatCmd = require('./commands/postfiat');
commands.set(postfiatCmd.name, postfiatCmd);
const walletsCmd = require('./commands/wallets');
commands.set(walletsCmd.name, walletsCmd);
const sendCmd = require('./commands/send');
commands.set(sendCmd.name, sendCmd);
const balanceCmd = require('./commands/balance');
commands.set(balanceCmd.name, balanceCmd);
const mintCmd = require('./commands/mint');
commands.set(mintCmd.name, mintCmd);
const galleryCmd = require('./commands/gallery');
commands.set(galleryCmd.name, galleryCmd);
const receiveCmd = require('./commands/receive');
commands.set(receiveCmd.name, receiveCmd);
const onboardCmd = require('./commands/onboard');
commands.set(onboardCmd.name, onboardCmd);
const tradeCmd = require('./commands/trade');
commands.set(tradeCmd.name, tradeCmd);
const mytradesCmd = require('./commands/mytrades');
commands.set(mytradesCmd.name, mytradesCmd);
const menuCmd = require('./commands/menu');
commands.set(menuCmd.name, menuCmd);
const analyzeCmd = require('./commands/analyze');
commands.set(analyzeCmd.name, analyzeCmd);
const faqCmd = require('./commands/faq');
commands.set(faqCmd.name, faqCmd);
const tradehistoryCmd = require('./commands/tradehistory');
commands.set(tradehistoryCmd.name, tradehistoryCmd);
const chartCmd = require('./commands/chart');
commands.set(chartCmd.name, chartCmd);
const sendnftCmd = require('./commands/sendnft');
commands.set(sendnftCmd.name, sendnftCmd);
const thesisCmd = require('./commands/thesis');
commands.set(thesisCmd.name, thesisCmd);
const compareCmd = require('./commands/compare');
commands.set(compareCmd.name, compareCmd);
const watchlistCmd = require('./commands/watchlist');
commands.set(watchlistCmd.name, watchlistCmd);

const { chat: llmChat } = require('./openrouter');
const { formatEntries, summarizeStats, sendLong } = require('./commands/helpers');
const { getUserPurpose } = require('./onboardStore');

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

// /send: destination (required), amount (required), memo (optional)
const sendBuilder = new SlashCommandBuilder()
  .setName('send')
  .setDescription(sendCmd.description)
  .addStringOption(opt => opt
    .setName('destination')
    .setDescription('The wallet address to send PFT to')
    .setRequired(true))
  .addStringOption(opt => opt
    .setName('amount')
    .setDescription('Amount of PFT to send')
    .setRequired(true))
  .addStringOption(opt => opt
    .setName('memo')
    .setDescription('Optional memo to attach on-chain')
    .setRequired(false));
slashCommands.push(sendBuilder.toJSON());

// /balance: no options needed
const balanceBuilder = new SlashCommandBuilder()
  .setName('balance')
  .setDescription(balanceCmd.description);
slashCommands.push(balanceBuilder.toJSON());

// /mint: uri (optional string) + image (optional attachment)
const mintBuilder = new SlashCommandBuilder()
  .setName('mint')
  .setDescription(mintCmd.description)
  .addStringOption(opt => opt
    .setName('uri')
    .setDescription('IPFS URI (e.g. ipfs://bafkrei...)')
    .setRequired(false))
  .addAttachmentOption(opt => opt
    .setName('image')
    .setDescription('Upload a .jpg or .png to mint as an NFT')
    .setRequired(false));
slashCommands.push(mintBuilder.toJSON());

// /gallery: optional page number
const galleryBuilder = new SlashCommandBuilder()
  .setName('gallery')
  .setDescription(galleryCmd.description)
  .addIntegerOption(opt => opt
    .setName('page')
    .setDescription('Page number (10 NFTs per page)')
    .setRequired(false));
slashCommands.push(galleryBuilder.toJSON());

// /receive: no options needed
const receiveBuilder = new SlashCommandBuilder()
  .setName('receive')
  .setDescription(receiveCmd.description);
slashCommands.push(receiveBuilder.toJSON());

// /onboard: no options — opens a modal
const onboardBuilder = new SlashCommandBuilder()
  .setName('onboard')
  .setDescription(onboardCmd.description);
slashCommands.push(onboardBuilder.toJSON());

// /trade: direction (required choice) + screenshot (optional attachment) — opens a modal
const tradeBuilder = new SlashCommandBuilder()
  .setName('trade')
  .setDescription(tradeCmd.description)
  .addStringOption(opt => opt
    .setName('direction')
    .setDescription('Trade direction')
    .setRequired(true)
    .addChoices(
      { name: 'Long', value: 'Long' },
      { name: 'Short', value: 'Short' },
    ))
  .addAttachmentOption(opt => opt
    .setName('screenshot')
    .setDescription('Chart screenshot (optional)')
    .setRequired(false));
slashCommands.push(tradeBuilder.toJSON());

// /mytrades: no options needed
const mytradesBuilder = new SlashCommandBuilder()
  .setName('mytrades')
  .setDescription(mytradesCmd.description);
slashCommands.push(mytradesBuilder.toJSON());

// /menu: no options needed
const menuBuilder = new SlashCommandBuilder()
  .setName('menu')
  .setDescription(menuCmd.description);
slashCommands.push(menuBuilder.toJSON());

// /llmanalyze: modes shown as buttons
const analyzeBuilder = new SlashCommandBuilder()
  .setName('llmanalyze')
  .setDescription(analyzeCmd.description);
slashCommands.push(analyzeBuilder.toJSON());

// /faq: no options needed
const faqBuilder = new SlashCommandBuilder()
  .setName('faq')
  .setDescription(faqCmd.description);
slashCommands.push(faqBuilder.toJSON());

// /tradehistory: optional filter and sort params
const tradehistoryBuilder = new SlashCommandBuilder()
  .setName('tradehistory')
  .setDescription(tradehistoryCmd.description)
  .addStringOption(opt =>
    opt.setName('filter')
      .setDescription('Filter trades by outcome or direction')
      .setRequired(false)
      .addChoices(
        { name: 'Winners Only', value: 'winners' },
        { name: 'Losers Only', value: 'losers' },
        { name: 'Longs Only', value: 'longs' },
        { name: 'Shorts Only', value: 'shorts' },
      ))
  .addStringOption(opt =>
    opt.setName('asset')
      .setDescription('Filter by asset ticker (e.g. BTC, ETH)')
      .setRequired(false))
  .addStringOption(opt =>
    opt.setName('sort')
      .setDescription('Sort order for trades')
      .setRequired(false)
      .addChoices(
        { name: 'Newest First (default)', value: 'newest' },
        { name: 'Oldest First', value: 'oldest' },
      ));
slashCommands.push(tradehistoryBuilder.toJSON());

// /chart: ticker + timeframe
const chartBuilder = new SlashCommandBuilder()
  .setName('chart')
  .setDescription(chartCmd.description)
  .addStringOption(opt =>
    opt.setName('ticker')
      .setDescription('Crypto ticker (e.g. BTC, ETH, SOL)')
      .setRequired(true))
  .addStringOption(opt =>
    opt.setName('timeframe')
      .setDescription('Chart timeframe')
      .setRequired(false)
      .addChoices(
        { name: '1 Minute', value: '1m' },
        { name: '3 Minute', value: '3m' },
        { name: '5 Minute', value: '5m' },
        { name: '15 Minute', value: '15m' },
        { name: '30 Minute', value: '30m' },
        { name: '1 Hour', value: '1h' },
        { name: '2 Hour', value: '2h' },
        { name: '4 Hour', value: '4h' },
        { name: '8 Hour', value: '8h' },
        { name: '12 Hour', value: '12h' },
        { name: 'Daily', value: '1d' },
        { name: '3 Day', value: '3d' },
        { name: 'Weekly', value: '1w' },
        { name: 'Monthly', value: '1M' },
      ));
slashCommands.push(chartBuilder.toJSON());

// /sendnft: destination (required)
const sendnftBuilder = new SlashCommandBuilder()
  .setName('sendnft')
  .setDescription(sendnftCmd.description)
  .addStringOption(opt => opt
    .setName('destination')
    .setDescription('The Post Fiat address to send NFT(s) to')
    .setRequired(true));
slashCommands.push(sendnftBuilder.toJSON());

// /thesis: optional start_date and end_date for multi-day analysis
const thesisBuilder = new SlashCommandBuilder()
  .setName('thesis')
  .setDescription(thesisCmd.description)
  .addStringOption(opt => opt
    .setName('start_date')
    .setDescription('Start date for multi-day analysis (YYYY-MM-DD)')
    .setRequired(false))
  .addStringOption(opt => opt
    .setName('end_date')
    .setDescription('End date for multi-day analysis (YYYY-MM-DD)')
    .setRequired(false));
slashCommands.push(thesisBuilder.toJSON());

// /compare: no options — shows mode buttons
const compareBuilder = new SlashCommandBuilder()
  .setName('compare')
  .setDescription(compareCmd.description);
slashCommands.push(compareBuilder.toJSON());

// /watchlist: add, remove, view subcommands
const watchlistBuilder = new SlashCommandBuilder()
  .setName('watchlist')
  .setDescription(watchlistCmd.description)
  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Add an asset to your watchlist.')
    .addStringOption(opt => opt
      .setName('ticker')
      .setDescription('Asset ticker (e.g. BTC, ETH, SOL, NVDA)')
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Remove an asset from your watchlist.')
    .addStringOption(opt => opt
      .setName('ticker')
      .setDescription('Asset ticker to remove')
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName('view')
    .setDescription('View your watchlist with live prices.'));
slashCommands.push(watchlistBuilder.toJSON());

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
    const allNames = ['chat', 'postfiat', 'wallets', 'send', 'balance', 'mint', 'gallery', 'receive', 'onboard', 'trade', 'mytrades', 'menu', 'llmanalyze', 'faq', 'tradehistory', 'chart', 'sendnft', 'thesis', 'compare', 'watchlist'].map(c => `/${c}`).join(', ');
    console.log(`Registered ${slashCommands.length} slash commands: ${allNames}`);
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'onboard_modal') {
      try {
        await onboardCmd.handleSubmit(interaction);
      } catch (err) {
        console.error('[/onboard] Modal submit failed:', err);
        const errorMsg = 'Something went wrong processing your onboarding. Please try again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(errorMsg).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId === 'trade_modal') {
      try {
        await tradeCmd.handleSubmit(interaction);
      } catch (err) {
        console.error('[/trade] Modal submit failed:', err);
        const errorMsg = 'Something went wrong logging your trade. Please try again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(errorMsg).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId.startsWith('close_trade_modal_')) {
      try {
        await mytradesCmd.handleCloseSubmit(interaction);
      } catch (err) {
        console.error('[/mytrades] Close trade modal failed:', err);
        const errorMsg = 'Something went wrong closing your trade. Please try again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(errorMsg).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId.startsWith('llma_') && interaction.customId.endsWith('_modal')) {
      try {
        await analyzeCmd.handleModalSubmit(interaction);
      } catch (err) {
        console.error('[/llmanalyze] Modal submit failed:', err);
        const errorMsg = 'Something went wrong. Please try `/llmanalyze` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId.startsWith('cmp_') && interaction.customId.endsWith('_modal')) {
      try {
        await compareCmd.handleModalSubmit(interaction);
      } catch (err) {
        console.error('[/compare] Modal submit failed:', err);
        const errorMsg = 'Something went wrong. Please try `/compare` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    }
    return;
  }

  // Handle button interactions
  if (interaction.isButton()) {
    if (interaction.customId === 'chart_analyze') {
      try {
        await chartCmd.handleAnalysisButton(interaction);
      } catch (err) {
        console.error('[chart] AI Analysis button failed:', err);
        const errorMsg = 'Something went wrong running the AI analysis. Please try again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId.startsWith('close_trade_')) {
      try {
        await mytradesCmd.handleCloseButton(interaction);
      } catch (err) {
        console.error('[/mytrades] Close button failed:', err);
        const errorMsg = 'Something went wrong. Please try again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId.startsWith('trade_llma_')) {
      try {
        await analyzeCmd.handleTradeButton(interaction);
      } catch (err) {
        console.error('[trade_llma] Button handler failed:', err);
        const errorMsg = 'Something went wrong. Please try again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId.startsWith('llma_')) {
      try {
        await analyzeCmd.handleButton(interaction);
      } catch (err) {
        console.error('[/llmanalyze] Button handler failed:', err);
        const errorMsg = 'Something went wrong. Please try `/llmanalyze` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId.startsWith('th_')) {
      try {
        await tradehistoryCmd.handleButton(interaction);
      } catch (err) {
        console.error('[/tradehistory] Button handler failed:', err);
        const errorMsg = 'Something went wrong. Please try `/tradehistory` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId.startsWith('faq_')) {
      try {
        await faqCmd.handleButton(interaction);
      } catch (err) {
        console.error('[/faq] Button handler failed:', err);
        const errorMsg = 'Something went wrong. Please try `/faq` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId.startsWith('cmp_')) {
      try {
        await compareCmd.handleButton(interaction);
      } catch (err) {
        console.error('[/compare] Button handler failed:', err);
        const errorMsg = 'Something went wrong. Please try `/compare` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    }
    return;
  }

  // Handle StringSelectMenu interactions (model selection for /llmanalyze)
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'th_select_trade' || interaction.customId === 'th_timeframe_select') {
      try {
        await tradehistoryCmd.handleSelectMenu(interaction);
      } catch (err) {
        console.error('[/tradehistory] Select menu failed:', err);
        const errorMsg = 'Something went wrong. Please try `/tradehistory` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId === 'sendnft_select') {
      try {
        await sendnftCmd.handleSelectMenu(interaction);
      } catch (err) {
        console.error('[/sendnft] Select menu failed:', err);
        const errorMsg = 'Something went wrong. Please try `/sendnft` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId === 'llmanalyze_model_select') {
      try {
        await analyzeCmd.handleSelectMenu(interaction);
      } catch (err) {
        console.error('[/llmanalyze] Model select failed:', err);
        const errorMsg = 'Something went wrong processing your model selection. Please try `/llmanalyze` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId === 'compare_model_select') {
      try {
        await compareCmd.handleSelectMenu(interaction);
      } catch (err) {
        console.error('[/compare] Model select failed:', err);
        const errorMsg = 'Something went wrong processing your model selection. Please try `/compare` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    } else if (interaction.customId === 'wl_chart_asset' || interaction.customId.startsWith('wl_chart_tf_')) {
      try {
        await watchlistCmd.handleSelectMenu(interaction);
      } catch (err) {
        console.error('[/watchlist] Select menu failed:', err);
        const errorMsg = 'Something went wrong. Please try `/watchlist view` again.';
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: errorMsg, flags: 64 }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => {});
        }
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;

  console.log(`[Command] /${interaction.commandName} by ${interaction.user.username}`);

  try {
    // Modal commands — show modal instead of deferring
    if (cmd.isModal) {
      try {
        await cmd.showModal(interaction);
      } catch (modalErr) {
        console.error(`[Modal] /${interaction.commandName} showModal failed:`, modalErr);
        await interaction.reply({ content: 'Failed to open the form. Please try again.', flags: 64 }).catch(() => {});
      }
      return;
    }

    const timeframe = interaction.options.getString('timeframe');

    // Commands that don't need journal entries (e.g. /postfiat)
    if (cmd.needsEntries === false) {
      await interaction.deferReply(cmd.publicReply ? {} : { flags: 64 });
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
    const stats = allEntries.length > 0 ? summarizeStats(allEntries) : 'No journal entries yet.';
    const formatted = allEntries.length > 0 ? formatEntries(allEntries) : '';
    const purposeData = getUserPurpose(message.author.id);
    const purposeStr = purposeData ? `\n\nThe user's stated journal purpose/goal: "${purposeData.purpose}"\nKeep this goal in mind when analyzing their entries — reference their progress toward it when relevant.` : '';
    const entriesBlock = formatted ? `\n\nJournal entries:\n\n${formatted}` : '';

    // Check for a cached chart image in this channel (from /chart command)
    const cachedChart = chartCmd.getCachedChart(message.channelId);
    let chartContext = '';
    let chatOptions = {};
    if (cachedChart) {
      chartContext = `\n\n[A ${cachedChart.ticker} ${cachedChart.timeframe} candlestick chart is currently displayed in this channel. The chart image is attached for your reference. You can see and analyze the chart visually.]`;
      chatOptions = { imageBase64: cachedChart.buffer.toString('base64') };
    }

    const context = `Context window: all time\nJournal summary: ${stats}${purposeStr}${chartContext}${entriesBlock}\n\n---\nUser's message: ${userText}`;
    const reply = await llmChat(chatCmd.SYSTEM_PROMPT, context, chatOptions);

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
