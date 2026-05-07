/**
 * Cockpit ↔ shell bridge.
 *
 * Slice 0 only ships the *send* path: we inject a `window.__clanworld`
 * payload before the cockpit page loads so any future cockpit code that
 * wants to detect "running inside the mobile shell" can. The cockpit
 * itself is allowed to ignore the payload — slice 0 is a spectator
 * embedding, not an authenticated session.
 *
 * The receive path (postMessage from cockpit → shell, signature requests,
 * haptic relays) lands in a later slice when signed mutations are wired.
 */

export type ShellCapability = 'haptics' | 'notifications' | 'nativeNav';

export type ShellInjectionPayload = {
  shell: 'react-native-android';
  walletPubkey: string | null;
  followedClanId: number | null;
  capabilities: ReadonlyArray<ShellCapability>;
};

/**
 * Build the JS string that goes into `injectedJavaScriptBeforeContentLoaded`.
 *
 * Safety: payload is JSON-stringified so any string field with quotes,
 * angle brackets, or backslashes survives intact. The trailing `; true;` is
 * required by react-native-webview's contract — the script must end with a
 * truthy expression on Android, otherwise Chromium WebView swallows the
 * injection silently.
 */
export function buildInjectionScript(payload: ShellInjectionPayload): string {
  // Defensive cap on followedClanId — out-of-range or non-integer should
  // never reach here, but if it does we'd rather emit null than corrupt
  // window state.
  const sanitized: ShellInjectionPayload = {
    shell: 'react-native-android',
    walletPubkey:
      typeof payload.walletPubkey === 'string' && payload.walletPubkey.length > 0
        ? payload.walletPubkey
        : null,
    followedClanId:
      Number.isInteger(payload.followedClanId) &&
      payload.followedClanId !== null &&
      payload.followedClanId >= 1 &&
      payload.followedClanId <= 4
        ? payload.followedClanId
        : null,
    capabilities: payload.capabilities.slice(),
  };

  // JSON.stringify produces valid ES literal text that's also valid inside
  // a <script>. No interpolation of raw user strings into the JS body.
  return `window.__clanworld = ${JSON.stringify(sanitized)};\nObject.freeze(window.__clanworld);\ntrue;`;
}

/**
 * Build the URL the WebView loads, appending followedClanId as a query
 * param so the cockpit can route to the right clan even before the
 * injection script runs.
 */
export function buildCockpitUrl(
  baseUrl: string,
  followedClanId: number | null,
): string {
  if (followedClanId === null) return baseUrl;
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}clanId=${followedClanId}`;
}

export const SHELL_USER_AGENT_SUFFIX = 'ClanWorldMobile/0.1.0 (Android; ReactNative)';
