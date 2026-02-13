const xrpl = require('xrpl');

const PFT_TESTNET_WSS = 'wss://rpc.testnet.postfiat.org:6007';
const PFT_NETWORK_ID = 2025;
const AIRDROP_AMOUNT = process.env.PFT_AIRDROP_AMOUNT || '50';

/**
 * Generate a new Post Fiat wallet (keypair + address).
 */
function generateWallet() {
  const wallet = xrpl.Wallet.generate();
  return {
    address: wallet.classicAddress,
    seed: wallet.seed,
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
    const masterWallet = xrpl.Wallet.fromSeed(masterSeed);

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

module.exports = { generateWallet, airdropToWallet, PFT_TESTNET_WSS, PFT_NETWORK_ID };
