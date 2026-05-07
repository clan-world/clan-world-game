import { describe, expect, it } from 'vitest';
import { buildCockpitUrl, buildInjectionScript } from './webview-bridge';

// AC-V1 — pure-function unit tests for the WebView bridge. Hackathon scope:
// happy path + the two safety properties the slice spec calls out (no XSS,
// terminal `true;` for the Android contract).
describe('buildInjectionScript', () => {
  it('produces a script ending in `true;` and assigns window.__clanworld', () => {
    const out = buildInjectionScript({
      shell: 'react-native-android',
      walletPubkey: 'ABC123',
      followedClanId: 2,
      capabilities: ['haptics'],
    });
    expect(out).toMatch(/^window\.__clanworld = /);
    expect(out.trim().endsWith('true;')).toBe(true);
  });

  it('JSON-stringifies the payload (no raw interpolation)', () => {
    const out = buildInjectionScript({
      shell: 'react-native-android',
      walletPubkey: 'pkey-with-"-and-</script>-bytes',
      followedClanId: null,
      capabilities: [],
    });
    // Quotes inside the pubkey must appear escaped, not raw.
    expect(out).toContain('\\"');
    // The `</script>` token must appear inside the JSON string literal,
    // not as a literal raw HTML close that would break a hosting page.
    expect(out).not.toMatch(/\sclanworld[^"]*<\/script/);
  });

  it('rejects out-of-range followedClanId by emitting null', () => {
    const out = buildInjectionScript({
      shell: 'react-native-android',
      walletPubkey: null,
      followedClanId: 99,
      capabilities: [],
    });
    expect(out).toContain('"followedClanId":null');
  });

  it('rejects non-integer followedClanId', () => {
    const out = buildInjectionScript({
      shell: 'react-native-android',
      walletPubkey: null,
      followedClanId: 1.5,
      capabilities: [],
    });
    expect(out).toContain('"followedClanId":null');
  });

  it('passes valid 1..4 clanIds through unchanged', () => {
    for (const id of [1, 2, 3, 4]) {
      const out = buildInjectionScript({
        shell: 'react-native-android',
        walletPubkey: 'pk',
        followedClanId: id,
        capabilities: [],
      });
      expect(out).toContain(`"followedClanId":${id}`);
    }
  });
});

describe('buildCockpitUrl', () => {
  it('appends ?clanId=N when none present', () => {
    expect(buildCockpitUrl('https://demo.clan-world.com/cockpit', 3)).toBe(
      'https://demo.clan-world.com/cockpit?clanId=3',
    );
  });

  it('appends &clanId=N when ? already present', () => {
    expect(
      buildCockpitUrl('https://demo.clan-world.com/cockpit?foo=bar', 1),
    ).toBe('https://demo.clan-world.com/cockpit?foo=bar&clanId=1');
  });

  it('returns the base URL unchanged when no clan is followed', () => {
    expect(buildCockpitUrl('https://demo.clan-world.com/cockpit', null)).toBe(
      'https://demo.clan-world.com/cockpit',
    );
  });
});
