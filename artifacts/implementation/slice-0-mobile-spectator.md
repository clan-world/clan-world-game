# Slice 0 — Mobile Spectator with Wallet Attached

**Status:** drafted, awaiting user sign-off
**Owner:** Mikail
**Target:** Solana Mobile dApp Store / Easy A Hackathon submission
**Repo placement:** `apps/mobile/`
**Branch:** `dev-phase-0-mobile-spectator` → feature branches off it per Gitflow Light

---

## 1. Mission

Ship the thinnest vertical wrapper around the existing ClanWorld cockpit that proves the mobile architecture works end-to-end on an Android device (and Solana Seeker if available). One user journey, every layer touched, no fake layers.

This slice is **deliberately not** a feature-parity port of the design spec. It is the load-bearing skeleton. Every later slice (Sigil Forge, Whispers, Treasury, Widget, Push) thickens this skeleton.

---

## 2. The thin vertical (one user journey, end-to-end)

1. User installs the APK on a Pixel emulator (or Seeker).
2. Cold boot → splash → **Connect Wallet** screen.
3. Tap connect → Mobile Wallet Adapter prompts the installed wallet (Phantom on Pixel, Seeker Wallet on Seeker) on devnet → returns a Solana pubkey + auth token.
4. Auth token persisted via `expo-secure-store`. Pubkey shown briefly, app routes to the tab shell.
5. **Hearth tab** — live `worldSnapshot` fields (current tick, season number, season progress bar, last `chainEvents` row) update in real time via Convex `useQuery`. No polling.
6. **Hall tab** — four ElderCard rows (one per clan, ids 1-4), each showing tokenId, clanId, archetype, accent-tinted glyph, owner address (short), dataHash (short), last update. A "Follow" toggle per row stores the chosen `clanId` in `expo-secure-store` (the local "claim").
7. **Cockpit tab** — full-screen WebView at `https://demo.clan-world.com/cockpit?clanId={followedClanId}` with `window.__clanworld = { shell, walletPubkey, followedClanId, capabilities }` injected via `injectedJavaScriptBeforeContentLoaded`. The cockpit ignores the injection for now; we only verify it reached the page and the WebView rendered.
8. **Codex tab (settings)** — shows wallet pubkey, network (devnet), Convex deployment ID, detected device kind (`Seeker` vs `Generic Android`), and a Disconnect button.
9. On relaunch — `reauthorize` is attempted with the stored auth token; success → straight to tabs. Failure → back to Connect.

That is the slice. No mutations. No push. No widget. No bridge. No shared-types extraction. No new Convex schema.

---

## 3. Acceptance criteria (one assertion per layer; visual criteria called out)

Each AC is suffixed with its test tier — `[unit]`, `[integration]`, `[e2e]`, `[runtime]`, `[visual]`. Per global TDD Mandate, each must have a green check before sign-off.

### Build & install

- `AC-B1 [runtime]` `pnpm --filter @clan-world/mobile expo prebuild` produces an `android/` directory with no errors.
- `AC-B2 [runtime]` `eas build --profile preview --platform android` produces an APK; APK installs cleanly on a fresh Pixel 7 emulator.
- `AC-B3 [runtime]` Cold launch from icon tap to first interactive screen ≤ 4s on Pixel emulator.

### MWA / wallet

- `AC-W1 [unit]` `connectWallet()` returns `{ pubkey: string, authToken: string }` shape; mocked transport scenarios produce typed errors (`UserDeclined`, `WalletUnavailable`, `Unknown`).
- `AC-W2 [runtime]` On a Pixel emulator with Phantom (devnet) installed, tapping Connect launches Phantom, returns the pubkey, and persists the auth token to `expo-secure-store`.
- `AC-W3 [runtime]` Killing and relaunching the app skips Connect and goes straight to Hearth (reauthorize succeeds silently).
- `AC-W4 [runtime]` Tapping Disconnect in Codex clears secure-store, routes back to Connect, and a fresh Connect requires the wallet UI again.

### Convex

- `AC-C1 [integration]` Convex client initializes against `EXPO_PUBLIC_CONVEX_URL`; `useQuery(api.getSnapshot.getSnapshot)` returns a defined object within 2s of mount.
- `AC-C2 [runtime]` Forcing a tick advance on the dev Convex deployment causes Hearth's tick counter to update without app interaction.
- `AC-C3 [integration]` `useQuery(api.inft.getInftDemoState, { clanId: N })` for N ∈ {1,2,3,4} returns the four rows in <2s.

### WebView

- `AC-V1 [unit]` `buildInjectionScript({ pubkey, followedClanId, capabilities })` returns a string ending in `; true;` and includes a JSON-stringified payload with no XSS-vulnerable interpolation.
- `AC-V2 [runtime]` Cockpit tab loads `demo.clan-world.com/cockpit` inside the WebView; Chrome remote DevTools (or `read_console_messages` via Claude in Chrome) shows `window.__clanworld` populated with the expected fields and zero JS errors at load.

### Seeker detection

- `AC-S1 [unit]` `detectDeviceKind()` returns `'seeker'` when Solana Mobile Stack capability indicators are present, `'generic-android'` otherwise.
- `AC-S2 [runtime]` On a Pixel emulator, Codex shows `Generic Android`. (Seeker hardware verification deferred — documented limitation if device unavailable.)

### Visual / UX (mandatory per TDD Mandate; cockpit thematic consistency is the load-bearing constraint)

- `AC-U1 [visual]` All screens use `tokens.bg.void` (`#0a0a0a`) as page background, parchment-on-iron panels (`tokens.bg.parchment` over `tokens.border.iron`), and the four Elder accents from `ELDERS` for clan-specific chrome — verified against `apps/web/src/styles/cockpit-tokens.ts`.
- `AC-U2 [visual]` Display copy uses Cinzel; numerics (tick counter, balances, hashes) use JetBrains Mono; body uses Inter or system-ui fallback. Fonts loaded via `expo-font` with the same family declarations as cockpit-tokens.
- `AC-U3 [visual]` Hall ElderCard reuses the cockpit's parchment-card visual idiom: warm aged-paper face, iron-coloured hairline border, accent-tinted left edge, glyph in display font, archetype in italic body text, hashes in mono.
- `AC-U4 [visual]` Tab bar is iron-deep (`tokens.bg.ironDeep`) with vellum-gold (`tokens.text.accent`) for the active tab — matches the cockpit's tab strip aesthetic; no generic Material-blue.
- `AC-U5 [visual]` Connect screen leads with a single Cinzel headline ("Enter the realm.") on void background, no busy chrome — matches cockpit's launch-state visual restraint.

### Persistence

- `AC-P1 [unit]` `followedClanId` persists across app restarts and is the value injected into the cockpit WebView URL.
- `AC-P2 [unit]` Toggling Follow on a different ElderCard updates the persisted value and the next cockpit-tab open uses the new clanId.

---

## 4. Runtime verification script (the "user-walked" sequence)

Verifier runs this end-to-end against the installed APK before sign-off:

1. Wipe the app's data on the emulator. Cold launch.
2. Confirm splash → Connect screen, Cinzel headline rendered, void background.
3. Tap Connect. Confirm Phantom launches, auth approves, app routes to Hearth.
4. On Hearth: confirm a non-zero tick counter, a season label, and a last-event row. Wait one tick interval (≤30s for dev) and confirm tick increments without taps.
5. Switch to Hall: confirm four ElderCards (Storm Riders / Iron Guard / Crimson / Verdant Wardens) with their respective accents and glyphs, each with non-empty owner and dataHash.
6. Tap Follow on Iron Guard (clanId=2). Confirm visual selection state.
7. Switch to Cockpit: confirm the WebView loads `demo.clan-world.com/cockpit?clanId=2`, the live cockpit chrome appears, no JS errors in `read_console_messages`, and `window.__clanworld.followedClanId === 2` evaluated via `evaluate_script`.
8. Switch to Codex: confirm pubkey rendered (truncated mid-ellipsis), network shows `devnet`, device kind shows `Generic Android`.
9. Force-quit the app. Relaunch. Confirm app boots straight to Hearth (no Connect screen).
10. Codex → Disconnect. Confirm route back to Connect screen with no cached auth.
11. Reconnect; confirm Phantom prompts again (fresh authorize, not silent reauthorize).

Pass = all 11 steps pass without intervention.

---

## 5. Test-scope assignment summary

| Tier | What's covered |
|---|---|
| **Unit** (vitest) | `connectWallet` typed-error mapping, `buildInjectionScript`, `detectDeviceKind`, `followedClanId` persistence helpers |
| **Integration** (`@effect/vitest` not applicable here — frontend; vitest with mocked Convex) | Convex client init, `useQuery` shape contracts for the three queries we read |
| **E2E** (Maestro or Detox — pick during scaffold; default Maestro for Expo simplicity) | Full 11-step verification script as scripted flow |
| **Runtime** | Builder runs the APK on a Pixel emulator with Phantom (devnet) installed; verifier re-runs on a clean emulator |
| **Visual** | Verifier compares each screen against `cockpit-tokens.ts` palette + a side-by-side screenshot against the relevant cockpit panel |

E2E framework choice (Maestro vs Detox) is a sub-decision inside Phase 1 of implementation; default is Maestro for lowest setup cost on Expo dev builds. Hackathon rule: minimal tests only — happy path + the explicit rejection cases enumerated in `AC-W1`.

---

## 6. Visual/UX criteria detail (the cockpit-consistency constraint)

The mobile shell must read as "the cockpit's mobile sibling," not "a generic mobile app that talks to the cockpit." Concrete rules:

1. **Palette is `cockpit-tokens.ts` verbatim.** Import the token file; do not redefine values. RN equivalents:
   - `bg.void` → root `View` background
   - `bg.parchment`/`bg.parchmentDim` → card faces
   - `border.iron`/`border.ironLight` → 1px borders
   - `text.accent` (`#d4a544`) → active tabs, tick counter glow, follow-selected state
   - `ELDERS[i].accent` → per-clan chrome accent
2. **Typography.**
   - Display: Cinzel (load via `expo-font` from Google Fonts).
   - Mono: JetBrains Mono (same).
   - Body: Inter (same).
   - No Cormorant or EB Garamond for slice 0 (deferred — design spec wants them but cockpit doesn't use them, so we match cockpit not the spec).
3. **Tab bar.** Custom — not `@react-navigation/bottom-tabs` default. Iron-deep background, no shadow above the bar (use a top hairline `border.iron` instead), Cinzel uppercase labels at 11px with 0.15em letter-spacing, vellum-gold accent on active.
4. **ElderCard visual.** Mirror the existing `MiniCockpit` panel chrome: parchment face, 4px-wide accent stripe on the left edge in the elder's accent color, iron border, Cinzel name + italic Inter archetype + mono hashes.
5. **Connect screen.** Void background, single Cinzel headline centered, single primary button styled as a parchment-faced rectangle with iron border. No gradient, no logo splash, no decorative chrome. Match the cockpit's launch-state restraint.
6. **No Material-blue, no Tailwind defaults, no rounded-pill buttons.** Radii are `tokens.radius.sm` (2px) or `tokens.radius.md` (4px) — "hand-cut, not pillowy."

A visual-audit sub-agent (`frontend-test-engineer` per the global TDD Mandate) compares each screen against the cockpit-tokens reference before sign-off.

---

## 7. Stack for the slice

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Expo SDK 52 (or latest stable), TypeScript strict | Matches monorepo strictness; dev builds support MWA + native modules |
| Routing | Expo Router | Required by brief; gets deep linking and typed routes for free |
| Wallet | `@solana-mobile/mobile-wallet-adapter-protocol-mobile` + `@solana/web3.js` | Non-negotiable per brief and Solana Mobile track |
| Backend client | `convex` + `convex/react` | Reuse the live Convex deployment; no new project |
| WebView | `react-native-webview` | Required for cockpit embedding |
| Storage | `expo-secure-store` (auth token + followedClanId) | Encrypted, the standard Expo idiom |
| Native tactile | `expo-haptics` | Wired now for Connect-success haptic; broader use lands in later slices |
| Status / splash | `expo-status-bar` + `expo-splash-screen` | Standard Expo |
| Fonts | `expo-font` + `@expo-google-fonts/cinzel` + `@expo-google-fonts/jetbrains-mono` + `@expo-google-fonts/inter` | Match cockpit-tokens font stack |
| Linking | `expo-linking` | Establish `clanworld://` scheme now (Glance widget will use it later) |
| Build | EAS preview profile | What the hackathon submission will use |
| Styling | Inline styles imported from a mirrored `tokens.ts` | Match cockpit's inline-token approach; no Tailwind/NativeWind dep yet |

**Explicitly NOT in slice 0:** NativeWind, MMKV, expo-notifications, expo-task-manager, expo-background-fetch, expo-clipboard, react-native-reanimated (beyond what Expo Router transitively needs), react-native-svg, lucide-react-native, Bonfida SNS, spl-token, Glance / Kotlin. Each of these earns its place in a later slice when the feature it supports lands.

---

## 8. Module structure (slice 0 only — much smaller than the brief's full layout)

```
apps/mobile/
├── app/                            # Expo Router
│   ├── _layout.tsx                 # ConvexProvider, font load, splash control
│   ├── index.tsx                   # Routes: Connect if no auth, else Hearth
│   ├── connect.tsx                 # Connect Wallet screen
│   └── (tabs)/
│       ├── _layout.tsx             # Custom tab bar
│       ├── hearth.tsx
│       ├── hall.tsx
│       ├── cockpit.tsx
│       └── codex.tsx
├── src/
│   ├── theme/
│   │   ├── tokens.ts               # Mirror of cockpit-tokens.ts (no behavior, just palette/font)
│   │   └── elders.ts               # Mirror of ELDERS array
│   ├── lib/
│   │   ├── convex.ts               # Convex client + provider
│   │   ├── mwa.ts                  # connect / reauthorize / disconnect
│   │   ├── secure-store.ts         # authToken + followedClanId persistence
│   │   ├── webview-bridge.ts       # buildInjectionScript only (no postMessage handling yet)
│   │   ├── device.ts               # detectDeviceKind
│   │   └── haptics.ts
│   ├── hooks/
│   │   ├── useWallet.ts
│   │   ├── useFollowedClan.ts
│   │   └── useSnapshot.ts          # Thin wrapper over useQuery for consistency
│   ├── components/
│   │   ├── ParchmentCard.tsx
│   │   ├── ElderCard.tsx
│   │   ├── PrimaryButton.tsx
│   │   ├── TickCounter.tsx
│   │   └── TabBar.tsx
│   └── types/
│       └── index.ts
├── assets/
│   ├── fonts/                      # Optional local copies; primary load via @expo-google-fonts
│   └── splash.png                  # Void background + Cinzel "ClanWorld"
├── android/                        # Generated by `expo prebuild`; tracked in git per brief
├── app.config.ts
├── eas.json
├── metro.config.js
├── package.json
└── tsconfig.json
```

Roughly 25-30 source files. Lean.

---

## 9. Out of scope (named so we can pick them up next)

These are deferred to later slices, not forgotten:

- All signed mutations (Sigil Forge mint, hire, strategy save, whisper send, Steering Console)
- User-owned iNFT model and per-user Convex queries (requires Convex schema work)
- FCM push notifications and the Convex `sendPush` action
- Glance home-screen widget + WorkManager + MMKV bridge
- Bazaar marketplace UI
- Treasury UI (Solana balance reads, GOLD bridging, Kickstart embed)
- Component library polish (BottomSheet, Toast, Skeleton, Slider, Sigil Forge animations)
- `window.__clanworld` *consumer* code inside `apps/web/src` — this slice only sends; cockpit ignores
- Shared types extraction beyond what we trivially need (we add types to `packages/shared` only if the slice forces it; otherwise, mobile-local types)
- iOS support (brief is Android-only)
- Production EAS profile + Solana dApp Store submission (preview profile only for slice 0)

---

## 10. Risks (explicit, ordered by likelihood × blast)

1. **MWA inside Expo dev build (highest engineering risk per brief).** Validate on Pixel emulator + Phantom in Phase 1. Contingency: bare React Native fallback (3-day cost; documented but not anticipated).
2. **Convex websockets inside `react-native-webview`.** The cockpit uses `useQuery` with websockets; we need the WebView to share cookies and not be blocked by Android's third-party-cookies default. Mitigation: set `sharedCookiesEnabled`, `thirdPartyCookiesEnabled`, `domStorageEnabled` per brief §9.1. Validate during AC-V2.
3. **`demo.clan-world.com/cockpit` mobile-readiness.** Cockpit has `MobileCockpitLayout` at ≤900px so the layout is OK, but it currently loads MiniKit/idkit on every page mount which will fail in WebView (no World App context). Mitigation: gate MiniKit init on `!window.__clanworld?.shell` in a follow-up cockpit PR. Slice 0 accepts the JS errors as "documented known issue" — they don't block the WebView from rendering.
4. **EAS build queue times.** First build can take 20-40 min. Schedule first build immediately after scaffold.
5. **Solana Mobile Stack feature detection on emulator.** Pixel emulator has no SMS — detection should return `'generic-android'` gracefully without throwing. Already covered by AC-S1/S2.

---

## 11. Definition of done

- All 11 runtime verification steps pass on a clean Pixel 7 emulator with Phantom (devnet) installed.
- All ACs in §3 green.
- Visual audit (sub-agent screenshot review against `cockpit-tokens.ts`) signed off.
- APK uploaded to EAS preview channel; install link works.
- README in `apps/mobile/` documents: build commands, env vars, Phantom devnet setup, Seeker testing instructions, the four deferred capability lists from §9.
- Conventional commit history; PR opened against `dev-phase-0-mobile-spectator`; local 3-tier swarm review (Claude subagent → Codex → Gemini flash) all GREEN per repo convention.

---

## 12. Phase plan (within the slice)

Each phase has a single concrete acceptance gate. Do not advance until the gate passes.

| # | Phase | Gate |
|---|---|---|
| 1 | Scaffold + EAS init | Empty Expo Router app boots on Pixel emulator, splash + blank Connect screen visible, fonts loaded, no console errors |
| 2 | MWA POC | AC-W1 + AC-W2 + AC-W3 + AC-W4 green on Pixel + Phantom devnet |
| 3 | Convex wiring | AC-C1 + AC-C2 + AC-C3 green; Hearth tab live |
| 4 | Hall + Follow | AC-P1 + AC-P2 green; Hall renders four ElderCards with tokenized styling matching cockpit |
| 5 | WebView cockpit | AC-V1 + AC-V2 green; Cockpit tab loads live cockpit with injected payload |
| 6 | Codex + device detect | AC-S1 + AC-S2 green; settings tab functional |
| 7 | Visual audit pass | AC-U1 through AC-U5 green; sub-agent sign-off |
| 8 | EAS preview build + verify-on-clean-emulator | AC-B1 + AC-B2 + AC-B3 + full §4 script |

---

## 13. Open items requiring user input before Phase 1 starts

- [ ] Confirm `EXPO_PUBLIC_CONVEX_URL` should be the same `VITE_CONVEX_URL` value already in `.env.local`. (Assumed yes.)
- [ ] Confirm `clanworld://` URL scheme is OK as the deep-link scheme (no conflict with anything else Mikail has installed).
- [ ] Confirm OK to track `apps/mobile/android/` in git per brief §6 (it must be tracked or `prebuild --clean` destroys widget code in later slices).
- [ ] Provide GitHub issue # for this slice if one should be opened (Gitflow requires `feat/issue-N-…` branches; if no issue, I'll open one and use its number).
