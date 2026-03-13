# Chart Swing Overlay Memo Schema

> **Version:** 1.0.0
> **Status:** Draft
> **Author:** Journal Node
> **Date:** 2026-03-13

## Overview

This spec defines a compact JSON schema for encoding swing-high / swing-low percentage annotations and optional written summaries produced by Journal Node's `fc` chart command. The schema is designed so the payload can be:

1. Embedded in Discord chart outputs (already implemented)
2. Attached to Post Fiat testnet transaction memos for on-chain market-structure artifacts
3. Consumed by other builders implementing chart analysis, NFT chart receipts, or on-chain swing analytics

---

## Field Definitions

### Top-Level Payload

| Field | Type | Required | Description |
|---|---|---|---|
| `v` | `string` | yes | Schema version (`"1.0.0"`) |
| `ticker` | `string` | yes | Resolved asset ticker, e.g. `"BTC"`, `"NVDA"` |
| `timeframe` | `string` | yes | Candle interval used, e.g. `"4h"`, `"1d"` |
| `generated_at` | `string` (ISO 8601) | yes | UTC timestamp when the analysis was generated |
| `price` | `object` | yes | Current price context (see below) |
| `swings` | `array<SwingPoint>` | yes | Ordered array of detected swing highs/lows |
| `legs` | `array<SwingLeg>` | yes | Percentage-change legs between consecutive swings |
| `summary` | `string` | no | Short human-readable summary of the swing action (≤ 280 chars) |

### `price` Object

| Field | Type | Description |
|---|---|---|
| `current` | `number` | Last closing price |
| `open` | `number` | First candle's open price in the range |
| `change_pct` | `number` | Overall % change across the visible range |
| `high` | `number` | Highest price in the range |
| `low` | `number` | Lowest price in the range |

### `SwingPoint` Object

| Field | Type | Description |
|---|---|---|
| `type` | `"high" \| "low"` | Whether this is a swing high or swing low |
| `price` | `number` | The high (for swing highs) or low (for swing lows) price at this point |
| `timestamp` | `string` (ISO 8601) | Candle timestamp of the swing point |
| `candle_index` | `integer` | 0-based index into the candle array |

### `SwingLeg` Object

| Field | Type | Description |
|---|---|---|
| `from_index` | `integer` | Index into the `swings` array for the start of this leg |
| `to_index` | `integer` | Index into the `swings` array for the end of this leg |
| `pct_change` | `number` | Percentage change from start to end (signed; negative = decline) |
| `direction` | `"up" \| "down"` | Direction of the move |

---

## Constraints

- `ticker` must be 1–20 uppercase alphanumeric characters
- `timeframe` must be one of: `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `8h`, `12h`, `1d`, `3d`, `1w`, `1M`
- `swings` array must contain ≥ 2 points for a valid swing analysis (otherwise `swings` and `legs` are empty arrays)
- `swings` must alternate between `"high"` and `"low"` types (zigzag pattern)
- `pct_change` values are rounded to 2 decimal places
- `summary` is optional and must be ≤ 280 characters (fits a single tweet / compact memo)
- All prices are decimal numbers (not string-encoded)

---

## Example Payload

```json
{
  "v": "1.0.0",
  "ticker": "BTC",
  "timeframe": "4h",
  "generated_at": "2026-03-13T18:30:00Z",
  "price": {
    "current": 83450.25,
    "open": 81200.00,
    "change_pct": 2.77,
    "high": 84100.50,
    "low": 79800.00
  },
  "swings": [
    { "type": "low",  "price": 79800.00, "timestamp": "2026-03-03T08:00:00Z", "candle_index": 5 },
    { "type": "high", "price": 84100.50, "timestamp": "2026-03-05T20:00:00Z", "candle_index": 20 },
    { "type": "low",  "price": 80500.00, "timestamp": "2026-03-08T04:00:00Z", "candle_index": 34 },
    { "type": "high", "price": 83900.00, "timestamp": "2026-03-10T16:00:00Z", "candle_index": 49 },
    { "type": "low",  "price": 82100.00, "timestamp": "2026-03-12T00:00:00Z", "candle_index": 57 }
  ],
  "legs": [
    { "from_index": 0, "to_index": 1, "pct_change": 5.39,  "direction": "up" },
    { "from_index": 1, "to_index": 2, "pct_change": -4.28, "direction": "down" },
    { "from_index": 2, "to_index": 3, "pct_change": 4.22,  "direction": "up" },
    { "from_index": 3, "to_index": 4, "pct_change": -2.15, "direction": "down" }
  ],
  "summary": "BTC 4h: rallied +5.4% to $84.1k, pulled back -4.3% to $80.5k, bounced +4.2% to $83.9k, dipped -2.1% to $82.1k. Higher lows forming — constructive structure."
}
```

---

## Post Fiat Testnet Memo Mapping

XRPL transaction memos consist of three fields, each hex-encoded:

| Memo Field | Max Size | What Goes Here |
|---|---|---|
| `MemoType` | ~256 bytes | Schema identifier: `"application/json;schema=pf-swing-overlay/1.0.0"` |
| `MemoData` | ~1 KB recommended | Compact payload (see below) |
| `MemoFormat` | ~256 bytes | `"application/json"` |

### Fields That Fit On-Chain Directly

The following compact subset fits within the ~1 KB memo data budget:

```json
{
  "v": "1.0.0",
  "t": "BTC",
  "tf": "4h",
  "ts": "2026-03-13T18:30Z",
  "p": 83450.25,
  "swings": [
    ["L", 79800.00, 1741003200],
    ["H", 84100.50, 1741222800],
    ["L", 80500.00, 1741406400],
    ["H", 83900.00, 1741622400],
    ["L", 82100.00, 1741737600]
  ],
  "legs": [5.39, -4.28, 4.22, -2.15],
  "sum": "Higher lows forming"
}
```

**Compaction rules:**
- Single-letter keys (`t`, `tf`, `ts`, `p`)
- Swings as tuples: `["H"|"L", price, unix_epoch_seconds]`
- Legs as flat array of signed percentages (order matches swing pairs)
- Summary truncated to ≤ 64 chars for on-chain; full text stored off-chain

### Fields That Should Be Hashed or Stored Off-Chain

| Field | Reason | On-Chain Representation |
|---|---|---|
| Full `summary` (> 64 chars) | Too large for memo | Store off-chain (IPFS / gist); include SHA-256 hash in memo as `"sh"` field |
| Chart PNG image | Binary, large | Store off-chain; optionally reference CID or URL |
| Full candle data | Not needed in memo | Reproducible from Hyperliquid API with ticker + timeframe + timestamp |

### Example On-Chain Memo Hex

The compact JSON above, UTF-8 encoded then hex-encoded, fits comfortably in a standard XRPL memo payload (typically < 500 bytes).

---

## Usage Notes

- **Chart command trigger:** Users append `%` to their `fc` command to activate swing overlay.
  - `fc BTC 4h%` — BTC 4-hour chart with swing % overlay
  - `fc ETH 1d %` — ETH daily chart with swing % overlay
- **Lookback window:** The swing detection uses an adaptive lookback of `max(3, min(7, floor(candles/12)))` candles on each side.
- **Zigzag constraint:** Consecutive swing points always alternate between high and low. When two highs (or two lows) occur consecutively, the more extreme value is kept.
- **Builders** consuming this schema can use the `swings` + `legs` arrays to reconstruct the zigzag overlay on any charting library, or parse the compact memo format from on-chain transaction data.
