# Teammate setup — clan-world-v3

If you're joining the v3 project as a developer, here's everything you need to bootstrap your local env. Liam will share the secret-bearing values out-of-band (1Password / signal). Everything else you can assemble yourself.

## 1. Clone

```bash
git clone git@github.com:OmniPass-world/clan-world-v3.git ~/code/clan-world-v3
cd ~/code/clan-world-v3
pnpm install
```

> v2 (the frozen May-6 demo) lives at `OmniPass-world/clan-world-v2`. **Do NOT push to v2** — only fixes for the demo are allowed there, and only with Liam's explicit approval.

## 2. Env files you need

Two `.env.local` files, both gitignored:

- `~/code/clan-world-v3/.env.local` — root, used by runner + foundry + frontend (VITE_*).
- `~/code/clan-world-v3/apps/server/.env.local` — Convex deployment ID for the server.

### 2a. Root `.env.local`

Start by copying the template, then fill these in:

```bash
cp .env.template .env.local
```

| Var | How to get | Notes |
|---|---|---|
| `CHAIN` | hardcode `base-sepolia` | |
| `RPC_URL_PRIMARY` | Liam will share Alchemy or Infura URL | shared dev key — don't redistribute |
| `RPC_URL_FALLBACK` | hardcode `https://sepolia.base.org` | public Base Sepolia |
| `CLAN_WORLD_CONTRACT_ADDRESS` | from Liam (V3 diamond addr) | will change when we redeploy |
| `CLAN_WORLD_LENS_ADDRESS` | from Liam | optional view-helper contract |
| `DEPLOYER_PRIVATE_KEY` | **GENERATE YOUR OWN.** Fund it from the [Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia). | Liam's deployer is shared — for your own dev work, use a fresh wallet so we don't fight over nonces. |
| `DEPLOYER_ADDRESS` | derive from your private key: `cast wallet address --private-key <key>` | |
| `ELDER_MNEMONIC` | from Liam (12-word phrase) | shared across all 4 elder wallets via BIP-44. Same for everyone. |
| `CONVEX_URL`, `VITE_CONVEX_URL`, `CONVEX_DEPLOY_URL` | `https://valuable-kudu-985.convex.cloud` | shared dev Convex |
| `VITE_CLAN_WORLD_USE_STUB_*=false` | hardcode | want real chain + real Convex by default |
| `VITE_CLAN_WORLD_USE_STUB_LLM=true` | hardcode | LLM stubbed for local dev unless testing real elder loop |
| `VITE_CLANWORLD_DEMO_MODE=false` | hardcode | demo mode is for hackathon submission only |
| `ZERO_G_RPC_URL=https://evmrpc.0g.ai` | hardcode | 0G mainnet RPC |
| `INDEXER_RPC=https://indexer-storage-turbo.0g.ai` | hardcode | 0G indexer |
| `FLOW_CONTRACT=0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526` | hardcode | 0G flow contract (currently broken — see "Known Issues" below) |
| `OG_STORAGE_ENABLED` | leave commented out | 0G save reverts at gas estimate; using FileMemoryStore fallback for now |
| `AXL_API_KEY` | any non-empty string for local | bearer auth, local dev |
| `AXL_NETWORK_ID=testnet` | hardcode | |
| `AXL_NODE_URL_CLAN_1..4` + `AXL_PEER_ID_CLAN_1..4` | run `infra/axl/setup.sh` after `docker compose up -d` to generate | per-clan AXL nodes; only needed if running peer whispers locally |
| `KEEPER_MODE=foundry-loop` | hardcode | game-day operator mode |
| `HEARTBEAT_CALLER_ENABLED=false` | hardcode | runner heartbeat disabled (loop runs separately) |
| `CLANWORLD_USE_FAKE_HEARTBEAT=false` | hardcode | use real chain heartbeat |
| `WEBHOOK_SHARED_SECRET` | from Liam | shared secret between Convex webhook caller + verifier |
| `CLAUDE_CODE_OAUTH_TOKEN` | your own from [Claude Code account](https://claude.com/code) | for elder REPLs only — your token, not Liam's |

### 2b. Server `.env.local`

`apps/server/.env.local` — minimal:

```
# Deployment used by `npx convex dev`
CONVEX_DEPLOYMENT=dev:valuable-kudu-985 # team: chaintail, project: clan-world-v3
```

Everything else (CLAN_WORLD_CONTRACT_ADDRESS, RPC_URL_PRIMARY, INDEXER_*, etc.) is set on the **Convex deployment env** by Liam, not in this file. View / edit via `npx convex env list`.

## 3. Get Convex access

You need to be added to the Convex team (`chaintail`) so you can `npx convex env list` and view dashboard. Ask Liam to invite your Convex account email.

```bash
cd apps/server
npx convex login   # browser auth
npx convex env list   # should show CHAIN_ID, INDEXER_*, etc.
```

## 4. Verify your setup

```bash
cd ~/code/clan-world-v3

# 1. Build all packages
pnpm build

# 2. Convex schema in sync
cd apps/server && npx convex dev --once --typecheck=disable

# 3. Frontend dev server
cd ../web && pnpm dev
# open http://localhost:5173 — should load the cockpit, query Convex, and show world state

# 4. Foundry test (read-only — no on-chain tx)
cd ../../packages/contracts && forge test
```

## 5. Branching workflow

See `AGENTS.md` section 3 for the canonical Gitflow Light flow. tl;dr:

```
main ← dev ← dev-phase-N-<bundle> ← feat/issue-N-foo
```

Phase branches bundle features. Open feature PRs against the active phase branch. Phase branches squash-merge into `dev` when GREEN. Releases tag `dev` → `main`.

## 6. Known issues / gotchas

- **0G mainnet save reverts.** The `submit()` call on `FLOW_CONTRACT=0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526` reverts at gas estimate even though all 4 elder wallets have full 50 0G balance. Likely SDK/contract version drift. Workaround: leave `OG_STORAGE_ENABLED` commented out; runner falls back to `FileMemoryStore` (local JSON at `~/.world/clanworld-runner/state/elder-N-memory.json`). Game works fully without 0G persistence, just doesn't survive runner restarts.
- **Heartbeat loop must drop `set -e` + `pipefail`.** See `~/bin/clanworld-heartbeat-loop` and memory `feedback_bash_pipefail_grep_set_e_loop_death.md` — bash daemons that pipe through grep on flaky-RPC output silently die in 15-30min if `pipefail` is set.
- **Runner duplicate-tick trap.** If `~/.world/clanworld-runner/state/elder-*-last-tick.txt` markers contain stale ticks > current chain tick, the runner won't deliver new tick events to elders. Always clear before `runner start`: `rm -f ~/.world/clanworld-runner/state/elder-*-last-tick.txt`.
- **`convex deploy` ≠ `convex dev --once`.** `convex deploy` creates/updates a separate **PROD** deployment (not what you want for dev). Use `convex dev --once` to push code/env changes to your existing dev deployment. Memory: `feedback_convex_deploy_vs_dev_once.md`.

## 7. Channels

- Telegram do-crew group: ask Liam for the invite. Daisy / co-orchestrator agents post status there.
- GitHub: tag `@OmniPass-world/v3-team` on PRs that need cross-review.
- Convex dashboard: `https://dashboard.convex.dev/d/valuable-kudu-985`.

## 8. Asking for help

If something's broken, post in do-crew with:
- What you tried (the exact command)
- What you expected
- What happened (paste exact error)
- Your git HEAD: `git rev-parse HEAD`
- Your `.env.local` keys (just the keys, not values): `grep -E "^[A-Z]" .env.local | cut -d= -f1`

Liam or one of the orchestrator agents will pick it up.
