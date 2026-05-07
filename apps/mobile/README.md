# `@clan-world/mobile`

Solana Mobile dApp — wraps the existing ClanWorld cockpit in a WebView and adds the surrounding wallet, iNFT, and native-mobile capabilities. Built for the Solana Mobile dApp Store / Easy A Hackathon track.

> **Slice 0 in flight.** See [`artifacts/implementation/slice-0-mobile-spectator.md`](../../artifacts/implementation/slice-0-mobile-spectator.md) for the active spec and [`HANDOFF.md`](./HANDOFF.md) for the runtime verification script.

## Architecture

```
┌────────────────────────────────────┐
│ apps/mobile (this package)         │
│  Expo SDK 52 / Expo Router         │
│  ┌───────────┐  ┌───────────────┐  │     ┌───────────────┐
│  │ Hearth    │──┤ Convex client ├──┼────▶│ apps/server   │
│  │ Hall      │  └───────────────┘  │     │  (Convex)     │
│  └───────────┘                     │     └───────────────┘
│  ┌───────────┐                     │
│  │ Cockpit   │── WebView ──────────┼────▶ demo.clan-world.com/cockpit
│  └───────────┘                     │
│  ┌───────────┐                     │
│  │ Connect   │── MWA ──────────────┼────▶ Phantom (devnet) / Seeker Wallet
│  │ Codex     │                     │
│  └───────────┘                     │
└────────────────────────────────────┘
```

Single seam to the wallet (`src/lib/mwa.ts`); single seam to the cockpit (`src/lib/webview-bridge.ts`). Visual tokens mirror `apps/web/src/styles/cockpit-tokens.ts` so the mobile shell reads as the cockpit's mobile sibling.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Expo SDK 52, TypeScript strict |
| Routing | Expo Router (file-system, typed routes) |
| Wallet | `@solana-mobile/mobile-wallet-adapter-protocol-web3js` + `@solana/web3.js` |
| Backend | `convex/react` against the existing `apps/server` deployment |
| WebView | `react-native-webview` |
| Storage | `expo-secure-store` (auth token + followed clanId) |
| Device detect | `expo-device` |
| Fonts | `@expo-google-fonts/{cinzel,inter,jetbrains-mono}` |
| Build | EAS — owner `mikail_18`, slug `clan-world-mobile` |

## Getting started

```bash
# Match the repo's pinned node version
nvm install 24.13.1 && nvm use

# Install
pnpm install

# Configure env (gitignored)
cp apps/mobile/.env.example apps/mobile/.env.local
# Fill EXPO_PUBLIC_CONVEX_URL with the same value as VITE_CONVEX_URL in
# the repo-root .env.local. EXPO_PUBLIC_COCKPIT_URL defaults to
# https://demo.clan-world.com/cockpit and rarely needs changing.

# Generate native android/
pnpm --filter @clan-world/mobile prebuild

# Build + install on a connected Android device or emulator
pnpm --filter @clan-world/mobile android
```

A Pixel 7 ARM64 emulator with Phantom installed (and switched to devnet in Phantom's settings) is the recommended dev target. Real Seeker hardware works the same way once Seeker Wallet is the default Solana wallet on the device.

## Common commands

```bash
pnpm --filter @clan-world/mobile start          # Metro + dev menu
pnpm --filter @clan-world/mobile typecheck      # tsc --noEmit
pnpm --filter @clan-world/mobile test           # vitest run (17 cases)
pnpm --filter @clan-world/mobile build:preview  # EAS preview APK build
```

## Project layout

```
apps/mobile/
├── app/                            # Expo Router routes
│   ├── _layout.tsx                 # Polyfills FIRST, then Convex + Wallet + Follow providers
│   ├── index.tsx                   # Auth-gate redirect (Connect ↔ Hearth)
│   ├── connect.tsx                 # MWA connect screen
│   └── (tabs)/
│       ├── _layout.tsx             # Custom iron-deep tab bar with vellum-gold accent
│       ├── hearth.tsx              # Live worldSnapshot
│       ├── hall.tsx                # Four ElderCards
│       ├── cockpit.tsx             # WebView with injected window.__clanworld
│       └── codex.tsx               # Wallet, follow, backend, device, disconnect
├── src/
│   ├── components/                 # ParchmentCard, ElderCard, PrimaryButton
│   ├── hooks/                      # useWallet, useFollowedClan, useSnapshot
│   ├── lib/                        # mwa, secure-store, convex, webview-bridge, device(-detect), polyfills
│   └── theme/                      # tokens, elders, fonts (mirrored from cockpit)
├── app.json                        # Owner, slug, package, plugins
├── eas.json                        # development / preview / production profiles
├── babel.config.js                 # babel-preset-expo + reanimated/plugin
├── metro.config.js                 # Monorepo-aware
├── vitest.config.ts                # Pure-module unit tests only
├── tsconfig.json                   # Extends expo + monorepo strict overlay
├── HANDOFF.md                      # Slice 0 runtime verification script
└── README.md                       # This file
```

## Solana Mobile features used

For the dApp Store submission, the slice exercises:

- **Mobile Wallet Adapter** — every signing path goes through `src/lib/mwa.ts`. `connect()` uses `transact()` from `@solana-mobile/mobile-wallet-adapter-protocol-web3js`. `reauthorize()` is invoked silently on cold launch so the user doesn't re-prompt across sessions.
- **Solana Mobile Stack feature detection** — `src/lib/device.ts` classifies the host as Saga / Seeker / generic-Android. Surfaced in the Codex screen.
- **Devnet** — both authorize() and any future signAndSendTransactions() target devnet. Cluster is centralized in `mwa.ts#SOLANA_CLUSTER`.

Future slices (per the slice spec §9) will add: signed mutations (Sigil Forge mint, hire, whisper), Glance home-screen widget, FCM push, Bazaar marketplace, Treasury (GOLD bridge UI).

## Visual contract

Mirrors `apps/web/src/styles/cockpit-tokens.ts` verbatim. Drift is a visual regression. The four Elder accents from `apps/web/src/styles/cockpit-tokens.ts#ELDERS` are reused per ElderCard. No Material defaults, no rounded-pill buttons — radii are 2-4px ("hand-cut, not pillowy").

## Conventions

- `verbatimModuleSyntax: true` — type imports must use `import type`.
- Path alias `@/` → `./src/`.
- Hackathon rules: minimal tests only (happy path + explicit error cases), one env var per concept.
- Pure modules go in `src/lib/*.ts`; modules that import RN go through a `*-detect.ts` companion to keep vitest workers from loading RN's Flow-tagged index.
