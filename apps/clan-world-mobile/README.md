# Clan World Mobile

Native Kotlin / Jetpack Compose Android app for Clan World. **Slice 1 is a UI
demo** — Solana-only surface for user testing the screens, motion, and feel
before committing to the full wallet/auth backend.

## What this slice ships

Five screens, all matching `design/slice-1-prototype.html` 1:1:

1. **Connect** — concentric runic sigil rings rotating at 60s/90s/120s, an
   ember CTA that breathes, gold ornament rules, italic invocation copy.
2. **Hearth** — large Cinzel/JetBrains Mono tick number, gold thread season
   progress with a pulsing ember bead, leaderboard tally with clan glyphs,
   whispers feed with three accents (rune cyan / gold / ember).
3. **Hall** — iNFT cards rendered as parchment letters with deckled left
   edges, multiply-blended grain texture, and rotated wax seals colored per
   clan.
4. **iNFT Detail** — full-bleed parchment hero with a large central sigil,
   four-tab strip (Memory / Vault / Whispers / Bulletin), Memory tab fully
   painted with key/value rows + inline `code` chunks.
5. **Codex** — settings + Solana pubkey + Seeker / Seed Vault detection.

## What's real vs. mocked

| Layer | Slice 1 |
|---|---|
| Visual design | **Real** — Compose mirrors the HTML prototype |
| Convex queries | **Real** — `getSnapshot`, `getInftDemoState`, `getCombinedComms`, `getVaultMovements`, `bulletins.getByClan` |
| Solana MWA | **Real** — `MwaClient.kt` uses Solana Mobile Wallet Adapter. Release builds reject fake/test wallets after wallet authorization metadata returns; debug builds allow them for local testing. |
| EVM wallet / iNFT ownership | **N/A** — this slice is Solana-only UX; the user's "linked" iNFTs are a hardcoded `linkedClanIds = [2, 6, 5]` in `HearthViewModel` |
| Cockpit WebView | **Preserved** as `CockpitActivity`, no longer the launcher; reachable via `adb shell am start -n world.clan.app/.CockpitActivity` |

The full reasoning is in `/home/claude/.claude/plans/my-purpose-here-is-delightful-gizmo.md`.

## Build

```sh
# From the worktree root:
cd apps/clan-world-mobile
ANDROID_HOME=/opt/android-sdk \
  CLAN_WORLD_MAP_URL=https://app.clan-world.com/map \
  CLAN_WORLD_TERMINAL_BASE_URL=https://cockpit.clan-world.com \
  CLAN_WORLD_VERSION_NAME=2.3.3 \
  CLAN_WORLD_VERSION_CODE=2003003 \
  ./gradlew assembleDebug

# APK lands at:
ls app/build/outputs/apk/debug/app-debug.apk
```

Release tags build two GitHub release artifacts:

- `clan-world-vX.Y.Z-release.apk` — public app id `world.clan.app`, stable-signed, non-debuggable.
- `clan-world-vX.Y.Z-debug.apk` — internal app id `world.clan.app.debug`, debuggable, side-by-side installable.

Optionally, point the app at a different Convex deployment:

```sh
CLAN_WORLD_CONVEX_URL=https://your-deploy.convex.cloud ./gradlew assembleDebug
```

## Architecture

```
app/src/main/java/world/clan/app/
├── App.kt                       Application; lazy singletons
├── MainActivity.kt              Compose host (ComponentActivity)
├── CockpitActivity.kt           Legacy WebView (slice 2 redesign target)
├── ui/
│   ├── ClanWorldApp.kt          NavHost + per-route transitions
│   ├── theme/                   Color, Type, ClanWorldColors, ClanWorldTypography, Theme
│   ├── components/              ParchmentCard, EmberCta, Sigil, WaxSeal, Tabbar, …
│   └── screens/                 Connect, Hearth, Hall, InftDetail, Codex
├── data/
│   ├── ClanWorldConvexClient.kt OkHttp + kotlinx.serialization
│   ├── ConvexModels.kt          @Serializable response shapes
│   └── SessionStore.kt          EncryptedSharedPreferences wrapper
├── wallet/
│   ├── MwaClient.kt             Real Solana Mobile Wallet Adapter wrapper
│   ├── FakeWalletPolicy.kt      Release-only fake/test wallet rejection
│   ├── DeviceCapabilities.kt    Seeker / Seed Vault detection
│   └── Base58.kt                Standalone Base58 encoder
└── viewmodel/                   One ViewModel per screen, StateFlow-driven
```

## Theme

All visual tokens are ported from the web app:

- **Colors** ← `apps/web/src/pages/agent/agent-tokens.ts`
- **Fonts** — Cinzel (display), EB Garamond (body), Cormorant Garamond Italic
  (poetic voice), JetBrains Mono (numerics), Uncial Antiqua (rune accents)
- **Variable fonts** — six TTFs in `app/src/main/res/font/`, weight axis driven
  via Compose `FontVariation.weight(N)` (cuts asset count from 17 statics to 6)

Both files come from `github.com/google/fonts` and ship under SIL OFL-1.1.

## Animations

| Effect | Where | Implementation |
|---|---|---|
| Sigil rotation (60s/90s/120s) | Connect, iNFT hero | `rememberInfiniteTransition` + `tween(period, LinearEasing)` per ring |
| Ember CTA breath + shimmer | Connect | Two infinite transitions; halos via `drawBehind`; shimmer is a translated linear gradient |
| Page-load stagger (60ms + 100ms × index) | All screens | `StaggeredEntry(index)` helper composable |
| Pulse bead on progress bar | Hearth banner | 2.4s reverse `EaseInOut` |
| Detail-tab Crossfade | iNFT Detail | `Crossfade(animationSpec = tween(220))` |
| Root-tab transition | NavHost | Per-route `fadeIn(180) + slideInHorizontally { it/12 }` |

## Slice 2 punch list

- Cockpit WebView with `window.__clanworld` injection
- Cross-chain identity link (Solana pubkey ↔ clan owner address)
- Pull-to-refresh on Hearth/Hall
- Push notifications (FCM)
- Glance home-screen widget

## Reference

- **Visual source of truth**: `design/slice-1-prototype.html`
- **Plan**: `/home/claude/.claude/plans/my-purpose-here-is-delightful-gizmo.md`
- **Slice 2+ work**: TBD; tracked in repo issues once slice 1 ships
