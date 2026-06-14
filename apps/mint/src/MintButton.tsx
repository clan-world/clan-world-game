import { useEffect, useRef, useState } from 'react';
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
  // Synchronous re-entry lock: a rapid second click can fire before React
  // re-renders the disabled button, so a state flag alone isn't enough.
  const mintingRef = useRef(false);

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
    // Synchronous re-entry guard (a second rapid click runs before React
    // re-renders the disabled button), then set minting state before any await.
    if (!suiWallet || mintingRef.current) return;
    mintingRef.current = true;
    setState({ status: 'minting' });
    try {
      // Mainnet guard — authoritative live check (the displayed activeNetwork
      // can be stale after an in-session network switch). Inside the try so a
      // getActiveNetwork() rejection surfaces as an error state.
      const net = await suiWallet.getActiveNetwork();
      setActiveNetwork(net);
      if (net !== MAINNET_NETWORK) {
        setState({
          status: 'error',
          message: 'Switch your wallet to Sui mainnet to mint.',
        });
        return;
      }

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
    } finally {
      mintingRef.current = false;
    }
  }

  return (
    <div className="mint">
      <button
        className="mint-btn"
        onClick={handleMint}
        disabled={!connected || minting}
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
