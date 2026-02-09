# Journal Node

A Discord bot for honest self-reflection and journaling. Every message you send is timestamped, stored in a local SQLite database, and acknowledged — forming the core **Input Loop**.

## Setup

### 1. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, give it a name, and go to the **Bot** tab.
3. Click **Reset Token** and copy the token.
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**.
5. Go to **OAuth2 > URL Generator**, select the `bot` scope, then select these permissions:
   - Send Messages
   - Read Message History
6. Copy the generated URL and open it in your browser to invite the bot to your server.

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and paste your bot token. Optionally set `JOURNAL_CHANNEL_ID` to restrict the bot to a single channel.

### 3. Install & Run

```bash
npm install
npm start
```

The bot will log `Journal Node online` when ready. Send any message in the configured channel (or any channel if no channel is configured) and the bot will store it and reply with a confirmation.

## Database

Entries are stored in `journal.db` (SQLite) at the project root. Each entry records:

| Column | Description |
|---|---|
| `id` | Auto-incrementing primary key |
| `user_id` | Discord user ID |
| `username` | Discord username at time of entry |
| `content` | Full message text |
| `timestamp_utc` | ISO 8601 UTC timestamp |
| `word_count` | Number of words |
| `char_count` | Number of characters |

You can inspect the database with any SQLite client:

```bash
sqlite3 journal.db "SELECT * FROM journal_entries;"
```
