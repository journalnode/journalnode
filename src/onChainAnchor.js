'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LEDGER_PATH = path.join(__dirname, '..', 'data', 'anchorLedger.jsonl');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialization with recursively sorted keys.
 */
function deterministicStringify(obj) {
  return JSON.stringify(obj, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  });
}

/**
 * Compute SHA-256 hex digest of a string.
 */
function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Stub: PFT Memo Transaction
// ---------------------------------------------------------------------------

/**
 * Submit a memo string to the Post Fiat network.
 *
 * TODO: Replace this stub with the real PFT SDK call once the network
 * integration is ready (see wallet.js for existing PFT helpers).
 */
async function submitPFTMemoTx(memoString) {
  console.log('[PFT STUB] submitPFTMemoTx called with memo:', memoString);
  return { txHash: 'mock_tx_' + Date.now(), status: 'submitted' };
}

// ---------------------------------------------------------------------------
// anchorOutput
// ---------------------------------------------------------------------------

/**
 * Anchor a SAP mode output on-chain.
 *
 * @param {object}  opts
 * @param {object}  opts.sapOutput      - The full output object from a mode run.
 * @param {string}  opts.ticker         - Ticker symbol that was analysed.
 * @param {string}  opts.modeUsed       - One of "mode_a","mode_b","mode_c","mode_d".
 * @param {string}  opts.userDiscordId  - Discord user id that triggered the run.
 * @returns {Promise<{contentHash: string, txHash: string, memoPayload: object, anchoredAt: string}>}
 */
async function anchorOutput({ sapOutput, ticker, modeUsed, userDiscordId }) {
  const serialized = deterministicStringify(sapOutput);
  const contentHash = sha256(serialized);

  const anchoredAt = new Date().toISOString();

  const memoPayload = {
    source_node: 'journal_node',
    output_type: modeUsed,
    content_hash: contentHash,
    ticker,
    timestamp: anchoredAt,
    user_id: userDiscordId,
  };

  const memoString = JSON.stringify(memoPayload);

  // Persist to local ledger
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, memoString + '\n', 'utf8');

  // Submit to PFT network (stubbed)
  const txResult = await submitPFTMemoTx(memoString);

  return {
    contentHash,
    txHash: txResult.txHash,
    memoPayload,
    anchoredAt,
  };
}

// ---------------------------------------------------------------------------
// getAnchorByHash
// ---------------------------------------------------------------------------

/**
 * Search the anchor ledger for a record matching the given content hash.
 *
 * @param {string} contentHash - SHA-256 hex digest to look up.
 * @returns {object|null}
 */
function getAnchorByHash(contentHash) {
  if (!fs.existsSync(LEDGER_PATH)) return null;

  const lines = fs.readFileSync(LEDGER_PATH, 'utf8').split('\n').filter(Boolean);

  for (const line of lines) {
    const record = JSON.parse(line);
    if (record.content_hash === contentHash) return record;
  }

  return null;
}

// ---------------------------------------------------------------------------
// verifyOutput
// ---------------------------------------------------------------------------

/**
 * Recompute the hash of a SAP output and verify it exists in the ledger.
 *
 * @param {object}  opts
 * @param {object}  opts.sapOutput - The SAP output to verify.
 * @returns {{verified: boolean, anchoredAt: string|null, memoPayload: object|null}}
 */
function verifyOutput({ sapOutput }) {
  const serialized = deterministicStringify(sapOutput);
  const contentHash = sha256(serialized);

  const record = getAnchorByHash(contentHash);

  if (record) {
    return {
      verified: true,
      anchoredAt: record.timestamp,
      memoPayload: record,
    };
  }

  return { verified: false, anchoredAt: null, memoPayload: null };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  anchorOutput,
  getAnchorByHash,
  verifyOutput,
  submitPFTMemoTx,
};
