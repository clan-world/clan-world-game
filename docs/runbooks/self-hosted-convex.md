# Self-Hosted Convex Runbook

Issue #347 stands up Convex backend + dashboard inside the compose stack and
deploys the existing `apps/server/convex/` functions against the canonical SDK
schema in `packages/sdk/convex/schema.ts`.

## First Bootstrap

1. Start the backend, start the dev backend loopback proxy, and generate a
   CLI/dashboard admin key:

   ```bash
   make bootstrap-convex-admin-key PROFILE=dev
   ```

2. Back up `agents/secrets/convex-admin.key` to the operator password manager.
   The backend does not read this file on boot; it derives the key from the
   instance secret persisted inside the `convex_data` Docker volume.

3. Deploy code:

   ```bash
   make deploy-convex
   ```

## Deploy Sequence

`make deploy-convex` runs:

```bash
pnpm --filter @clan-world/sdk convex:codegen
pnpm --filter @clan-world/server convex:codegen
pnpm typecheck
pnpm --filter @clan-world/server convex:deploy
```

The deploy script exports `CONVEX_SELF_HOSTED_URL` and
`CONVEX_SELF_HOSTED_ADMIN_KEY` for the Convex CLI. There is no `--self-hosted`
Convex CLI flag in the supported flow.

## Post-Deploy Env (REQUIRED — the runner pipeline depends on this)

After first deploy, set the indexer env on the self-hosted deployment. **These
must be set or the per-tick runner pipeline silently dies** (tickClock freezes →
runners never wake the elders). Run from `apps/server`, and see the
deploy-target gotcha below — bare `convex` may target the cloud project:

```bash
cd apps/server
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat ../../agents/secrets/convex-admin.key)"

npx -y convex@1.39.1 env set CLANWORLD_USE_REAL_INDEXER true
npx -y convex@1.39.1 env set INDEXER_START_BLOCK <see below>
npx -y convex@1.39.1 env set INDEXER_SECRET <secret>
npx -y convex@1.39.1 env set RPC_URL_PRIMARY <see below — fork vs prod>
npx -y convex@1.39.1 env set CLAN_WORLD_CONTRACT_ADDRESS <diamond>
npx -y convex@1.39.1 env set CLAN_WORLD_LENS_ADDRESS <lens>
npx -y convex@1.39.1 env set WEBHOOK_SHARED_SECRET <secret>
```

### `RPC_URL_PRIMARY` — anvil-fork dev backend vs prod (the #1 footgun)

There are **two distinct `RPC_URL_PRIMARY` scopes** — do not confuse them:

| Scope | Where | What it should be | Why |
|---|---|---|---|
| **compose / host `.env`** | `docker-compose.yml` → `anvil-fork --fork-url=${RPC_URL_PRIMARY}` | the **upstream** Base-Sepolia RPC to fork *from* | seeds the local fork once at boot |
| **Convex deployment env** (this section) | the indexer reads this to poll the chain | **`http://anvil-fork:8545`** for a dev/anvil-fork backend | the indexer must read the **fork** (where ticks actually advance), not prod |

If the Convex `RPC_URL_PRIMARY` is left pointing at prod Base-Sepolia on an
anvil-fork dev stack, the indexer polls the wrong chain, never sees the fork's
advancing ticks, and `tickClock` never moves — the runner goes silent and the
elders are never prompted. This was the root cause of the 2026-05-26 outage.

For a **prod** deployment (real Base Sepolia), `RPC_URL_PRIMARY` is the real RPC
and both scopes coincide.

### `INDEXER_START_BLOCK` — fork-relative

The real-indexer log poller scans forward from this block in 9-block chunks, so
do **not** set it to an old block on a high-numbered fork (huge backfill).
For an anvil-fork dev backend set it near the **current fork tip**:

```bash
TIP=$(docker exec clan-world-anvil-fork-1 cast block-number --rpc-url http://localhost:8545)
npx -y convex@1.39.1 env set INDEXER_START_BLOCK $((TIP - 100))
```

The snapshot-fallback cron (`apps/server/convex/crons.ts`, registered when
`CLANWORLD_USE_REAL_INDEXER=true`) reads the chain tip directly and writes
`tickClock` even while the world is paused — that is what drives the runner.

The heartbeat container posts HTTP actions to
`CONVEX_WEBHOOK_URL=http://convex-backend:3211`.

## Deploy / Query Target Gotchas (self-hosted vs cloud)

`apps/server/.env.local` contains a **cloud** project pointer
(`CONVEX_DEPLOYMENT=dev:valuable-kudu-985`, `CONVEX_URL=...convex.cloud`) used by
`npx convex dev`. The Convex CLI auto-reads `.env.local`, and this **hijacks
self-hosted `deploy`/`run`/`function-spec`** even when `CONVEX_SELF_HOSTED_URL`
is exported — commands silently target the cloud project instead of
`http://127.0.0.1:3210`.

- **Symptom:** `convex deploy` prompts "push to your prod deployment
  good-blackbird-83.convex.cloud"; `convex run runner:...` returns
  "Could not find function" (cloud lacks the function you just deployed locally).
- **Fix:** temporarily comment out `CONVEX_DEPLOYMENT` / `CONVEX_URL` /
  `CONVEX_SITE_URL` in `.env.local` for the duration of the self-hosted command,
  with `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY` exported, then
  restore. (`make deploy-convex` handles this; manual `convex` invocations do not.)
- **CLI version:** use `npx -y convex@1.39.1` (the pinned version). The
  repo-local `node_modules/.bin/convex` (1.17.3) does **not** support self-hosted
  `deploy`/`run` via `CONVEX_SELF_HOSTED_URL`.

### `node:fs` bundling pitfall (fixed PR #620 — keep it fixed)

Convex functions run in a V8 runtime that cannot resolve Node built-ins. If any
deployed convex function transitively imports a module with a top-level
`import ... from 'node:fs'` (etc.), **the entire deploy fails** with
`Could not resolve "node:fs"` — which silently freezes the deployment on its
last-good bundle. This happened via `convex/{heartbeat,indexer}.ts` importing
`baseSepolia` from the `@clan-world/shared/adapters` barrel, which re-exported
`IChainClient.ts` (node:fs). Fixed by importing chain defs from the pure
`@clan-world/shared/adapters/chains` subpath. **Rule:** convex functions must
only import from node:fs-free modules; never import the adapters barrel from a
convex function.

## Backup And Restore

Create a pre-migration or pre-reset backup:

```bash
make backup-convex
```

Backups are written to `agents/backups/convex-<timestamp>.zip`. The directory
is created `0700` and backup zips are chmodded `0600`.

Restore/import into a fresh self-hosted backend:

This is a destructive import. It uses `--replace-all` and is intended only for
a fresh backend or an explicitly confirmed restore.

```bash
FRESH_SELF_HOSTED=1 CONFIRM_TARGET_URL=http://127.0.0.1:3210 make import-convex-schema
```

If supplying a prebuilt hosted export with `HOSTED_CONVEX_EXPORT_ZIP`, also set
`CONFIRM_EXPORT_HAS_FILE_STORAGE=1`; the script cannot inspect external zips
to prove they include Convex file storage.

## Do Not Remove `convex_data` Casually

`clan-world_convex_data` contains:

- the SQLite database,
- file storage,
- the generated Convex instance secret,
- the root material used to derive `agents/secrets/convex-admin.key`.

Removing this volume destroys the admin-key root and all self-hosted Convex
data. Always run `make backup-convex` before any operation that might remove
`clan-world_convex_data`.

## Health Checks

```bash
make check-stack-health
```

Expected dev endpoints:

- backend API: `http://127.0.0.1:3210/version`
- dashboard: `http://127.0.0.1:6791/`
- internal HTTP actions: `http://convex-backend:3211`

If the dashboard loads but cannot authenticate, regenerate or restore
`agents/secrets/convex-admin.key` from the running backend with
`make bootstrap-convex-admin-key FORCE=1 PROFILE=dev`.

## Verify The Tick Pipeline End-To-End

"Containers healthy" does NOT mean the elders are being driven. Verify the full
chain: chain ticks → indexer → `tickClock` → runner → elder tmux paste. From
`apps/server` (with `.env.local` cloud pointer neutralized + self-hosted env
exported, per the gotchas above, using `npx -y convex@1.39.1`):

1. **runner module is deployed** (not a stale pre-runner bundle):
   ```bash
   npx -y convex@1.39.1 function-spec | grep -c '"runner.js:'   # expect > 0
   ```
2. **`tickClock` is advancing** (run twice ~70s apart; `tick` should increase):
   ```bash
   npx -y convex@1.39.1 run getTickClock:getTickClock '{}'
   ```
3. **the indexer is polling the fork** (not prod):
   ```bash
   docker logs --since 1m clan-world-convex-backend-1 2>&1 | grep -c 'anvil-fork:8545'
   ```
4. **elders are receiving ticks** (not stuck): `lastReceivedTick` should track
   the chain tick, and `ready_probe_timeout` / `invariant_violation` should NOT
   be accumulating in the `runnerEvents` table:
   ```bash
   npx -y convex@1.39.1 data runnerEvents --limit 20      # watch for ready_probe_timeout
   ```
   Ground truth is the elder pane itself:
   ```bash
   docker exec clan-world-elder-1 tmux capture-pane -t elder-1 -p -S -30 | grep -E 'tick: [0-9]+'
   ```

### Known runner-paste failure modes

- **`ready_probe_timeout` every tick, all elders, `lastReceivedTick` frozen:**
  the runner's pre-paste readiness probe doesn't recognize the Claude Code TUI
  prompt glyph. Newer Claude Code renders `❯` (U+276F) instead of ASCII `>`;
  `packages/runner/src/pasteVerification.ts` must accept the current glyph. A
  fresh elder-image rebuild that bumps the bundled Claude Code can re-break this.
- **One elder stuck while others work, `ready_probe_timeout` on just that one:**
  its startup branding (`/rename`, `/color`) is sitting unsubmitted in the input
  box (post-paste-submit race), so the input is never "empty/ready". Nudge it:
  `docker exec clan-world-elder-N tmux send-keys -t elder-N Enter`.
- **`invariant_violation: post-paste input stuck`:** the elder is busy
  processing a prior tick when the next paste lands; usually self-heals via the
  resend cap. Persistent violations across an idle elder indicate a real paste
  problem.

> Note: the elder runtime is **baked** into the image (`agents/Dockerfile` copies
> `packages/runner/` → `/opt/elder-runtime/`). A live hot-patch
> (`docker cp ... && docker restart`) survives `docker restart` but is reverted
> by any `docker compose up --force-recreate` / image rebuild. Always land the
> source fix + rebuild the image to make a runner fix durable.
