import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  connectWallet as mwaConnect,
  disconnectWallet as mwaDisconnect,
  reauthorizeWallet,
  MwaError,
} from '@/lib/mwa';
import {
  clearSession,
  loadSession,
  saveSession,
} from '@/lib/secure-store';

type WalletStatus = 'idle' | 'connecting' | 'connected' | 'error';

type WalletState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'connected'; pubkey: string; authToken: string }
  | { status: 'error'; error: MwaError };

type WalletContext = {
  state: WalletState;
  /** True until the cold-launch reauthorize attempt completes. */
  hydrating: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const Ctx = createContext<WalletContext | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({ status: 'idle' });
  const [hydrating, setHydrating] = useState(true);

  // Cold-launch silent reauthorize (AC-W3).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await loadSession();
        if (!stored) return;
        const fresh = await reauthorizeWallet(stored.authToken);
        // Tokens may rotate on reauthorize; persist the latest.
        if (fresh.authToken !== stored.authToken) {
          await saveSession(fresh);
        }
        if (!cancelled) {
          setState({
            status: 'connected',
            pubkey: fresh.pubkey,
            authToken: fresh.authToken,
          });
        }
      } catch (err) {
        // Bad/expired token — clear and fall back to Connect screen.
        await clearSession();
        if (!cancelled && err instanceof MwaError && err.tag !== 'UserDeclined') {
          // Don't surface as visible error on cold launch — user just sees Connect.
        }
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setState({ status: 'connecting' });
    try {
      const result = await mwaConnect();
      await saveSession(result);
      setState({
        status: 'connected',
        pubkey: result.pubkey,
        authToken: result.authToken,
      });
    } catch (err) {
      const mwaErr = err instanceof MwaError ? err : new MwaError('Unknown', String(err));
      setState({ status: 'error', error: mwaErr });
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (state.status === 'connected') {
      await mwaDisconnect(state.authToken);
    }
    await clearSession();
    setState({ status: 'idle' });
  }, [state]);

  const value = useMemo<WalletContext>(
    () => ({ state, hydrating, connect, disconnect }),
    [state, hydrating, connect, disconnect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useWallet must be used inside <WalletProvider>');
  }
  return ctx;
}

export type { WalletState, WalletStatus };
