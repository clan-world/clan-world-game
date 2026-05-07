# Slice 0 — Mobile Spectator: Handoff

**Branch:** `feat/slice-0-mobile-scaffold` (off `dev-phase-0-mobile-spectator`)
**Spec:** `artifacts/implementation/slice-0-mobile-spectator.md`
**EAS project:** [`@mikail_18/clan-world-mobile`](https://expo.dev/accounts/mikail_18/projects/clan-world-mobile) (ID `e220b061-5a38-444a-9d29-7dd8684df0f5`)

## What's done

All 8 phases of slice 0 implemented and locally verified. Static gates green:

| Gate | Status |
|---|---|
| TypeScript strict typecheck | ✅ |
| `expo-doctor` — 17/17 checks | ✅ |
| Vitest unit suite — 17/17 cases | ✅ |
| `expo export` Android Hermes bundle (4.77 MB) | ✅ |
| Cockpit-token visual contract | ✅ self-audit; user verifies on device |

## Walking the four tabs

| Tab | What it shows | Source |
|---|---|---|
| **Hearth** | Live tick + season number + season-progress bar + last on-chain event | `api.getSnapshot.getSnapshot` + `api.events.getRecentChainEvents` |
| **Hall** | Four ElderCards (Storm Riders / Iron Guard / Crimson / Verdant Wardens) with iNFT token, owner, dataHash + Follow toggle | `api.inft.getInftDemoState({ clanId })` for clanIds 1-4 |
| **Cockpit** | Full-screen WebView at `demo.clan-world.com/cockpit?clanId={followed}` with `window.__clanworld` injected | The followed clan from secure-store |
| **Codex** | Wallet pubkey + network + adapter; followed clan + Unfollow; Convex hostname; device kind; Disconnect | All hooks |

## Runtime verification — what you do next

The four runtime ACs (`AC-W2`, `AC-W3`, `AC-W4`, `AC-V2`, `AC-S2`, `AC-B2`, `AC-B3`) need a real Android device. Here's the 11-step verification script from the slice spec §4 — run this against a Pixel 7 emulator (or real Seeker if available) with Phantom installed and switched to **devnet**.

### Setup (one-time)

```bash
# Pixel 7 ARM64 emulator (any Android Studio AVD with API 34 will do).
# Install Phantom from the Play Store inside the emulator.
# Open Phantom → Settings → Developer → switch network to devnet.

cd /Users/mikail/Desktop/clan-world-v3/apps/mobile
pnpm install
pnpm prebuild         # generates apps/mobile/android/
pnpm android          # builds + installs the dev build on the connected emulator
```

`pnpm android` opens the dev menu and connects Metro. If Metro isn't already running, it starts it for you.

### The 11-step script

1. Wipe the app's data on the emulator. Cold launch.
2. Confirm splash → Connect screen, **Cinzel "Clan World"** headline rendered, void background, "Connect Wallet" parchment button visible.
3. Tap Connect. Confirm Phantom launches, you approve, app routes to **Hearth**.
4. **Hearth**: confirm a non-zero tick counter, an "S{n}" season label, and a last-event row. Wait one tick interval (≤30s on the dev deployment) and confirm tick increments without taps.
5. Switch to **Hall**: confirm four ElderCards (Storm Riders / Iron Guard / Crimson / Verdant Wardens) with their respective accents and glyphs, each with non-empty owner and dataHash.
6. Tap **Follow** on Iron Guard (clanId=2). Confirm the visual selection state (vellum-gold filled "Following" pill).
7. Switch to **Cockpit**: confirm the WebView loads `demo.clan-world.com/cockpit?clanId=2`, the live cockpit chrome appears. Open Chrome remote DevTools (`chrome://inspect/#devices`) → click **inspect** on the WebView → console:
   - `window.__clanworld` should evaluate to `{ shell: 'react-native-android', walletPubkey: '<your pubkey>', followedClanId: 2, capabilities: ['haptics'] }` — and be **frozen** (`Object.isFrozen(window.__clanworld) === true`).
   - No JS errors at load (the cockpit's MiniKit init may emit a warn — that's a documented known-issue per slice spec §10.3, not a blocker).
8. Switch to **Codex**: confirm pubkey rendered (truncated mid-ellipsis), network shows `devnet`, **Convex host** shows `valuable-kudu-985.convex.cloud`, device kind shows `Generic Android`.
9. Force-quit the app. Relaunch. Confirm app boots straight to Hearth (no Connect screen — silent reauthorize).
10. Codex → **Disconnect Wallet**. Confirm route back to Connect with no cached auth.
11. Reconnect; confirm Phantom prompts again (fresh authorize, not silent reauthorize).

Pass = all 11 steps pass without intervention.

### EAS preview build

When you want a shareable APK (e.g., for the hackathon submission), kick off the cloud build:

```bash
pnpm --filter @clan-world/mobile build:preview
```

This runs the `preview` profile from `eas.json`. EAS will queue the build (5-30 min depending on load) and give you an install link. Install that on a clean Pixel 7 emulator and re-run the 11-step script as the final acceptance.

## Known issues / deferrals

Captured here so they don't get rediscovered:

1. **Cockpit's MiniKit init throws inside the WebView** — the cockpit unconditionally calls `MiniKit.install()` at boot, which fails when the WebView isn't running inside the World App. Deferred per slice spec §10.3; non-blocking. Fix: gate MiniKit on `!window.__clanworld?.shell` in a follow-up cockpit PR.
2. **Splash + icon artwork** — `app.json` references no image assets in slice 0. Add real splash + icon before the EAS preview build.
3. **iNFT ownership story** — `inftTokens.owner` is an EVM address. The user's Solana pubkey has no relation. The "Follow" toggle is local-only; no cross-chain ownership claim is made. Real per-user ownership lands in a future slice that defines the Solana↔Base mapping.
4. **No signed mutations yet** — `signMessage` and `signAndSendTransactions` are wired in `src/lib/mwa.ts` and ready for the next slice (Sigil Forge mint, hire, whisper, strategy save).
5. **No push notifications, no widget, no Bazaar/Treasury UI** — explicit slice 0 deferrals per §9.

## What to ask of me when you pick this back up

When the runtime verification surfaces issues, send me:

- The exact step number that failed
- A screenshot from the emulator
- The relevant lines from `chrome://inspect` console (especially for AC-V2)
- Whether Phantom is on devnet (the most common cause of authorize() returning the wrong cluster)

I'll iterate from there.
