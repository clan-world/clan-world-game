# ClanWorld Retention Prototype Plan

Living tracking document for the retention and gamification dapp prototype.

This app is intentionally experimental inside the ClanWorld monorepo worktree. The code should stay portable so it can be moved into a private repo once the product shape hardens.

## Current Status

- **Active worktree:** `.claude/worktrees/retention-gamification-prototype`
- **App root:** `apps/retention`
- **Frontend:** Vite + React prototype
- **Backend:** small local API for wallet verification, profile persistence, social capture, and spin rewards
- **Persistence:** app-local file-backed DB at `apps/retention/runtime/retention-prototype-db.json`, real DB later
- **Rule of record:** a campaign user only counts after at least one verified EVM or Solana wallet signature
- **Private preview:** `https://gold.clan-world.com` behind Cloudflare Access

## Product Shape

ClanWorld campaign onboarding should become a daily retention loop, not a one-time form.

Users can optionally register or verify:

- EVM wallet
- Solana wallet
- X follow
- Telegram group join
- TikTok follow

Each completed source grants **one daily spin credit**, up to **5 spins per day**. Credits reset at **midnight Pacific Time**.

The wheel is a horizontal CS:GO-style loot reel using ClanWorld sprites. Spins grant XP and collectible sprite rewards. Users build streaks, collections, and leaderboard rank over time.

## Completed

- Created experimental worktree branch: `exp/retention-gamification-prototype`
- Added initial `apps/retention` Vite React app
- Added first-pass onboarding UI:
  - EVM wallet input
  - Solana wallet input
  - X handle/follow flow
  - Telegram handle/join flow
  - TikTok handle/follow flow
- Added first-pass local profile persistence
- Added first-pass horizontal reel concept using ClanWorld game assets
- Added first-pass streak, XP, collection, and leaderboard UI concepts
- Added backend API for:
  - nonce issuance
  - EVM signature verification
  - Solana signature verification
  - file-backed profile DB
  - social handle persistence
  - server-side spin reward generation
  - simple rate limiting
- Wired frontend to backend-owned profile, social, spin, XP, streak, and collection state
- Added request states:
  - wallet signing/loading/success/error
  - social verification/loading/success/error
  - alias debounce save
  - spin loading/success/error
- Added demo EVM and Solana signing paths for local automation while keeping injected wallet signing paths in place
- Ran desktop and mobile Playwright flows and screenshot review
- Verified backend rejects social-before-wallet and malformed wallet signatures

## Actively In Progress

- None. Current prototype pass is complete and running locally.

## Immediately Planned

1. Tune the XP economy.
   - XP range: 3 to 99 per spin.
   - Target EV: about 25 XP per spin.
   - Re-check median target, because a median around 35 with mean 25 is mathematically unusual unless the distribution has many tiny rewards and a chunky mid-band.

2. Improve the leaderboard backend.
   - Current leaderboard mixes the active user with static seeded rows.
   - Next version should rank all DB users and expose `GET /api/leaderboard`.
   - Later refresh hourly from DB/cache.

3. Replace demo signing with production wallet adapters.
   - EVM injected wallet path exists but wants a real wallet extension to test.
   - Solana injected wallet path exists but wants a real wallet extension to test.
   - Demo signing should be hidden behind dev mode before any public release.

4. Decide real social verification strategy.
   - Current version records handles and grants provisional credit after the fake verification delay.
   - Later: batch follower/group checks near campaign end, or wire X/TG/TikTok APIs/bots.

## Dependencies

- `viem` for EVM message verification.
- `tweetnacl` and `bs58` for Solana signature verification.
- A real wallet adapter later:
  - EVM: injected wallet / wagmi / RainbowKit / simple `window.ethereum`.
  - Solana: wallet adapter or direct `window.solana`.
- Real DB later:
  - Convex, Postgres, SQLite, or Supabase are all viable.
  - For this prototype, a file-backed JSON DB is enough.

## Gotchas

- Social verification is intentionally fake for now. The UI must avoid implying instant final verification.
- Social spin credit should be **provisional** after the fake verify click.
- The backend must own XP, streaks, daily credits, and reward selection to prevent trivial local tampering.
- Midnight reset is Pacific Time, not the host time zone.
- The host machine runs in Europe/Moscow. User-facing campaign timing should be shown in PT for resets unless we decide otherwise.
- Existing port registry is crowded in this repo. The prototype currently reuses the landing dev port allocation for Vite.
- This code is still in a monorepo experiment and should stay easy to extract into a private repo.
- `pnpm --filter @clan-world/retention api` runs with the package as cwd, so DB paths must be app-root-relative, not shell-cwd-relative.
- Vite config should avoid `port-for` lookups during production build to keep build logs clean while dev servers are running.
- The reel animation must reconcile server-owned reward results with the visual marker; the current version settles the returned reward near the marker after the animation completes.

## Open Product Decisions

- Should each social source grant provisional credit immediately, or only after the 24h pending window?
  - Current recommendation: immediate provisional credit.
- Should both wallets count independently if the same person verifies both?
  - Current recommendation: yes, one EVM credit and one Solana credit.
- Should a user be able to change social handles after verification?
  - Current recommendation: allow edits during prototype, add cooldown later.
- Should spin credits accrue if unused?
  - Current recommendation: no, reset daily to drive return behavior.
- Should streak advance on any spin or only if all available spins are used?
  - Current recommendation: any spin advances streak.

## Work Log

### 2026-05-27

- Created this living plan document.
- Clarified core loop:
  - wallet-verified user profile
  - optional sources
  - daily spin credits
  - sprite reel
  - XP, streaks, collection, leaderboard
- Captured implementation principle: real wallet verification and server-owned rewards, fake/provisional social verification for speed.
- Added a local API for nonce issuance, wallet signature verification, profile persistence, social handle persistence, server-owned spin rewards, and simple rate limiting.
- Reworked the frontend so wallet/profile/social/spin state comes from API responses instead of local-only optimistic state.
- Added demo signing paths for automated testing and local prototype usage without browser wallet extensions; injected EVM/Solana signing remains the intended real wallet path.
- Validation completed:
  - `pnpm --filter @clan-world/retention typecheck`
  - `pnpm --filter @clan-world/retention build`
  - Playwright full flow: empty state -> EVM demo-sign -> X/TG/TikTok provisional verification -> spin -> collection/leaderboard update
  - Playwright mobile screenshot review
  - API edge checks for social-before-wallet and malformed EVM signatures
- Exposed private preview at `gold.clan-world.com` through Cloudflare Tunnel + Caddy:
  - `/api/*` routes to local API port `38042`
  - web/HMR routes to Vite port `58443`
  - user systemd services keep both processes running
  - Cloudflare Access protects external traffic
