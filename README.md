# Journal Node

A Discord bot that combines AI-powered journaling insights with a multi-mode trading analysis engine, Hyperliquid perpetual trading integration, and Post Fiat (PFT) blockchain anchoring.

**Discord is your database.** Journal entries are your messages — the bot reads channel history on demand.

## Features

- **Journal Insights** — AI-powered analysis of your writing patterns (mood, rhythm, topics, vocabulary, etc.)
- **Strategic Analysis Pipeline (SAP)** — Four analysis modes (A–D) for trading intelligence
- **Trade Tickets** — Full lifecycle: open, track, and close trades with accuracy scoring
- **Hyperliquid Integration** — Real-time perpetual position tracking with auto-close detection
- **On-Chain Anchoring** — SHA-256 hash anchoring to XRPL for verifiable analysis records
- **PFT Micro-Payments** — Pay-per-analysis fee gate with high-water mark logic
- **Charts** — Candlestick charts with swing overlays, date markers, and entry-price annotations
- **Multi-Wallet Management** — Import and manage Hyperliquid wallets

## Analysis Modes

| Mode | Strategy |
|------|----------|
| **A** | Three-agent bullish/bearish/neutral debate with consensus |
| **B** | Peer-anchored multi-valuation across selected models |
| **C** | Stochastic stress testing with Monte Carlo drift |
| **D** | Vision pipeline + contrarian trap detector |

## Setup

### 1. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, go to the **Bot** tab, and copy the token.
3. Enable **Message Content Intent** under Privileged Gateway Intents.
4. Under **OAuth2 > URL Generator**, select `bot` scope with permissions: Send Messages, Read Message History, Add Reactions.
5. Invite the bot to your server using the generated URL.

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in `DISCORD_TOKEN` and `OPENROUTER_API_KEY` at minimum. Add `GITHUB_GIST_TOKEN` as well if you want `/audit` to publish reports to the journalnode GitHub account. See `.env.example` for other optional settings (PFT master seed, Pinata JWT, etc.).

### 3. Install & Run

```bash
npm install
npm start
```

### 4. Run Tests

```bash
npm test
```

## Commands

### Journal Insights (chat commands)

| Command | What it does |
|---|---|
| `!help` | List all commands |
| `!insight` | General AI analysis of your journal |
| `!rhythm` | Time-of-day and day-of-week writing patterns |
| `!cadence` | Streaks, gaps, and frequency |
| `!mood` | Emotional temperature over time |
| `!length` | Entry length trends and word counts |
| `!focus` | Temporal focus — past, present, or future |
| `!topics` | Theme evolution over time |
| `!questions` | Self-interrogation density |
| `!vocab` | Vocabulary diversity and complexity |

### Trading & Analysis (slash commands)

| Command | What it does |
|---|---|
| `/analyze` | Multi-mode SAP analysis with PFT payment gate |
| `/chat` | Natural language analysis with timeframe filtering |
| `/chart` | Candlestick charts with swing and date-marker overlays |
| `/trade` | Open a new trade with entry/stop/target |
| `/mytrades` | Active trade monitoring with charts |
| `/tradehistory` | Historical trade performance analytics |
| `/thesis` | Trading thesis management |
| `/compare` | Multi-asset comparison |
| `/watchlist` | Asset watchlist with AI briefings |
| `/stats` | Trading performance dashboard |
| `/audit` | Canonical validator-page audit with public GitHub gist output |
| `/hyperliquid` | Hyperliquid perpetuals integration |

### Wallet & Blockchain (slash commands)

| Command | What it does |
|---|---|
| `/postfiat` | PFT testnet wallet creation & airdrop |
| `/wallets` | Multi-wallet management |
| `/send` | PFT transfers |
| `/receive` | Receive PFT instructions |
| `/balance` | Check wallet balance |
| `/mint` | NFT minting (IPFS via Pinata) |
| `/sendnft` | NFT transfers |

## CLI Usage

The Journal Node orchestrator can also be used from the command line:

```bash
# Run analysis
node src/journalNode.js analyze --ticker BTC --assetClass crypto --mode A --timeframe 1W

# Open a trade (pipe SAP output)
node src/journalNode.js analyze --ticker BTC --mode A | \
  node src/journalNode.js open-trade --ticker BTC --direction long --entryPrice 67000

# Open a trade (from file)
node src/journalNode.js open-trade --ticker BTC --direction long --entryPrice 67000 --sapFile analysis.json

# Close a trade
node src/journalNode.js close-trade --ticketId <id> --exitPrice 70000 --outcome win
```

## Architecture

```
src/
├── index.js              # Discord bot entry point & slash command router
├── journalNode.js        # Unified orchestrator (analyze, open-trade, close-trade)
├── modeA–D.js            # Analysis mode implementations
├── rawDataPack.js        # M0: Data assembly
├── modelQueryEngine.js   # M0: Parallel model calling
├── modelReliability.js   # Model accuracy tracking (SQLite)
├── scs.js                # Semantic Conviction Score calculator
├── outlierFilter.js      # Hallucination detection
├── tradeTicket.js        # M6: Trade lifecycle management
├── onChainAnchor.js      # XRPL hash anchoring
├── pftFee.js             # M7: PFT fee mechanism
├── accuracyFeedback.js   # M9: Model accuracy feedback loop
└── *.test.js             # Test suites for each module
```

## License

MIT
