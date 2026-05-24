# Dockerized self-hosted end-to-end dev stack

How to bring up the entire ClanWorld stack — Convex, anvil-fork, heartbeat,
4 elder containers, and the apps/web SPA — using ONLY docker-compose on the
do-box VPS, with public access via a single cloudflared route. No
production-Vercel / production-Convex / real-Base-Sepolia dependencies.

First fully validated 2026-05-24 during the v2.15.0 self-hosted Convex
cutover. Cross-references:

- `docs/runbooks/self-hosted-convex.md` — Convex backend specifics
- `docs/runbooks/anvil-fork-dev-rpc.md` — anvil-fork details + pause/unpause
- `docs/runbooks/fresh-vps-bootstrap.md` — bare-VPS prereqs (Docker, Node, etc.)
- `docs/runbooks/full-game-reset.md` — fresh diamond deploy variant of this flow
- `docs/runbooks/diamond-migration.md` — when the active diamond changes

## What you get at the end

- `https://clanworld-dev.claude.do` (or your chosen cloudflared hostname) →
  apps/web SPA bundled locally, talking to self-hosted Convex on the same
  domain via `/convex-api/*`.
- `clan-world-anvil-fork-1` serving Base Sepolia state from the fork block
  on `http://anvil-fork:8545` (docker-internal only).
- `clan-world-heartbeat-1` ticking every `heartbeatIntervalSeconds()` against
  the anvil-fork diamond.
- `clan-world-elder-1..4` running the elder-runtime + claude TUI, writing
  pendingMessages / orders to the self-hosted Convex.
- `clan-world-caddy-1` reverse-proxying everything from `127.0.0.1:58731`.
- `clan-world-convex-backend-1` + `clan-world-convex-dashboard-1` healthy.

## Prereqs

- VPS with `~/code/clan-world/clan-world-game` checked out + `pnpm install`
  done at repo root.
- `~/.secrets/clanworld-v3-deployer.key` + `~/.secrets/clanworld-elder-wallets.json`
  present per `fresh-vps-bootstrap.md` step 3.
- `make`, `docker`, `docker compose`, `pnpm`, `cast` (Foundry) available.
- The 4 cutover-blocker fixes in PR #608 (or merged): IChainClient node:fs
  lazy-load, heartbeat Dockerfile slim base, elder tty/stdin_open, and
  init-firewall.sh NAT-preserve.

## Step 1 — Bootstrap secrets + .env

Per the cutover replay in `NEXT-SESSION.md` (or the equivalent runbook entry):

```bash
cd ~/code/clan-world/clan-world-game

# Build .env from .env.local + docker-stack additions per fresh-vps step 2 +
# the 17 self-hosted-Convex vars (CHAIN_NETWORK, INSTANCE_NAME, BUS_*, etc).
# See docs/runbooks/self-hosted-convex.md for the canonical list.

# Bus secrets
make -C agents bootstrap-bus-secrets PROFILE=dev

# Convex admin key (requires convex-backend container running, so this is
# bootstrapped AFTER the first `make agents up`)
```

## Step 2 — Build images

The agent image is built standalone (NOT via `docker compose build` — that
only builds services with `build:` directives, which agents elder-* don't
have):

```bash
# Heartbeat (rebuilt by docker compose build):
set -a && source .env && set +a
make -C agents build PROFILE=dev
# → clan-world-heartbeat:latest

# Agents image (manual — not in docker compose build):
docker build -f agents/Dockerfile -t clanworld/agents:dev .
# → clanworld/agents:dev (~1.5GB)
```

**Why agents needs a manual build:** the elder-1..4 services share
`x-elder-common` which only declares `image:`, not `build:`. So `docker
compose build` skips them. Re-run `docker build` whenever you edit anything
under `agents/init-firewall.sh`, `agents/entrypoint.sh`, `agents/Dockerfile`,
or `packages/runner/` (which is COPY'd into the image).

## Step 3 — Bring up the stack

```bash
set -a && source .env && set +a
make -C agents up PROFILE=dev
# → anvil-fork + convex-backend + convex-dashboard + caddy + heartbeat + 4 elders
```

Expected `docker compose ps` after ~30s:

```
clan-world-convex-backend-1            Up Healthy
clan-world-convex-dashboard-1          Up Healthy
clan-world-anvil-fork-1                Up Healthy
clan-world-heartbeat-1                 Up
clan-world-caddy-1                     Up Healthy
clan-world-elder-1..4                  Up Healthy
```

## Step 4 — Deploy v2.15.0 schema to self-hosted Convex

```bash
cd apps/server
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat ../../agents/secrets/convex-admin.key)"
export CONVEX_TMPDIR="$(pwd)/.convex-tmp"
mkdir -p "$CONVEX_TMPDIR"
npx -y convex@1.39.1 deploy --yes --url "$CONVEX_SELF_HOSTED_URL" \
  --admin-key "$CONVEX_SELF_HOSTED_ADMIN_KEY"
```

Then set 7 Convex env vars (BUS_OPERATOR_SECRET, BUS_ELDER_SECRET_1..4,
INDEXER_SECRET, WEBHOOK_SHARED_SECRET) — see `self-hosted-convex.md` step 5.

## Step 5 — Unpause the diamond (if needed)

If the fork inherited paused state from real Base Sepolia (heartbeat reverts
with `ClanWorld: world paused`), follow
`docs/runbooks/anvil-fork-dev-rpc.md` section 5 — call `unpauseWorld()` via
anvil's `--auto-impersonate` of the owner. No real key needed on the fork.

```bash
DIAMOND=$(grep ^CLAN_WORLD_CONTRACT_ADDRESS .env | cut -d= -f2)
OWNER=$(docker compose --profile dev exec -T heartbeat \
  cast call $DIAMOND "owner()(address)" --rpc-url http://anvil-fork:8545)

docker compose --profile dev exec -T heartbeat \
  cast rpc anvil_setBalance "$OWNER" 0x56BC75E2D63100000 --rpc-url http://anvil-fork:8545
docker compose --profile dev exec -T heartbeat \
  cast rpc anvil_impersonateAccount "$OWNER" --rpc-url http://anvil-fork:8545
docker compose --profile dev exec -T heartbeat \
  cast send "$DIAMOND" "unpauseWorld()" --rpc-url http://anvil-fork:8545 --unlocked --from "$OWNER"
```

Within ~60s, `docker logs clan-world-heartbeat-1 | grep 'tx confirmed'`
should show the first `heartbeat tx confirmed: 0x...`.

## Step 6 — Fix the elder→clan CLAN_ID mapping if forked-live

`fresh-vps-bootstrap.md` step 8 assumes a fresh diamond mints clans 1-4 to
elder addresses 1-4 in order. A forked live diamond may have its clan IDs
in a different order. Per
`docs/runbooks/anvil-fork-dev-rpc.md` section 5 caveat, query each clan's
owner on-chain and set `agents/elder-N/.env`'s `CLAN_ID=` to the matching
clan, not the elder index.

After editing, force-recreate the elders so they pick up the new env:

```bash
docker compose --profile dev up -d --force-recreate --no-deps \
  elder-1 elder-2 elder-3 elder-4
```

## Step 7 — Build the apps/web SPA + serve via Caddy

Build with the public Convex URL baked in:

```bash
# .env.local at monorepo root — vite's envDir is the monorepo root
grep -E '^VITE_CONVEX_URL' .env.local
# Should be: VITE_CONVEX_URL=https://<your-public-hostname>/convex-api

pnpm --filter @clan-world/web build
# → apps/web/dist/index.html + assets/
```

Create the local docker-compose override that bind-mounts dist into Caddy
(file is gitignored):

```yaml
# docker-compose.override.yml
services:
  caddy:
    volumes:
      - ./apps/web/dist:/srv/web:ro
```

Force-recreate Caddy:

```bash
set -a && source .env && set +a
docker compose --profile dev up -d --force-recreate --no-deps caddy
```

Verify the chain from inside the VPS:

```bash
curl -sf -o /dev/null -w "/healthz: %{http_code}\n" http://127.0.0.1:58731/healthz
curl -sf -o /dev/null -w "/: %{http_code}\n" http://127.0.0.1:58731/
curl -sf -o /dev/null -w "/convex-api/version: %{http_code}\n" http://127.0.0.1:58731/convex-api/version
```

All three should be `200`.

## Step 8 — Expose via cloudflared (optional but recommended)

For browser access from anywhere:

```bash
# Edit /etc/cloudflared/config.yml — add an ingress entry BEFORE the
# catch-all `- service: http_status:404`:
#
#   - hostname: clanworld-dev.claude.do
#     service: http://127.0.0.1:58731
#
# Then route DNS + restart cloudflared:
cloudflared tunnel route dns do-box clanworld-dev.claude.do
sudo systemctl restart cloudflared
```

Wait ~10s for DNS propagation, then:

```bash
curl -sf -o /dev/null -w "https://clanworld-dev.claude.do/: %{http_code}\n" \
  https://clanworld-dev.claude.do/
```

Should return `200`. Browse from your laptop.

## Step 9 — Verify end-to-end

- Browser at the public URL shows the SPA load.
- Open dev-tools Network tab — XHR calls to `/convex-api/...` should return 200.
- WebSocket upgrade to `/convex-api/...` should hold open (Convex live queries).
- World snapshot tick should advance ~ every minute (matches heartbeat cadence).
- Elder TTYDs reachable at `https://clanworld-dev.claude.do/elder-{1,2,3,4}/`
  (read-only by default; see "operator input" gotcha below).

## Step 10 — Update + commit changes

This runbook + the cutover fixes ship together in PR #608. After validating,
push any local edits + verify CI is green.

## Known gotchas

| # | Gotcha | Where it bites | Fix |
|---|---|---|---|
| 1 | `make build` only rebuilds heartbeat, not agents | edits to init-firewall.sh / entrypoint.sh seem to "not apply" | `docker build -f agents/Dockerfile -t clanworld/agents:dev .` manually |
| 2 | NAT/MANGLE flush in init-firewall.sh destroys Docker DNS | elders crash-loop ECONNREFUSED to api.anthropic.com | Fixed in PR #608 commit 2b631e2 — only flush filter table |
| 3 | Fork inherits paused state from live diamond | heartbeat reverts `ClanWorld: world paused` | `unpauseWorld()` via auto-impersonate (this runbook step 5) |
| 4 | Elder CLAN_ID env doesn't match on-chain ownership on forked-live | elder operates on wrong clan | Re-derive CLAN_ID from on-chain `getClan(uint32).owner` (step 6) |
| 5 | Vite dev on host unreachable from container | host UFW INPUT default DROP | Build static + serve via Caddy bind-mount (step 7) |
| 6 | `extra_hosts: host-gateway` points at docker0 not the container's actual gateway | `host.docker.internal` resolves to wrong IP for traffic from non-default bridges | Use static build + bind-mount approach (step 7); avoid the `host.docker.internal` path |
| 7 | apps/web build needs the public hostname baked in at build time | Convex client requires absolute URL | Decide hostname BEFORE step 7 build; rebuild on hostname change |
| 8 | `ADMIN_INJECT_ENABLED!=1` — runner has no message channel | Elders can read snapshots but can't be poked | Wire `/api/admin/inject-message` + flip the env (out-of-scope for v2.15 cutover) |
| 9 | claude TUI inside elder containers stuck on theme/login picker | OAuth token in env not auto-honored | TBD — codex investigation in flight (will be documented in PR #608 follow-up) |

## Files this runbook touches

| Location | Why |
|---|---|
| `~/code/clan-world/clan-world-game/.env` | docker compose env (CHAIN_NETWORK, secrets, CLAN_WORLD_WEB_UPSTREAM) |
| `~/code/clan-world/clan-world-game/.env.local` | Vite build-time env (VITE_CONVEX_URL points at public cloudflared) |
| `~/code/clan-world/clan-world-game/docker-compose.override.yml` | gitignored — bind-mounts apps/web/dist into Caddy |
| `~/code/clan-world/clan-world-game/agents/secrets/*.key` | bus + admin secrets |
| `~/code/clan-world/clan-world-game/agents/elder-N/.env` | per-elder OAuth + clan-id |
| `/etc/cloudflared/config.yml` | adds the public hostname ingress entry |
| Cloudflare DNS (claude.do zone) | CNAME via `cloudflared tunnel route dns` |

## Why a separate runbook

Existing runbooks (`fresh-vps-bootstrap.md`, `full-game-reset.md`,
`diamond-migration.md`) all assume the production-Vercel + production-Convex
+ real-Base-Sepolia path. This runbook is the FIRST one that wires the
whole stack on docker-compose with a forked chain, self-hosted Convex, and
locally-served SPA. The split keeps each runbook lean — if you want
prod-shape, follow the existing ones; for self-hosted, follow this one.
