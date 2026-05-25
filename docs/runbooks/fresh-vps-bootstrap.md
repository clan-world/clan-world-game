# Clan World — Fresh VPS Bootstrap

**Goal:** stand up a complete Clan World game from a fresh Linux VPS to "ticks advancing on a Base Sepolia diamond, 4 elder agents alive, frontend reachable" without missing config.

**Tested on:** Debian 13 / Ubuntu 24.04 LTS, x86_64, ≥ 4 GB RAM, ≥ 30 GB disk.

**Last verified:** 2026-05-10 by Liam + Claude. Source commit `b42647f` (tag `v2.2.0`).

---

## Quick reference: the 4 things people forget

If you're skimming, these are the steps people consistently miss when redeploying:

1. **Update `dev-ui` Vercel env `VITE_DEFAULT_DIAMOND`** when you redeploy the diamond. The dev-ui SPA reads this at build time. Forgetting it leaves dev-ui pointing at the old (dead) address.
2. **Update Convex env `CLAN_WORLD_CONTRACT_ADDRESS` + `CLAN_WORLD_LENS_ADDRESS` + `INDEXER_START_BLOCK`** simultaneously. Just changing the diamond addr without bumping the start block forces the indexer to re-scan thousands of irrelevant blocks (slow + likely to hit RPC rate limits).
3. **Pause the heartbeat-loop tmux session BEFORE running `forge script Deploy.s.sol`**. The heartbeat-loop fires txs from the deployer wallet every 61s; if it races with deploy txs, you get nonce-too-low errors mid-deploy and end up with a half-cut diamond.
4. **Mint a clan for each elder wallet** (`mintClan(elderAddress)` from the deployer) AFTER deploy. A fresh diamond has treasury seeded but no clans — elders will sit idle until they own a clan.

---

## 0. Prereqs — System deps

Install these on the fresh VPS (commands below assume Debian/Ubuntu):

```bash
# Foundry (forge, cast, anvil)
curl -L https://foundry.paradigm.xyz | bash
~/.foundry/bin/foundryup

# Node 24 + pnpm
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm@10.33.2

# Other CLI tools
sudo apt-get install -y tmux jq curl ripgrep python3 build-essential
sudo apt-get install -y gh                       # gh CLI for GitHub
sudo npm install -g vercel                       # Vercel CLI
sudo npm install -g convex                       # Convex CLI
sudo npm install -g @anthropic-ai/claude-code    # Claude Code CLI

# OpenAI Codex CLI (for codex-driven deploy commands)
# Follow https://github.com/openai/codex install — typically:
#   curl -fsSL https://raw.githubusercontent.com/openai/codex/main/install.sh | bash
# Then `codex auth login`
```

Verify:

```bash
forge --version
node --version          # v24.x
pnpm --version          # 10.33.x
tmux -V
gh --version
vercel --version
npx convex --version
```

## 1. Authenticate CLIs

Each one needs interactive auth — run before any other step:

| Tool | Command | What it does |
|---|---|---|
| `gh` | `gh auth login` | Web flow → device-code, choose SSH key, push perms |
| `vercel` | `vercel login` | Email + magic-link |
| `npx convex` | first deploy auto-prompts | OAuth via browser |
| `claude` (Claude Code) | `claude` then `/login` | OAuth via browser; uses MAX subscription |
| `codex` | `codex auth login` | OpenAI ChatGPT account flow |

**SSH keys for git** — set up identities per `~/.gitconfig`. The default identity used here is `claude-do-box` (for `clan-world` org repos). See `~/.gitconfig` for `[includeIf "gitdir:..."]` aliases that route different repos through different SSH keys.

## 2. Repo layout

Clone the 4 repos under `~/code/clan-world/`:

```bash
mkdir -p ~/code/clan-world && cd ~/code/clan-world
git clone git@github.com:clan-world/clan-world-game.git
git clone git@github.com:clan-world/dev-ui.git
git clone git@github.com:clan-world/gold-bridge-monorepo.git
git clone git@github.com:clan-world/kickstart-token-tracker.git
```

Final layout:

```
~/code/clan-world/
├── clan-world-game/         ← the diamond + monorepo (web, server, mobile, orchestrator)
├── dev-ui/                  ← https://dev-ui.clan-world.com (raw diamond function caller)
├── gold-bridge-monorepo/    ← Wormhole NTT bridge GOLD ↔ Solana
└── kickstart-token-tracker/ ← public Solana mobile app, MIT
```

`clan-world-game` is the canonical repo for the diamond + game UI. The other 3 are extracted public/standalone repos.

Initialize submodules in `clan-world-game`:

```bash
cd ~/code/clan-world/clan-world-game
git submodule update --init --recursive
pnpm install --frozen-lockfile
cd packages/contracts && forge build && cd -
```

## 3. Secrets

Create `~/.secrets/` (mode `0700`) and populate:

| File | Format | Source |
|---|---|---|
| `~/.secrets/clanworld-v3-deployer.key` | one line, `0x...` | Deployer wallet private key. Funded with ≥ 0.2 ETH on Base Sepolia |
| `~/.secrets/clanworld-elder-wallets.json` | JSON (see below) | 4 BIP-39-derived elder wallets — generate via `cast wallet new-mnemonic --words 12` then derive 4 keys at `m/44'/60'/0'/0/N` for N=0..3 |
| `~/.secrets/clanworld-elder-keys/elder-N.key` | one line, `0x...` per file | Same 4 keys as above, one per file (elder agents read these) |
| `~/.secrets/cloudflare_dns_token` | API token | Cloudflare DNS edit token, scope = clan-world.com zone |
| `~/.secrets/cloudflare_account_id` | hex string | Cloudflare account ID |
| `~/.secrets/telegram_bot_token` | `<id>:<hex>` | BotFather token if running Telegram comms |
| `~/.secrets/openai_api_key` | `sk-...` | (optional, for Codex CLI fallback if not using web auth) |

`clanworld-elder-wallets.json` shape:

```json
{
  "generatedAt": "2026-05-10T...",
  "mnemonic12": "method again road person chase stay ask bronze scale ice era help",
  "elders": [
    {"index": 1, "address": "0x71C405...", "privateKey": "0x..."},
    {"index": 2, "address": "0x21eb36...", "privateKey": "0x..."},
    {"index": 3, "address": "0x2bE08C...", "privateKey": "0x..."},
    {"index": 4, "address": "0xA5C97C...", "privateKey": "0x..."}
  ]
}
```

**Fund all 5 wallets** (deployer + 4 elders) on Base Sepolia. Use https://docs.base.org/chain/network-faucets — typical ask: 0.2 ETH for deployer (covers 3 deploys + heartbeats for ~1 month), 0.05 ETH per elder (gameplay txs).

## 4. Configure repo `.env.local`

`~/code/clan-world/clan-world-game/.env.local` (NOT committed). Start from `.env.template`:

```bash
cp .env.template .env.local
```

Required values:

```bash
# Base Sepolia RPC
# OPTION A: Alchemy free tier — works for ~3 deploys + 1 month of heartbeats
RPC_URL_PRIMARY=https://base-sepolia.g.alchemy.com/v2/<YOUR_ALCHEMY_KEY>
# OPTION B: public (slower, rate-limited, no eth_getLogs > 10 blocks)
# RPC_URL_PRIMARY=https://sepolia.base.org

# Deployer key (read directly, NOT exported via shell)
DEPLOYER_PRIVATE_KEY=0x<deployer_priv_hex_no_quotes>

# Diamond address (set AFTER first deploy below)
CLAN_WORLD_CONTRACT_ADDRESS=0x...

# Convex deployment (set AFTER `npx convex deploy` below)
CONVEX_DEPLOY_URL=https://valuable-kudu-985.convex.cloud
WEBHOOK_SHARED_SECRET=<random hex 64 chars>
```

⚠️ `DEPLOYER_PRIVATE_KEY` in `.env.local` is fine for hackathon-mode pre-prod. For production, rotate to a hardware wallet or AWS KMS path.

## 5. Convex deployment

`apps/server/` is the Convex backend (game state, indexer).

```bash
cd ~/code/clan-world/clan-world-game/apps/server
npx convex dev    # first run prompts to create + auth deployment
# Pick "Create new deployment". Take note of the deployment slug
# (e.g. valuable-kudu-985). The dashboard URL will be at
# https://dashboard.convex.dev/d/<slug>
```

After deploy completes (Ctrl-C the dev watch — we don't need it long-running):

```bash
# Set required env vars on the Convex deployment
npx convex env set CHAIN_ID 84532
npx convex env set RPC_URL_PRIMARY <SAME AS YOUR .env.local>
npx convex env set CLANWORLD_USE_REAL_INDEXER true
npx convex env set CLANWORLD_USE_FAKE_HEARTBEAT false
npx convex env set INDEXER_SECRET <random hex 64>
npx convex env set WEBHOOK_SHARED_SECRET <SAME AS YOUR .env.local>

# These get filled in AFTER step 6 (diamond deploy):
# npx convex env set CLAN_WORLD_CONTRACT_ADDRESS 0x...
# npx convex env set CLAN_WORLD_LENS_ADDRESS 0x...
# npx convex env set INDEXER_START_BLOCK <deploy block number>

# Optional World ID config (skip if not running World ID gates)
# npx convex env set WORLD_APP_ID app_...
# npx convex env set WORLD_ACTION_ID ...
```

Verify:

```bash
npx convex env list   # should show ~10+ entries
```

## 6. Diamond deploy

⚠️ **Before deploying:** stop any tmux sessions that send txs from the deployer wallet (heartbeat-loop, finalize-watcher). On a fresh VPS those don't exist yet. On a redeploy, do:

```bash
tmux kill-session -t clanworld-heartbeat 2>/dev/null
tmux kill-session -t clanworld-finalize 2>/dev/null
```

Wait 60 s for any in-flight tx to settle, then verify:

```bash
DEPLOYER=0x<deployer-address>
RPC=$(grep '^RPC_URL_PRIMARY=' ~/code/clan-world/clan-world-game/.env.local | cut -d= -f2)
cast nonce --block latest $DEPLOYER --rpc-url $RPC
cast nonce --block pending $DEPLOYER --rpc-url $RPC
# Both numbers should be equal — no pending txs.
```

Run the deploy:

```bash
cd ~/code/clan-world/clan-world-game/packages/contracts
set -a; source ~/code/clan-world/clan-world-game/.env.local; set +a
forge script script/Deploy.s.sol \
  --rpc-url "$RPC_URL_PRIMARY" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --slow
```

Takes ~5–10 min on Base Sepolia. Sends ~30 txs (24 facets, 3 cuts, init, lens, 6 boundary tokens, 4 stub pools, treasury init, pool seeds). The diamond proxy address gets logged as `Diamond deployed at: 0x...` — **save it**.

After deploy completes:

```bash
# Capture the broadcast manifest before the next deploy overwrites it
cp broadcast/Deploy.s.sol/84532/run-latest.json /tmp/v2.2.0-broadcast-primary.json

# Extract the addresses you need
DIAMOND=$(jq -r '.transactions[] | select(.contractName=="Diamond") | .contractAddress' /tmp/v2.2.0-broadcast-primary.json)
LENS=$(jq -r '.transactions[] | select(.contractName=="ClanWorldLens") | .contractAddress' /tmp/v2.2.0-broadcast-primary.json)
DEPLOY_BLOCK=$(jq -r '[.receipts[] | .blockNumber][0] | ltrimstr("0x")' /tmp/v2.2.0-broadcast-primary.json | xargs -I{} printf "%d\n" "0x{}")

echo "DIAMOND=$DIAMOND"
echo "LENS=$LENS"
echo "DEPLOY_BLOCK=$DEPLOY_BLOCK"
```

**Recommended:** deploy 2 BACKUP diamonds the same way (re-run the same `forge script` command). Each backup is a fully-deployed standalone diamond. They cost ~$1 each on Base Sepolia and let you swap the canonical pointer if PRIMARY needs to be replaced for any reason.

## 7. Wire the diamond

Update everything that points at the diamond:

### 7.1 `clan-world-game/.env.local`

```bash
sed -i "s|^CLAN_WORLD_CONTRACT_ADDRESS=.*|CLAN_WORLD_CONTRACT_ADDRESS=$DIAMOND|" \
  ~/code/clan-world/clan-world-game/.env.local
```

### 7.2 Convex env

```bash
cd ~/code/clan-world/clan-world-game/apps/server
npx convex env set CLAN_WORLD_CONTRACT_ADDRESS "$DIAMOND"
npx convex env set CLAN_WORLD_LENS_ADDRESS "$LENS"
npx convex env set INDEXER_START_BLOCK "$DEPLOY_BLOCK"
```

### 7.3 dev-ui (Vercel project)

⚠️ **THIS IS THE MOST COMMONLY MISSED STEP.** The dev-ui SPA at https://dev-ui.clan-world.com reads `VITE_DEFAULT_DIAMOND` from its Vercel build env. Updating only the in-repo source `App.tsx` default is NOT enough — you need to set the Vercel env so the production build picks it up.

```bash
cd ~/code/clan-world/dev-ui
# Remove old + set new
vercel env rm VITE_DEFAULT_DIAMOND production -y || true
echo "$DIAMOND" | vercel env add VITE_DEFAULT_DIAMOND production

# Rebuild + redeploy
pnpm install --frozen-lockfile
pnpm build
vercel deploy --prebuilt --prod --yes

# Alias the new deployment to the canonical domain (Vercel auto-aliases on prod
# usually, but verify — first prod deploy after a project link sometimes lands
# on a unique URL until manually aliased)
DEPLOY_URL=$(vercel ls --json 2>/dev/null | jq -r '.[0].url')
vercel alias "$DEPLOY_URL" dev-ui.clan-world.com
```

Verify by visiting https://dev-ui.clan-world.com in a browser and connecting a wallet — the "Diamond" input should pre-fill with your new address.

### 7.4 Web app (apps/web)

The user-facing game frontend at `https://app.clan-world.com` reads world state from Convex (NOT directly from chain). As long as Convex's env vars point at the right diamond + lens, the web app picks up new state on next page load. **No Vercel env change needed for `apps/web` when the diamond rotates.**

If you want to force-refresh the Convex `worldSnapshot` action immediately (instead of waiting for the next cron tick), call:

```bash
cd ~/code/clan-world/clan-world-game/apps/server
npx convex run indexer:refreshSnapshot
```

## 8. Mint clans

A fresh diamond has treasury seeded but no clans. Mint one per elder wallet:

```bash
ELDER_ADDRS=(
  0x71C405a8e2b5265b836f075101abEC17DCfca08e   # elder-1
  0x21eb368eE0cc943c8017B36c940944233c7C8977   # elder-2
  0x2bE08C2C1B73D90dC923C6eaf46FDe29769eE123   # elder-3
  0xA5C97CDC145F467B680FD5dF875d63865e47c080   # elder-4
)
for addr in "${ELDER_ADDRS[@]}"; do
  cast send "$DIAMOND" "mintClan(address)" "$addr" \
    --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY"
  sleep 8
done
```

Each tx returns `(uint32 clanId, uint256 iftTokenId)`. Clan IDs auto-increment from 1.

> **Re-deploy/rotate revive ordering:** A freshly-deployed diamond has no clans yet, so this is a no-op. On a re-deploy, replay, or diamond-rotate scenario, clans may already exist and their clansmen may already be dead. If so, inject enough wheat + fish **before** calling `reviveDeadClansmen`; an empty vault lets the next heartbeat starve revived clansmen again within 1-2 ticks.

```bash
for clan_id in 1 2 3 4; do
  cast send "$DIAMOND" "injectClanResources(uint32,uint256,uint256,uint256,uint256,uint256,uint256)" \
    "$clan_id" 0 0 100e18 10e18 0 0 \
    --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY"
  cast send "$DIAMOND" "reviveDeadClansmen(uint32)" "$clan_id" \
    --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY"
done
```

Verify all 4 minted via:

```bash
# Diamond doesn't expose `totalClans()` directly — check via lens
cast call "$LENS" 'getActiveClanCount()(uint32)' --rpc-url "$RPC_URL_PRIMARY"
```

## 9. Heartbeat infrastructure

**Three tmux sessions** keep the game ticking autonomously:

### 9.1 `clanworld-heartbeat`

Runs the TypeScript heartbeat scheduler. The scheduler reads the on-chain
`heartbeatIntervalSeconds()` value once at boot, then schedules each
`heartbeat()` from `getWorldState().nextHeartbeatAtTs` with a 500 ms jitter
buffer. The heartbeat advances the world tick + emits ChainHeartbeat events
that Convex ingests.

```bash
cd ~/code/clan-world/clan-world-game
tmux new-session -d -s clanworld-heartbeat -c "$PWD" \
  'while true; do bash scripts/start-heartbeat-loop.sh 2>&1 | tee -a /tmp/clanworld-heartbeat.log; echo "[$(date)] loop exited; restart in 5s" >> /tmp/clanworld-heartbeat.log; sleep 5; done'
```

The outer `while true` wrapper restarts the TypeScript scheduler if the process exits unexpectedly.

#### Changing heartbeat cadence

The on-chain value is the single source of truth. To change it:

```bash
cast send $DIAMOND 'setHeartbeatIntervalSeconds(uint64)' 60 \
  --rpc-url $RPC_URL_PRIMARY --private-key $DEPLOYER_PRIVATE_KEY
tmux kill-session -t clanworld-heartbeat
# Re-spawn per the command above so the scheduler reads the new interval at boot.
```

Do not set a separate loop interval env var. The per-tick game economics
calibrate to 60 s bins, so don't change cadence without considering downstream
impacts (mission durations, season length, etc.).

### 9.2 `clanworld-finalize`

Detects the "stuck at season-end" state (`currentTick >= seasonEndTick && !seasonFinalized`) and auto-calls `finalizeSeason()`. Without this, every season boundary requires a manual unstick.

```bash
HEARTBEAT_REPO=~/code/clan-world/clan-world-game \
  tmux new-session -d -s clanworld-finalize -e "HEARTBEAT_REPO=$HEARTBEAT_REPO" \
  "/home/<user>/bin/clanworld-finalize-watcher"
```

Replace `<user>` with the actual VPS user. The script must be installed at that path (copy from the original VPS or from the runbook).

### 9.3 Verify

```bash
tmux ls    # should show clanworld-heartbeat + clanworld-finalize

# After ~70 s, verify a heartbeat tx fired
tail -c 1500 /tmp/clanworld-heartbeat.log | grep -oE '"blockNumber":[0-9]+' | tail -1
```

## 10. Elder agents

The 4 elders are 4 Claude Code instances, each with its own working directory and `.env`. They share a parent `.claude/` config dir for instructions + memory.

```
~/clan-world/
├── .claude/                ← shared CLAUDE.md, settings, plugins
├── elder-1/
│   ├── .env                ← per-elder (CLAN_WORLD_CONTRACT_ADDRESS, ELDER_INDEX, RPC_URL, ...)
│   └── run.sh
├── elder-2/...
├── elder-3/...
└── elder-4/...
```

Each `elder-N/.env` should contain:

```bash
ELDER_MNEMONIC="<same 12-word mnemonic shared by all 4>"
ELDER_INDEX=N
ELDER_ADDRESS=0x...
RPC_URL=https://sepolia.base.org   # or your Alchemy URL
CLAN_WORLD_CONTRACT_ADDRESS=0x...   # same as the deployed PRIMARY diamond
ELDER_WALLET_KEY_PATH=/home/<user>/.secrets/clanworld-elder-keys/elder-N.key
# 0G (optional — for iNFT memory): see heartbeat package docs
```

Start each elder in a tmux session:

```bash
for n in 1 2 3 4; do
  tmux new-session -d -s elder-$n -c ~/clan-world/elder-$n ~/clan-world/elder-$n/run.sh
done
```

Watch them come up:

```bash
for n in 1 2 3 4; do
  echo "=== elder-$n ==="
  tmux capture-pane -t elder-$n -p | tail -10
done
```

Each elder should authenticate to Claude Code (OAuth flow on first run — sign in with the same Anthropic MAX account; per-agent CLAUDE_CONFIG_DIR isolation is set up in run.sh) and start receiving prompts from `clanworld-elder-runner`.

### 10.1 Elder-runner (v2 — Convex tick-event-driven)

A 6th tmux session fires each elder right after every chain heartbeat (Cycle B per memory `feedback_runner_cycle_separation`). Polls the Convex `getSnapshot:getSnapshot` query every 5 s, detects when `tick` increments, then `tmux send-keys` a prompt into each `elder-N` REPL.

```bash
tmux new-session -d -s elder-runner '/home/<user>/bin/clanworld-elder-runner-v2'
```

The v2 script (at `~/bin/clanworld-elder-runner-v2`) replaces v1's wall-clock 180 s timer. Each tick → 1 cycle of all 4 elders, with a 2 s stagger between them so prompts don't hit the same instant.

> **Future work (issue #146):** move this elder-fire logic into a Convex internal action triggered by `chainEvents` insert. Removes the local bash script entirely. Quoted at ~1 h impl. Until then, v2 above is the canonical setup.

## 11. Fund elder wallets

Each elder needs ETH for gas (gameplay txs):

```bash
for addr in "${ELDER_ADDRS[@]}"; do
  cast send "$addr" --value 0.05ether \
    --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY"
done
```

## 12. Smoke test

End-to-end verification:

1. **Diamond responds:** `cast call $DIAMOND 'owner()(address)' --rpc-url $RPC_URL_PRIMARY` → returns deployer.
2. **Heartbeat firing:** `tail -3 /tmp/clanworld-heartbeat.log` shows a tx hash + `decodedEvents:1` from the last ~70 s.
3. **Convex indexer caught up:** `npx convex env get CLAN_WORLD_CONTRACT_ADDRESS` matches `$DIAMOND`. Open https://dashboard.convex.dev/d/<your-slug> → Logs → recent function calls show `indexer:refreshSnapshot` running cleanly.
4. **Web app live:** open https://app.clan-world.com → connect wallet → see your clan + map.
5. **dev-ui live:** open https://dev-ui.clan-world.com → wallet auto-fills new diamond address, no error banner.
6. **Elder agents alive:**
   ```bash
   for n in 1 2 3 4; do
     tmux capture-pane -t elder-$n -p | tail -3
   done
   ```
   Each should show recent activity (not stuck at a prompt).

## 13. DNS + custom domains

(Optional — only if redeploying to a new VPS that needs new domains.)

`clan-world.com` lives on Cloudflare. To point a subdomain at Vercel:

```bash
# Get your Cloudflare zone ID + API token
ZONE_ID=$(curl -s -H "Authorization: Bearer $(cat ~/.secrets/cloudflare_dns_token)" \
  https://api.cloudflare.com/client/v4/zones | jq -r '.result[] | select(.name=="clan-world.com") | .id')

# Add CNAME (e.g., for app.clan-world.com → cname.vercel-dns.com)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $(cat ~/.secrets/cloudflare_dns_token)" \
  -H "Content-Type: application/json" \
  --data '{"type":"CNAME","name":"app","content":"cname.vercel-dns.com","ttl":1,"proxied":false}'

# Then in Vercel, add the custom domain to the project:
cd ~/code/clan-world/clan-world-game/apps/web
vercel domains add app.clan-world.com
# Wait ~1-3 min for cert issuance
```

Existing live domains:
- `app.clan-world.com` → Vercel project `dist`, root = `apps/web`
- `dev-ui.clan-world.com` → Vercel project `dev-ui`
- `landing.clan-world.com` → Vercel project for `apps/landing`
- `cockpit.clan-world.com` → ttyd + Caddy + cloudflared (separate setup, see `reference_cockpit_clan_world_infra` memory)

## 14. Common failures + recovery

### 14.1 "nonce too low" / "replacement transaction underpriced" mid-deploy

**Cause:** another process is firing txs from the deployer wallet during deploy (commonly `clanworld-heartbeat` tmux). The 60 s cadence races with deploy txs and steals nonces.

**Fix:** kill the conflicting tmux session BEFORE starting deploy. See step 6.

### 14.2 Alchemy 429 "Monthly capacity limit exceeded"

**Cause:** free tier exhausted. ~3 deploys + ~3 weeks of heartbeats burn through it.

**Fix:** switch to public RPC (`https://sepolia.base.org`) by:

```bash
sed -i 's|^RPC_URL_PRIMARY=.*|RPC_URL_PRIMARY=https://sepolia.base.org|' \
  ~/code/clan-world/clan-world-game/.env.local
cd ~/code/clan-world/clan-world-game/apps/server
npx convex env set RPC_URL_PRIMARY https://sepolia.base.org
# Restart heartbeat + finalize tmux to pick up new env
tmux kill-session -t clanworld-heartbeat
tmux kill-session -t clanworld-finalize
# Then re-spawn per step 9
```

Caveats: public RPC is ~3-8 s round-trip, has aggressive rate limits, and **caps `eth_getLogs` at 10 blocks**. The Convex indexer's `MAX_LOG_BLOCK_RANGE` should be `9n` (already set in v2.2.0).

For heavier loads, get a new Alchemy account or use Infura/Quicknode.

### 14.3 "ClanWorld: heartbeat rate limited" on every heartbeat call

**Cause:** the diamond enforces the configured on-chain `heartbeatIntervalSeconds()` between heartbeats. If you re-spawn the heartbeat-loop before `getWorldState().nextHeartbeatAtTs`, the next call reverts.

**Fix:** wait until `nextHeartbeatAtTs`, or call the owner-only `setHeartbeatIntervalSeconds(uint64)` to change the interval, then restart the heartbeat runner.

### 14.4 Heartbeat fires but ticks don't advance

**Cause:** world is stuck at season-end, `heartbeat()` early-returns until `finalizeSeason()` is called.

**Fix:** ensure the `clanworld-finalize` tmux session is alive AND polling the right diamond. `tail -10 /tmp/clanworld-finalize.log` should show recent polls; if stuck, manually trigger:

```bash
cast send "$DIAMOND" "finalizeSeason()" \
  --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY" \
  --gas-limit 14000000
```

Watch out: with 8+ clans, `finalizeSeason` may exceed Base Sepolia's per-tx gas cap. The 4-clan demo runs fine at ~12 M gas.

### 14.5 dev-ui loads but shows old diamond address

**Cause:** Vercel env `VITE_DEFAULT_DIAMOND` was not updated, or the production build wasn't redeployed after env change.

**Fix:** see step 7.3. Vercel env vars are baked into the build — `vercel deploy --prebuilt --prod` after env change is required.

### 14.6 Convex `worldSnapshot` shows stale state

**Cause:** indexer is slow to catch up after diamond rotation, OR `INDEXER_START_BLOCK` wasn't set (so it's scanning from way too far back).

**Fix:**
1. Verify `npx convex env list` shows `INDEXER_START_BLOCK` = the new diamond's deploy block.
2. Force-refresh: `npx convex run indexer:refreshSnapshot`.
3. Check Convex Logs for errors (RPC rate limits, ABI decode failures).

### 14.7 Elder agent stuck in OAuth or won't authenticate

**Cause:** Claude Code OAuth flow needs a browser — on a headless VPS, you have to copy the auth URL to a local browser, complete login, then paste the resulting code back. First run also needs `CLAUDE_CONFIG_DIR` per-elder so they don't share auth state.

**Fix:** see `reference_agent_oauth_bootstrap` memory for the full procedure. Quick version:

```bash
# Each elder gets its own CLAUDE_CONFIG_DIR
export CLAUDE_CONFIG_DIR=~/clan-world/elder-1/.claude.local
mkdir -p $CLAUDE_CONFIG_DIR
claude   # follow OAuth prompt in another terminal
# Then exit and let run.sh take over
```

### 14.8 Submodule fatal error after move/rename

**Cause:** Forge submodules (e.g. `lib/forge-std`) embed relative paths to `.git/modules/` that break if the parent dir moves between checkout and current state.

**Fix:** instead of `git status` on the broken checkout, do a fresh shallow clone elsewhere:

```bash
git clone --depth 5 git@github.com:clan-world/clan-world-game.git /tmp/cwg-fresh
cd /tmp/cwg-fresh && git fetch --unshallow
# Then do your work there.
```

Or fix submodule pointer:

```bash
cd packages/contracts/lib/forge-std
echo "gitdir: $(git rev-parse --git-common-dir)/modules/packages/contracts/lib/forge-std" > .git
```

## 15. Going to production

This runbook is for **hackathon-mode pre-prod**. Before pointing real users / real value at it:

- Rotate `DEPLOYER_PRIVATE_KEY` from `.env.local` to a hardware wallet or AWS KMS / GCP KMS.
- Switch RPC from free-tier to a paid plan (Alchemy Growth, Infura, Ankr).
- Add monitoring: Tenderly or Forta for the diamond, Sentry for the web app, log shipping for tmux sessions.
- Move secrets out of plaintext files. The current ~/.secrets/* layout is a known structural hole (see `project_dobox_secrets_manager_gap` memory).
- Run a security review on the deploy script + facets. The strip-events PR (#142) was the most recent surgical change; its super-swarm synthesis is at `docs/reviews/pr142-synthesis.md`.

## 16. Known gotchas (canonical list)

Updated as we hit them.

| # | Gotcha | Where it bites | Fix |
|---|---|---|---|
| 1 | `dev-ui` Vercel env not updated | dev-ui shows old diamond after redeploy | Step 7.3 |
| 2 | heartbeat-loop racing deploy | half-cut diamond mid-deploy | Step 6 (kill tmux before deploy) |
| 3 | Alchemy free tier exhausted | 429s everywhere ~3 weeks in | §14.2 (switch to public) |
| 4 | Convex indexer scanning from block 0 | slow + RPC-throttled | §14.6 (set INDEXER_START_BLOCK) |
| 5 | Public RPC eth_getLogs > 10 blocks | indexer fails | already capped to 9 in v2.2.0 |
| 6 | Submodule .git path stale after move | git status fatal | §14.8 (fresh clone) |
| 7 | Elder Claude Code OAuth state shared | only 1 elder authenticated, others in limbo | per-elder `CLAUDE_CONFIG_DIR` |
| 8 | finalize-watcher not running | game freezes 6 h after season end | step 9.2 |
| 9 | `mintClan` not called | elders idle, can't see their clan | step 8 |
| 10 | Workspace package versions diverged | confusion + bad release notes | bump all 10 in lockstep at release |

## 17. Reference: every file/env this runbook touches

| Location | Purpose |
|---|---|
| `~/.secrets/clanworld-v3-deployer.key` | Deployer wallet private key |
| `~/.secrets/clanworld-elder-wallets.json` | 4 elder wallet JSON |
| `~/.secrets/clanworld-elder-keys/elder-N.key` | Per-elder private key (used by run.sh) |
| `~/code/clan-world/clan-world-game/.env.local` | Repo-level env (RPC, deployer key, diamond addr) |
| Convex deployment env (set via `npx convex env set`) | Indexer-side env (mirrors .env.local + indexer secrets) |
| Vercel project envs (`dev-ui`, `dist`/web, `apps/landing`) | Frontend build env |
| `~/clan-world/elder-N/.env` | Per-elder runtime env |
| `~/bin/clanworld-finalize-watcher` | Finalize tmux script (copy from existing VPS) |
| `~/bin/clanworld-elder-runner` | Elder prompt-injection cron (copy from existing VPS) |
| `~/code/clan-world/clan-world-game/scripts/start-heartbeat-loop.sh` | Heartbeat loop (in-repo) |

---

**End of runbook.** Keep this doc updated whenever a new redeploy reveals a step that wasn't documented. The "things people forget" list at the top is the canary — anything that surprises an agent on second redeploy belongs there.
