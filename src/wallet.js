const xrpl = require('xrpl');
const bip39 = require('bip39');

const PFT_TESTNET_WSS = 'wss://ws.testnet.postfiat.org';
const PFT_NETWORK_ID = 2025;
const AIRDROP_AMOUNT = process.env.PFT_AIRDROP_AMOUNT || '50';

/**
 * Load a wallet from either a 24-word mnemonic or a short seed (sEd...).
 */
function loadWallet(seedOrMnemonic) {
  if (seedOrMnemonic.includes(' ')) {
    return xrpl.Wallet.fromMnemonic(seedOrMnemonic.trim());
  }
  return xrpl.Wallet.fromSeed(seedOrMnemonic.trim());
}

/**
 * Generate a new Post Fiat wallet with a 24-word mnemonic seed phrase.
 */
function generateWallet() {
  const mnemonic = bip39.generateMnemonic(256);
  const wallet = xrpl.Wallet.fromMnemonic(mnemonic);
  return {
    address: wallet.classicAddress,
    mnemonic,
    publicKey: wallet.publicKey,
  };
}

/**
 * Send PFT from the master wallet to a new address to activate it on-chain.
 * Returns the transaction hash on success.
 */
async function airdropToWallet(destinationAddress, amount, memo) {
  const masterSeed = process.env.PFT_MASTER_SEED;
  if (!masterSeed) {
    throw new Error('PFT_MASTER_SEED is not set in environment variables.');
  }

  const client = new xrpl.Client(PFT_TESTNET_WSS);
  await client.connect();

  try {
    const masterWallet = loadWallet(masterSeed);
    const sendAmount = amount || AIRDROP_AMOUNT;

    const payment = {
      TransactionType: 'Payment',
      Account: masterWallet.classicAddress,
      Destination: destinationAddress,
      Amount: xrpl.xrpToDrops(sendAmount),
      NetworkID: PFT_NETWORK_ID,
    };

    if (memo) {
      payment.Memos = [{
        Memo: {
          MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase(),
          MemoType: Buffer.from('text/plain', 'utf8').toString('hex').toUpperCase(),
        },
      }];
    }

    const prepared = await client.autofill(payment);
    const signed = masterWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const txResult = result.result.meta.TransactionResult;
    if (txResult !== 'tesSUCCESS') {
      throw new Error(`Transaction failed: ${txResult}`);
    }

    return {
      txHash: signed.hash,
      amount: sendAmount,
      masterAddress: masterWallet.classicAddress,
    };
  } finally {
    await client.disconnect();
  }
}

/**
 * Send PFT from a user's wallet to a destination address.
 * Optionally attaches a memo (hex-encoded) to the transaction.
 */
async function sendPFT(senderSeed, destinationAddress, amount, memo) {
  const client = new xrpl.Client(PFT_TESTNET_WSS);
  await client.connect();

  try {
    const senderWallet = loadWallet(senderSeed);

    const payment = {
      TransactionType: 'Payment',
      Account: senderWallet.classicAddress,
      Destination: destinationAddress,
      Amount: xrpl.xrpToDrops(amount),
      NetworkID: PFT_NETWORK_ID,
    };

    if (memo) {
      payment.Memos = [{
        Memo: {
          MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase(),
          MemoType: Buffer.from('text/plain', 'utf8').toString('hex').toUpperCase(),
        },
      }];
    }

    const prepared = await client.autofill(payment);
    const signed = senderWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const txResult = result.result.meta.TransactionResult;
    if (txResult !== 'tesSUCCESS') {
      throw new Error(`Transaction failed: ${txResult}`);
    }

    return {
      txHash: signed.hash,
      from: senderWallet.classicAddress,
      to: destinationAddress,
      amount,
      memo: memo || null,
    };
  } finally {
    await client.disconnect();
  }
}

/**
 * Query the PFT balance for an address. Returns balance in PFT (not drops).
 * Returns null if the account is not found / not activated.
 */
async function getBalance(address) {
  const client = new xrpl.Client(PFT_TESTNET_WSS);
  await client.connect();

  try {
    const response = await client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
    });
    return xrpl.dropsToXrp(response.result.account_data.Balance);
  } catch (err) {
    if (err.data && err.data.error === 'actNotFound') {
      return null;
    }
    throw err;
  } finally {
    await client.disconnect();
  }
}

/**
 * Mint an NFT on the Post Fiat testnet.
 * URI is a string (e.g. "ipfs://bafkrei...") that gets hex-encoded.
 * Flags 9 = tfBurnable (1) + tfTransferable (8), matching network convention.
 */
async function mintNFT(ownerSeed, uri) {
  const client = new xrpl.Client(PFT_TESTNET_WSS);
  await client.connect();

  try {
    const wallet = loadWallet(ownerSeed);

    const tx = {
      TransactionType: 'NFTokenMint',
      Account: wallet.classicAddress,
      NFTokenTaxon: 0,
      Flags: 9,
      TransferFee: 0,
      URI: Buffer.from(uri, 'utf8').toString('hex').toUpperCase(),
      NetworkID: PFT_NETWORK_ID,
    };

    const prepared = await client.autofill(tx);
    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const txResult = result.result.meta.TransactionResult;
    if (txResult !== 'tesSUCCESS') {
      throw new Error(`Transaction failed: ${txResult}`);
    }

    const nftokenId = result.result.meta.nftoken_id || null;

    return {
      txHash: signed.hash,
      nftokenId,
      uri,
      minter: wallet.classicAddress,
    };
  } finally {
    await client.disconnect();
  }
}

/**
 * Upload a file buffer to IPFS via Pinata. Returns the IPFS URI.
 * Requires PINATA_JWT env var.
 */
async function uploadToIPFS(buffer, filename) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    throw new Error('PINATA_JWT is not set. Add your Pinata API JWT to the .env file, or provide an IPFS URI directly.');
  }

  const FormData = (await import('formdata-node')).FormData;
  const { Blob } = (await import('formdata-node'));

  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pinata upload failed: ${text}`);
  }

  const data = await response.json();
  return `ipfs://${data.IpfsHash}`;
}

/**
 * Fetch all NFTs owned by an address.
 * Returns array of { nftokenId, uri } with URI decoded from hex.
 */
async function getNFTs(address) {
  const client = new xrpl.Client(PFT_TESTNET_WSS);
  await client.connect();

  try {
    const response = await client.request({
      command: 'account_nfts',
      account: address,
      ledger_index: 'validated',
    });

    const nfts = (response.result.account_nfts || []).map(nft => ({
      nftokenId: nft.NFTokenID,
      uri: nft.URI ? Buffer.from(nft.URI, 'hex').toString('utf8') : null,
      mintTxHash: null,
    }));

    // Fetch account transactions to find mint tx hashes
    try {
      const txResponse = await client.request({
        command: 'account_tx',
        account: address,
        ledger_index_min: -1,
        ledger_index_max: -1,
      });

      const mintTxMap = new Map();
      for (const entry of (txResponse.result.transactions || [])) {
        const txData = entry.tx || entry.tx_json || {};
        const meta = entry.meta || entry.meta_blob || txData.meta || {};
        if (txData.TransactionType === 'NFTokenMint') {
          const nftokenId = meta.nftoken_id || meta.NFTokenID || null;
          const hash = entry.hash || txData.hash || null;
          console.log(`[getNFTs] Found NFTokenMint — hash: ${hash}, nftoken_id: ${nftokenId}, meta keys: ${Object.keys(meta).join(',')}`);
          if (nftokenId && hash) {
            mintTxMap.set(nftokenId, hash);
          }
        }
      }
      console.log(`[getNFTs] Matched ${mintTxMap.size} mint txs out of ${txResponse.result.transactions?.length || 0} total txs`);

      for (const nft of nfts) {
        if (mintTxMap.has(nft.nftokenId)) {
          nft.mintTxHash = mintTxMap.get(nft.nftokenId);
        }
      }
    } catch (txErr) {
      console.error('[getNFTs] Could not fetch mint tx history:', txErr.message);
    }

    return nfts;
  } catch (err) {
    if (err.data && err.data.error === 'actNotFound') {
      return [];
    }
    throw err;
  } finally {
    await client.disconnect();
  }
}

module.exports = { generateWallet, airdropToWallet, sendPFT, getBalance, mintNFT, uploadToIPFS, getNFTs, loadWallet, PFT_TESTNET_WSS, PFT_NETWORK_ID };
