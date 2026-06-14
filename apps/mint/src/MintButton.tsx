import { useEffect, useState } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { isSuiWallet } from '@dynamic-labs/sui';
import { Transaction } from '@mysten/sui/transactions';

const MINT_TARGET =
  '0xe7761942e5dab75ba7fd9b6b1a21e5e5fea092f816f0bbb3d45e2b59366554c1::clan_logo_nft::mint';

// Wallet Standard reports Sui networks as `sui:<network>`, e.g. `sui:mainnet`.
const MAINNET_NETWORK = 'sui:mainnet';

type MintState =
  | { status: 'idle' }
  | { status: 'minting' }
  | { status: 'success'; digest: string }
  | { status: 'error'; message: string };

export default function MintButton() {
  const { primaryWallet } = useDynamicContext();
  const [state, setState] = useState<MintState>({ status: 'idle' });
  // undefined = not yet known; otherwise the `sui:<network>` string.
  const [activeNetwork, setActiveNetwork] = useState<string | undefined>(
    undefined,
  );

  const suiWallet =
    primaryWallet && isSuiWallet(primaryWallet) ? primaryWallet : null;
  const connected = !!suiWallet;
  const minting = state.status === 'minting';
  const wrongNetwork =
    connected && activeNetwork !== undefined && activeNetwork !== MAINNET_NETWORK;

  // Track the wallet's active network so we can gate minting to mainnet.
  useEffect(() => {
    let cancelled = false;
    if (!suiWallet) {
      setActiveNetwork(undefined);
      return;
    }
    suiWallet
      .getActiveNetwork()
      .then((net) => {
        if (!cancelled) setActiveNetwork(net);
      })
      .catch(() => {
        if (!cancelled) setActiveNetwork(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [suiWallet]);

  async function handleMint() {
    if (!suiWallet) return;

    // Mainnet guard — never attempt a mint on the wrong network.
    const net = await suiWallet.getActiveNetwork();
    setActiveNetwork(net);
    if (net !== MAINNET_NETWORK) {
      setState({
        status: 'error',
        message: 'Switch your wallet to Sui mainnet to mint.',
      });
      return;
    }

    setState({ status: 'minting' });
    try {
      const tx = new Transaction();
      tx.moveCall({ target: MINT_TARGET, arguments: [] });

      const result = await suiWallet.signAndExecuteTransaction({
        transaction: tx,
      });

      const digest = result.digest;
      if (!digest) throw new Error('No transaction digest returned.');

      // A returned digest does NOT mean the tx succeeded — confirm effects.
      const client = await suiWallet.getSuiClient();
      if (!client) {
        throw new Error('Could not reach the Sui network to confirm the mint.');
      }
      const confirmed = await client.waitForTransaction({
        digest,
        options: { showEffects: true },
      });
      const txStatus = confirmed.effects?.status?.status;
      if (txStatus !== 'success') {
        throw new Error(
          `Mint failed on-chain (status: ${txStatus ?? 'unknown'}).`,
        );
      }

      setState({ status: 'success', digest });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="mint">
      <button
        className="mint-btn"
        onClick={handleMint}
        disabled={!connected || minting || wrongNetwork}
      >
        {minting
          ? 'Minting…'
          : !connected
            ? 'Connect a Sui wallet'
            : wrongNetwork
              ? 'Switch to Sui mainnet'
              : 'Free Mint'}
      </button>

      {wrongNetwork && (
        <p className="mint-result error">Switch your wallet to Sui mainnet.</p>
      )}

      {state.status === 'success' && (
        <p className="mint-result success">
          Minted!{' '}
          <a
            href={`https://suiscan.xyz/mainnet/tx/${state.digest}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
          </a>
        </p>
      )}

      {state.status === 'error' && (
        <p className="mint-result error">{state.message}</p>
      )}
    </div>
  );
}
