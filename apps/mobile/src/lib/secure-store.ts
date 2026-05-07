import * as SecureStore from 'expo-secure-store';

/**
 * Encrypted persistence for the MWA auth token + the user's locally-claimed
 * clanId ("Follow"). expo-secure-store wraps Android Keystore so the token
 * never leaves the device unencrypted.
 *
 * Keep keys short and stable — renaming them invalidates existing installs.
 */

const KEY_AUTH_TOKEN = 'cw.mwa.authToken';
const KEY_PUBKEY = 'cw.mwa.pubkey';
const KEY_FOLLOWED_CLAN = 'cw.followedClanId';

export type StoredSession = {
  authToken: string;
  pubkey: string;
};

export async function loadSession(): Promise<StoredSession | null> {
  const [authToken, pubkey] = await Promise.all([
    SecureStore.getItemAsync(KEY_AUTH_TOKEN),
    SecureStore.getItemAsync(KEY_PUBKEY),
  ]);
  if (!authToken || !pubkey) return null;
  return { authToken, pubkey };
}

export async function saveSession(session: StoredSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_AUTH_TOKEN, session.authToken),
    SecureStore.setItemAsync(KEY_PUBKEY, session.pubkey),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_AUTH_TOKEN),
    SecureStore.deleteItemAsync(KEY_PUBKEY),
  ]);
}

export async function loadFollowedClan(): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(KEY_FOLLOWED_CLAN);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : null;
}

export async function saveFollowedClan(clanId: number): Promise<void> {
  if (!Number.isInteger(clanId) || clanId < 1 || clanId > 4) {
    throw new Error(`invalid clanId for follow: ${clanId}`);
  }
  await SecureStore.setItemAsync(KEY_FOLLOWED_CLAN, String(clanId));
}

export async function clearFollowedClan(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_FOLLOWED_CLAN);
}
