import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import type { Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey } from '@solana/web3.js';
import type { Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * Single seam between the app and the Solana Mobile Wallet Adapter. Every
 * signing path on every chain goes through this file — no `transact` calls
 * elsewhere. The wrapper normalizes errors into a closed tagged union so
 * callers don't have to interpret library-specific exception shapes.
 */

const APP_IDENTITY = {
  name: 'Clan World',
  uri: 'https://clan-world.com',
  // Phantom + Seeker wallet treat this as a hint; falls back to slug if absent.
  icon: '/favicon.ico',
} as const;

export const SOLANA_CLUSTER = 'devnet' as const;
export type SolanaCluster = typeof SOLANA_CLUSTER;

export type MwaErrorTag =
  | 'UserDeclined'
  | 'WalletUnavailable'
  | 'AuthorizationExpired'
  | 'Unknown';

export class MwaError extends Error {
  override readonly name = 'MwaError';
  readonly tag: MwaErrorTag;
  override readonly cause?: unknown;
  constructor(tag: MwaErrorTag, message: string, cause?: unknown) {
    super(message);
    this.tag = tag;
    this.cause = cause;
  }
}

export type AuthorizeResult = {
  pubkey: string;
  authToken: string;
};

/**
 * Maps library-thrown errors into the tagged set above. Exported for unit
 * tests (AC-W1).
 */
export function classifyMwaError(err: unknown): MwaError {
  if (err instanceof MwaError) return err;
  const message = err instanceof Error ? err.message : String(err);

  // The MWA library surfaces user-cancellation as a generic error whose
  // message contains either "decline" or "user_cancel" depending on which
  // wallet rejected.
  if (/declin|cancel|user.?reject/i.test(message)) {
    return new MwaError('UserDeclined', 'User declined the wallet request', err);
  }
  if (/no compatible wallets|wallet.*unavailable|installed/i.test(message)) {
    return new MwaError(
      'WalletUnavailable',
      'No compatible Solana mobile wallet is installed',
      err,
    );
  }
  if (/authorization.*expired|reauthorize|invalid.*auth.*token/i.test(message)) {
    return new MwaError(
      'AuthorizationExpired',
      'Stored authorization is no longer valid',
      err,
    );
  }
  return new MwaError('Unknown', message, err);
}

async function withWallet<T>(
  fn: (wallet: Web3MobileWallet) => Promise<T>,
): Promise<T> {
  try {
    return await transact(fn);
  } catch (err) {
    throw classifyMwaError(err);
  }
}

/**
 * First-time authorize. Pops the wallet UI; user picks an account. Returns
 * the pubkey (base58) and the auth token to store.
 */
export async function connectWallet(): Promise<AuthorizeResult> {
  return withWallet(async (wallet) => {
    const auth = await wallet.authorize({
      cluster: SOLANA_CLUSTER,
      identity: APP_IDENTITY,
    });
    const account = auth.accounts[0];
    if (!account) {
      throw new MwaError(
        'WalletUnavailable',
        'authorize() returned no accounts',
      );
    }
    const pubkey = new PublicKey(toUint8Array(account.address)).toBase58();
    return { pubkey, authToken: auth.auth_token };
  });
}

/**
 * Silent reauthorize. Used on cold launch when we have a stored token. If
 * the wallet has revoked the token (or the user uninstalled the wallet),
 * this throws AuthorizationExpired and the caller should clear and re-prompt.
 */
export async function reauthorizeWallet(
  authToken: string,
): Promise<AuthorizeResult> {
  return withWallet(async (wallet) => {
    const auth = await wallet.reauthorize({
      auth_token: authToken,
      identity: APP_IDENTITY,
    });
    const account = auth.accounts[0];
    if (!account) {
      throw new MwaError(
        'AuthorizationExpired',
        'reauthorize() returned no accounts',
      );
    }
    const pubkey = new PublicKey(toUint8Array(account.address)).toBase58();
    return { pubkey, authToken: auth.auth_token };
  });
}

/**
 * Best-effort revoke. Some wallets accept deauthorize, others don't — this
 * always succeeds locally even if the wallet rejects, since the caller will
 * clear the stored token regardless.
 */
export async function disconnectWallet(authToken: string): Promise<void> {
  try {
    await transact(async (wallet) => {
      await wallet.deauthorize({ auth_token: authToken });
    });
  } catch {
    // Swallow — local clear in the caller is the source of truth.
  }
}

/**
 * Sign an arbitrary message. Used for the Convex sign-in challenge once
 * Phase 3+ wires per-user auth. Slice 0 reads are public so this isn't on
 * the critical path yet — shipped now so later phases just compose.
 */
export async function signMessage(
  authToken: string,
  message: Uint8Array,
): Promise<Uint8Array> {
  return withWallet(async (wallet) => {
    const auth = await wallet.reauthorize({
      auth_token: authToken,
      identity: APP_IDENTITY,
    });
    const account = auth.accounts[0];
    if (!account) {
      throw new MwaError('AuthorizationExpired', 'no account on reauthorize');
    }
    const result = await wallet.signMessages({
      addresses: [account.address],
      payloads: [message],
    });
    const signed = result[0];
    if (!signed) {
      throw new MwaError('Unknown', 'signMessages returned no payload');
    }
    return signed;
  });
}

/**
 * Sign + send transactions. Used by all on-chain mutations in later slices
 * (Sigil Forge mint, hire, etc.). Slice 0 ships the wrapper so when a later
 * slice needs it, the seam already exists.
 */
export async function signAndSendTransactions(
  authToken: string,
  transactions: ReadonlyArray<Transaction | VersionedTransaction>,
): Promise<string[]> {
  return withWallet(async (wallet) => {
    await wallet.reauthorize({
      auth_token: authToken,
      identity: APP_IDENTITY,
    });
    const signatures = await wallet.signAndSendTransactions({
      transactions: [...transactions],
    });
    return signatures.map((sig) => Buffer.from(sig).toString('base64'));
  });
}

// MWA returns base64-encoded addresses; PublicKey wants a byte array.
function toUint8Array(base64OrBytes: string | Uint8Array): Uint8Array {
  if (base64OrBytes instanceof Uint8Array) return base64OrBytes;
  return new Uint8Array(Buffer.from(base64OrBytes, 'base64'));
}
