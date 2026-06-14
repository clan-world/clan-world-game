import { useState } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { isSuiWallet } from '@dynamic-labs/sui';
import { Transaction } from '@mysten/sui/transactions';

const MINT_TARGET =
  '0xe7761942e5dab75ba7fd9b6b1a21e5e5fea092f816f0bbb3d45e2b59366554c1::clan_logo_nft::mint';

type MintState =
  | { status: 'idle' }
  | { status: 'minting' }
  | { status: 'success'; digest: string }
  | { status: 'error'; message: string };

export default function MintButton() {
  const { primaryWallet } = useDynamicContext();
  const [state, setState] = useState<MintState>({ status: 'idle' });

  const suiWallet =
    primaryWallet && isSuiWallet(primaryWallet) ? primaryWallet : null;
  const connected = !!suiWallet;
  const minting = state.status === 'minting';

  async function handleMint() {
    if (!suiWallet) return;
    setState({ status: 'minting' });
    try {
      const tx = new Transaction();
      tx.moveCall({ target: MINT_TARGET, arguments: [] });

      const result = await suiWallet.signAndExecuteTransaction({
        transaction: tx,
      });

      const digest = result.digest;
      if (!digest) throw new Error('No transaction digest returned.');
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
        disabled={!connected || minting}
      >
        {minting ? 'Minting…' : connected ? 'Free Mint' : 'Connect a Sui wallet'}
      </button>

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
