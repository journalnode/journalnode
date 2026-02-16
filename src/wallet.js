const xrpl = require('xrpl');
const bip39 = require('bip39');

const PFT_TESTNET_WSS = 'wss://rpc.testnet.postfiat.org';
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
async function airdropToWallet(destinationAddress) {
  const masterSeed = process.env.PFT_MASTER_SEED;
  if (!masterSeed) {
    throw new Error('PFT_MASTER_SEED is not set in environment variables.');
  }

  const client = new xrpl.Client(PFT_TESTNET_WSS);
  await client.connect();

  try {
    const masterWallet = loadWallet(masterSeed);

    const payment = {
      TransactionType: 'Payment',
      Account: masterWallet.classicAddress,
      Destination: destinationAddress,
      Amount: xrpl.xrpToDrops(AIRDROP_AMOUNT),
      NetworkID: PFT_NETWORK_ID,
    };

    const prepared = await client.autofill(payment);
    const signed = masterWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const txResult = result.result.meta.TransactionResult;
    if (txResult !== 'tesSUCCESS') {
      throw new Error(`Transaction failed: ${txResult}`);
    }

    return {
      txHash: signed.hash,
      amount: AIRDROP_AMOUNT,
      masterAddress: masterWallet.classicAddress,
    };
  } finally {
    await client.disconnect();
  }
}

module.exports = { generateWallet, airdropToWallet, loadWallet, PFT_TESTNET_WSS, PFT_NETWORK_ID };
