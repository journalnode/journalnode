# Journal Node

A Discord bot that lives in your journal channel. Write freely — the bot stays silent (reacts with a notebook emoji). When you want insights, use commands to get AI-powered analysis of your entries read directly from channel history.

**Discord is your database.** No separate storage — the bot reads your messages on demand.

## Setup

### 1. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, give it a name, and go to the **Bot** tab.
3. Click **Reset Token** and copy the token.
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**.
5. Go to **OAuth2 > URL Generator**, select the `bot` scope, then select these permissions:
   - Send Messages
   - Read Message History
   - Add Reactions
6. Copy the generated URL and open it in your browser to invite the bot to your server.

### 2. Get an OpenRouter API Key

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys) and create an API key.
2. Add credits to your account (the insight commands call an LLM).

### 3. Configure Environment

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
copy .env.example .env
```

Edit `.env` and fill in your `DISCORD_TOKEN` and `OPENROUTER_API_KEY`.

### 4. Install & Run

```bash
npm install
npm start
```

## Commands

| Command | What it does |
|---|---|
| `!help` | List all commands |
| `!insight` | General AI analysis of your journal |
| `!rhythm` | When do you write? Time-of-day and day-of-week patterns |
| `!cadence` | How consistent are you? Streaks, gaps, frequency |
| `!mood` | Emotional temperature — fear/doubt vs confidence over time |
| `!length` | Entry length trends — word counts and distribution |
| `!focus` | Temporal focus — past, present, or future oriented? |
| `!topics` | Topic evolution — what themes dominate and how they shift |
| `!questions` | Question density — how much self-interrogation over time |
| `!vocab` | Vocabulary expansion — language diversity and complexity |

## How It Works

- **Journal entries**: Any message that doesn't start with `!` is a journal entry. The bot reacts with a notebook emoji and stays silent.
- **Insight commands**: When you run a command, the bot fetches up to 500 messages from channel history, filters out bot messages and commands, and sends the entries to an LLM via OpenRouter for analysis.
- **No local database**: Your Discord channel IS the journal. The bot reads it on demand.
