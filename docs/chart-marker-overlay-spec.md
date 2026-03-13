# Chart Date-Marker & Tweet-Timestamp Overlay Spec

> **Version:** 1.0.0
> **Status:** Draft
> **Author:** Journal Node
> **Date:** 2026-03-13

## Overview

This spec extends the `/chart` slash command and the `fc` chat command with an optional **date marker** parameter. Users can append either a manual date (`MM/DD/YYYY`) or a tweet URL to their chart command. The marker pins a visible dot on the chart at the specified date (or the tweet's publish timestamp), draws a dashed reference line from that point to the present candle, and displays the **percentage change in price** from the marker date to now.

This lets users visually answer: *"How has the price changed since this date or this tweet?"*

---

## 1. Command Syntax

### 1.1 Manual Date Marker

Append a date in `MM/DD/YYYY` format after the timeframe:

```
/chart ticker:BTC timeframe:4h marker:03/01/2026
fc BTC 4h 03/01/2026
fc BTC 4h% 03/01/2026
```

### 1.2 Tweet URL Marker

Append a Twitter/X post URL. The publish timestamp of the tweet is extracted and used as the marker date:

```
/chart ticker:BTC timeframe:4h marker:https://x.com/user/status/1234567890
fc BTC 4h https://x.com/user/status/1234567890
fc BTC 4h% https://x.com/user/status/1234567890
```

Both `x.com` and `twitter.com` domains are accepted.

### 1.3 Parsing Rules

| Token pattern | Detected as | Notes |
|---|---|---|
| `MM/DD/YYYY` (digits with slashes) | Manual date | Must be a valid calendar date |
| `https://x.com/.../status/\d+` | Tweet URL | Status ID used to fetch publish timestamp |
| `https://twitter.com/.../status/\d+` | Tweet URL | Same handling as `x.com` |

### 1.4 Ambiguous & Invalid Input Handling

| Scenario | Behavior |
|---|---|
| Date is in the future | Reject with error: *"Marker date cannot be in the future."* |
| Date is before the chart's visible candle range | Extend the candle fetch window back to include the marker date (up to a max of 500 candles). If still out of range, reply: *"Marker date is too far back for the selected timeframe. Try a longer timeframe (e.g. `1d` or `1w`)."* |
| Invalid date format (e.g. `13/40/2026`) | Reject with error: *"Invalid date. Use MM/DD/YYYY format."* |
| Tweet URL returns no data or is inaccessible | Reply: *"Could not resolve tweet timestamp. The tweet may be deleted or private."* |
| Tweet publish date falls outside the chart range | Same behavior as manual date out of range (extend or reject) |
| Multiple markers supplied | Only the **first** marker token is used; extras are ignored |

### 1.5 `fc` Regex Extension

The current `fc` regex:
```
/^fc\s+(\S+)(?:\s+(\S+?))?\s*(%?)\s*$/i
```

Extended to capture an optional trailing marker:
```
/^fc\s+(\S+)(?:\s+(\S+?))?\s*(%?)\s*((?:\d{2}\/\d{2}\/\d{4})|(?:https?:\/\/(?:x|twitter)\.com\/\S+))?\s*$/i
```

The `/chart` slash command adds an optional `marker` string option to the existing command definition.

---

## 2. Normalized Output Object — `ChartMarkerEvent`

When a marker is present, `generateChart()` returns an additional `marker` field in its result:

```typescript
interface ChartMarkerEvent {
  /** Resolved ticker symbol, e.g. "BTC", "NVDA" */
  asset: string;

  /** Candle interval used, e.g. "4h", "1d" */
  timeframe: string;

  /** How the marker was supplied */
  marker_source: "manual_date" | "tweet_url";

  /** ISO 8601 UTC timestamp of the marker point on the chart */
  marker_timestamp: string;

  /** Price (close) of the candle nearest to marker_timestamp */
  reference_price: number;

  /** Latest closing price */
  current_price: number;

  /** Signed percentage change: ((current - reference) / reference) * 100, rounded to 2 dp */
  percent_change: number;

  /** Human-readable one-liner, e.g. "BTC is up +12.34% since Mar 1, 2026" */
  summary: string;

  /** Only present when marker_source is "tweet_url" */
  tweet_url?: string;

  /** Only present when marker_source is "tweet_url" */
  tweet_author?: string;
}
```

### 2.1 Field Details

| Field | Derivation |
|---|---|
| `asset` | Same as the resolved coin from `fetchCandles()` — e.g. `"BTC"`, `"NVDA"` |
| `timeframe` | The timeframe key passed to the command — e.g. `"4h"` |
| `marker_source` | `"manual_date"` if user typed `MM/DD/YYYY`; `"tweet_url"` if a tweet link was provided |
| `marker_timestamp` | For manual date: midnight UTC of the given date. For tweet: the tweet's `created_at` timestamp |
| `reference_price` | The **close** price of the candle whose timestamp is closest to (≤) `marker_timestamp` |
| `current_price` | The close price of the last candle in the dataset |
| `percent_change` | `((current_price - reference_price) / reference_price * 100)`, rounded to 2 decimal places |
| `summary` | Auto-generated string: `"{ASSET} is {up/down} {±X.XX}% since {formatted_date}"` |
| `tweet_url` | The original tweet URL as provided by the user |
| `tweet_author` | The `@handle` extracted from the tweet URL path |

---

## 3. Visual Rendering

The marker is rendered on the existing SVG candlestick chart with these elements:

1. **Marker dot** — A filled circle (radius 5px, color `#38bdf8` sky blue, dark stroke) placed on the candle closest to the marker timestamp, at the close price.
2. **Vertical dashed line** — A thin dashed vertical line (`#38bdf8`, opacity 0.5) from the top to bottom of the chart area at the marker candle's X position, labeling the date.
3. **Horizontal reference line** — A thin dashed horizontal line (`#38bdf8`, opacity 0.3) from the marker dot to the right edge of the chart, showing the reference price level.
4. **Percent-change badge** — A label near the last candle showing the signed percent change (green if positive, red if negative) with a background rectangle for readability. Format: `+12.34% since Mar 1`.
5. **Marker source label** — Below the date on the vertical line: `"MM/DD/YYYY"` for manual dates, or `"@handle tweet"` for tweet markers.

These overlay elements are drawn **after** candlesticks but **before** the swing overlay (if both are active), so swing zigzag lines layer on top.

---

## 4. Examples

### 4.1 Manual Date Marker

**Command:**
```
fc BTC 4h 03/01/2026
```

**Behavior:**
- Fetches BTC 4h candles. The default window is 60 candles (~10 days). March 1 is within range.
- Finds the candle closest to `2026-03-01T00:00:00Z`. Its close price is `$78,250.00`.
- Current (latest candle) close price is `$83,450.25`.
- Percent change: `((83450.25 - 78250.00) / 78250.00) * 100 = +6.64%`.
- A sky-blue dot is plotted at the Mar 1 candle, with a dashed horizontal line to the right edge and a `+6.64% since Mar 1` badge near the last candle.

**Normalized output:**
```json
{
  "asset": "BTC",
  "timeframe": "4h",
  "marker_source": "manual_date",
  "marker_timestamp": "2026-03-01T00:00:00Z",
  "reference_price": 78250.00,
  "current_price": 83450.25,
  "percent_change": 6.64,
  "summary": "BTC is up +6.64% since Mar 1, 2026"
}
```

**Chart output (Discord embed):**
```
BTC · 4 Hour · $83,450.25
▲ 2.77% | Data via Hyperliquid

📌 Marker: Mar 1, 2026 → +6.64% ($78,250 → $83,450)
```

### 4.2 Tweet URL Marker

**Command:**
```
fc BTC 1d https://x.com/elonmusk/status/1895347841241940408
```

**Behavior:**
- Parses the tweet URL, extracts the status ID `1895347841241940408`.
- Resolves the tweet's publish timestamp: `2025-02-28T03:15:00Z`.
- Fetches BTC 1d candles. Default 90 candles covers ~3 months back — Feb 28 is within range.
- Finds the daily candle for Feb 28, 2025. Its close price is `$84,500.00`.
- Current close price is `$83,450.25`.
- Percent change: `((83450.25 - 84500.00) / 84500.00) * 100 = -1.24%`.
- A sky-blue dot is plotted at the Feb 28 daily candle, with a dashed line and a `-1.24% since @elonmusk tweet` badge.

**Normalized output:**
```json
{
  "asset": "BTC",
  "timeframe": "1d",
  "marker_source": "tweet_url",
  "marker_timestamp": "2025-02-28T03:15:00Z",
  "reference_price": 84500.00,
  "current_price": 83450.25,
  "percent_change": -1.24,
  "summary": "BTC is down -1.24% since @elonmusk tweet on Feb 28, 2025",
  "tweet_url": "https://x.com/elonmusk/status/1895347841241940408",
  "tweet_author": "@elonmusk"
}
```

**Chart output (Discord embed):**
```
BTC · Daily · $83,450.25
▲ 2.77% | Data via Hyperliquid

📌 Marker: @elonmusk tweet (Feb 28, 2025) → -1.24% ($84,500 → $83,450)
```

---

## 5. Tweet Timestamp Resolution

To get a tweet's publish timestamp without requiring Twitter API credentials:

1. **Snowflake extraction (preferred):** Twitter status IDs are Snowflake IDs. The timestamp can be extracted directly:
   ```javascript
   function tweetIdToTimestamp(statusId) {
     // Twitter Snowflake epoch: 1288834974657 (Nov 4, 2010)
     const TWITTER_EPOCH = 1288834974657n;
     const id = BigInt(statusId);
     const timestampMs = Number((id >> 22n) + TWITTER_EPOCH);
     return new Date(timestampMs);
   }
   ```
   This requires **no API call** and works for any valid tweet ID, even deleted tweets.

2. **Fallback (oembed):** If Snowflake extraction fails validation, attempt the public oembed endpoint:
   ```
   https://publish.twitter.com/oembed?url=https://x.com/i/status/{id}
   ```
   This returns metadata but not a precise timestamp — use only as a connectivity check.

The Snowflake method is strongly preferred because it's instant, free, and works offline.

---

## 6. Post Fiat Testnet Memo Schema — Chart Marker Event

### 6.1 Full Payload (for Discord embeds, API responses, off-chain storage)

```json
{
  "v": "1.0.0",
  "type": "chart_marker",
  "asset": "BTC",
  "timeframe": "1d",
  "generated_at": "2026-03-13T18:30:00Z",
  "marker": {
    "source": "tweet_url",
    "timestamp": "2025-02-28T03:15:00Z",
    "reference_price": 84500.00,
    "tweet_url": "https://x.com/elonmusk/status/1895347841241940408",
    "tweet_author": "@elonmusk"
  },
  "current_price": 83450.25,
  "percent_change": -1.24,
  "summary": "BTC is down -1.24% since @elonmusk tweet on Feb 28, 2025"
}
```

### 6.2 Compact Memo Payload (for on-chain XRPL memo data, ≤ 1 KB)

```json
{
  "v": "1.0.0",
  "type": "cm",
  "t": "BTC",
  "tf": "1d",
  "ts": "2026-03-13T18:30Z",
  "mk": {
    "s": "tw",
    "at": 1740712500,
    "rp": 84500.00,
    "tid": "1895347841241940408"
  },
  "cp": 83450.25,
  "pc": -1.24,
  "sum": "BTC -1.24% since @elonmusk tweet"
}
```

**Compaction rules:**
- `type: "cm"` — chart marker (vs `"so"` for swing overlay)
- `mk.s` — marker source: `"d"` for manual date, `"tw"` for tweet URL
- `mk.at` — marker timestamp as Unix epoch seconds
- `mk.rp` — reference price at marker
- `mk.tid` — tweet status ID (only present for tweet markers)
- `cp` — current price
- `pc` — percent change (signed, 2 dp)
- `sum` — summary truncated to ≤ 64 chars for on-chain

For manual date markers, the compact form is even smaller:
```json
{
  "v": "1.0.0",
  "type": "cm",
  "t": "BTC",
  "tf": "4h",
  "ts": "2026-03-13T18:30Z",
  "mk": {
    "s": "d",
    "at": 1740787200,
    "rp": 78250.00
  },
  "cp": 83450.25,
  "pc": 6.64,
  "sum": "BTC +6.64% since Mar 1 2026"
}
```

### 6.3 XRPL Memo Field Mapping

| Memo Field | Content |
|---|---|
| `MemoType` | `application/json;schema=pf-chart-marker/1.0.0` (hex-encoded) |
| `MemoData` | Compact JSON payload above (UTF-8 → hex-encoded) |
| `MemoFormat` | `application/json` (hex-encoded) |

### 6.4 Encoding Example

```javascript
const memo = {
  v: '1.0.0', type: 'cm', t: 'BTC', tf: '4h',
  ts: '2026-03-13T18:30Z',
  mk: { s: 'd', at: 1740787200, rp: 78250.00 },
  cp: 83450.25, pc: 6.64,
  sum: 'BTC +6.64% since Mar 1 2026'
};

const payment = {
  // ... standard XRPL payment fields ...
  Memos: [{
    Memo: {
      MemoType: Buffer.from('application/json;schema=pf-chart-marker/1.0.0', 'utf8').toString('hex').toUpperCase(),
      MemoData: Buffer.from(JSON.stringify(memo), 'utf8').toString('hex').toUpperCase(),
      MemoFormat: Buffer.from('application/json', 'utf8').toString('hex').toUpperCase(),
    },
  }],
};
```

---

## 7. Combining Markers with Swing Overlay

Both features can be active simultaneously:

```
fc BTC 4h% 03/01/2026
```

This produces a chart with:
- Candlesticks (base layer)
- Marker dot + reference line + percent badge (marker layer)
- Swing zigzag lines + percentage labels (swing layer, on top)

The `generateChart()` return object includes both `marker` (ChartMarkerEvent) and `swings`/`swingChanges` fields. The memo payload can combine both schemas:

```json
{
  "v": "1.0.0",
  "type": "cm+so",
  "t": "BTC",
  "tf": "4h",
  "ts": "2026-03-13T18:30Z",
  "mk": { "s": "d", "at": 1740787200, "rp": 78250.00 },
  "cp": 83450.25,
  "pc": 6.64,
  "swings": [["L", 79800.00, 1741003200], ["H", 84100.50, 1741222800]],
  "legs": [5.39],
  "sum": "BTC +6.64% since Mar 1; higher lows"
}
```

---

## 8. Implementation Checklist

- [ ] Add `marker` string option to `/chart` slash command definition
- [ ] Extend `fc` regex to capture trailing date or tweet URL
- [ ] Implement `tweetIdToTimestamp()` using Snowflake extraction
- [ ] Add `parseMarker(input)` function returning `{ type, timestamp, tweetUrl?, tweetAuthor? }`
- [ ] Modify `fetchCandles()` to accept optional `markerTimestamp` and extend the candle window if needed
- [ ] Add marker rendering to `buildCandlestickSvg()` — dot, vertical line, horizontal reference line, percent badge
- [ ] Return `ChartMarkerEvent` from `generateChart()` when marker is present
- [ ] Add marker line to Discord embed description
- [ ] Write tests for date parsing, Snowflake extraction, and edge cases
