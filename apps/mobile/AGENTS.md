# `@clan-world/mobile` — AGENTS.md

React Native Expo app for the Solana Mobile dApp Store / Easy A Hackathon track. Wraps the existing `apps/web` cockpit in a WebView and adds the surrounding wallet, iNFT, and native-mobile capabilities.

> **Slice 0 in flight.** See `artifacts/implementation/slice-0-mobile-spectator.md` at repo root for the active spec. This package is being built phase by phase against that doc — do not invent scope outside what the slice authorizes.

## 1. Stack

| Concern | Choice |
|---|---|
| Runtime | Expo SDK 52, TypeScript strict |
| Routing | Expo Router (file-system, typed routes) |
| Wallet | `@solana-mobile/mobile-wallet-adapter-protocol-mobile` + `@solana/web3.js` (Phase 2) |
| Backend | `convex/react` against the existing `apps/server` deployment (Phase 3) |
| WebView | `react-native-webview` (Phase 5) |
| Storage | `expo-secure-store` (Phase 2) |
| Fonts | `@expo-google-fonts/{cinzel,inter,jetbrains-mono}` |
| Build | EAS — owner `mikail_18`, slug `clan-world-mobile` |

## 2. Visual contract

Mirrors `apps/web/src/styles/cockpit-tokens.ts` verbatim. The mobile shell must read as the cockpit's mobile sibling — parchment-on-cosmic-dark, Cinzel display, JetBrains Mono numerics, vellum-gold accent, no Material defaults. Drift is a visual regression.

## 3. Phase plan (lives in slice 0 spec)

All eight phases of slice 0 are code-complete. Static gates green:
typecheck PASSES, vitest 17/17 PASSES, expo-doctor 17/17 PASSES,
expo export Android Hermes bundle (4.77 MB) compiles cleanly.

Runtime gates (AC-W2/W3/W4, AC-V2, AC-S2, AC-B2/B3) require a Pixel 7
emulator with Phantom on devnet. See `HANDOFF.md` for the 11-step
verification script and the EAS preview-build kickoff.

## 4. Common commands

```bash
pnpm --filter @clan-world/mobile start          # Metro + dev menu
pnpm --filter @clan-world/mobile typecheck
pnpm --filter @clan-world/mobile prebuild       # generates android/
pnpm --filter @clan-world/mobile build:preview  # EAS preview APK
```

## 5. Conventions

- Mirror cockpit tokens; do not redefine values.
- `verbatimModuleSyntax: true` from the root tsconfig — type imports must use `import type`.
- Path alias `@/` → `./src/`.
- Hackathon rules apply: minimal tests only, ONE env var per concept.

## 6. Out of scope (named so future slices pick them up)

Push, Glance widget, Bazaar, Treasury, Sigil Forge animation, signed mutations, shared-types extraction, iOS, production EAS profile. See slice 0 spec §9.
