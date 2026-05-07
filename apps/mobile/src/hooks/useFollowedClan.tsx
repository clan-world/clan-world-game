import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  clearFollowedClan,
  loadFollowedClan,
  saveFollowedClan,
} from '@/lib/secure-store';

/**
 * The user's locally-claimed clan. There is no server-side ownership model
 * yet (the Convex schema's `clanView.owner` is the EVM address that minted
 * the iNFT — the Solana pubkey has no relation to it). "Following" is a
 * pure UI affordance: it picks which clan the WebView Cockpit and the
 * Codex screen highlight as "yours." Backed by secure-store so it survives
 * cold launches.
 */

type Ctx = {
  clanId: number | null;
  /** True until the on-mount secure-store read resolves. */
  hydrating: boolean;
  follow: (clanId: number) => Promise<void>;
  unfollow: () => Promise<void>;
};

const FollowCtx = createContext<Ctx | null>(null);

export function FollowedClanProvider({ children }: { children: ReactNode }) {
  const [clanId, setClanId] = useState<number | null>(null);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await loadFollowedClan();
        if (!cancelled) setClanId(stored);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const follow = useCallback(async (next: number) => {
    await saveFollowedClan(next);
    setClanId(next);
  }, []);

  const unfollow = useCallback(async () => {
    await clearFollowedClan();
    setClanId(null);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ clanId, hydrating, follow, unfollow }),
    [clanId, hydrating, follow, unfollow],
  );

  return <FollowCtx.Provider value={value}>{children}</FollowCtx.Provider>;
}

export function useFollowedClan(): Ctx {
  const ctx = useContext(FollowCtx);
  if (!ctx) {
    throw new Error('useFollowedClan must be used inside <FollowedClanProvider>');
  }
  return ctx;
}
