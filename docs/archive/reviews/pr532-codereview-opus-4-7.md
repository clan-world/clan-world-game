# Phase Super-Swarm Review — PR #532 (head 1ed8d60)

## SUMMARY

Verdict: **NEEDS_FIXES** (small) — the integration is coherent and the SettleLatch removal is clean across runtime code/tests. No data-corruption or auth-bypass bugs. The blockers I'd address before Liam-merge are (1) a heartbeat container missing an explicit `depends_on: anvil-fork` in the dev profile (cold-start race window), (2) the `is_local_origin` prod-guard rejects valid prod hosts whose name starts with `convex-backend` and accepts IPv6 loopback `[::1]`, and (3) the heartbeat README overstates the success-file semantics (claims "successful webhook POST" but the marker writes even when the webhook 4xx/5xxes). Everything else is MEDIUM/LOW polish. Recommend: fix the three above (≤10-line patches each) then merge to `dev`.

## HIGH severity findings

**H1 — `is_local_origin` prod-guard: false-negative on IPv6 loopback, false-positive on hostnames beginning with `convex-backend`.** `bin/deploy-convex.sh:34-37`. Glob-style bash equality (`[[ "$value" == http://convex-backend* ]]`) prefix-matches the URL string, so:
- `http://convex-backend-prod.example.com` is REJECTED as "local" (false positive — blocks a legitimate prod URL).
- `http://[::1]/`, `http://[::ffff:127.0.0.1]/`, `http://0.0.0.0/`, `http://10.0.0.5/` are ACCEPTED as prod (false negative on IPv6 loopback / 0.0.0.0).

The over-strict positive blocks any future prod hostname namespaced `convex-backend.*` (e.g. `convex-backend.clan.world`); the loopback gap means a misconfigured `.env.local` with IPv6 localhost slips through `make deploy-convex CHAIN_NETWORK=prod`. Fix: tighten globs to require a port or path terminator and add `[::1]`/`0.0.0.0`:

```bash
case "$value" in
  http://localhost|http://localhost:*|http://localhost/*) return 0;;
  http://127.0.0.1|http://127.0.0.1:*|http://127.0.0.1/*) return 0;;
  "http://[::1]"|"http://[::1]:"*|"http://[::1]/"*) return 0;;
  http://0.0.0.0|http://0.0.0.0:*|http://0.0.0.0/*) return 0;;
  http://convex-backend|http://convex-backend:*|http://convex-backend/*) return 0;;
  https://...) ...;;
esac
```

## MEDIUM severity findings

**M1 — `heartbeat` service missing `depends_on: anvil-fork` in dev profile.** `docker-compose.yml:228-238`. Heartbeat depends on `convex-backend: service_healthy` only. In dev, the entrypoint runs `cast chain-id` against `anvil-fork:8545` with up to 30×2s = 60s of retry. anvil-fork has `start_period: 20s` plus 3×15s healthcheck (worst case ~65s before reported healthy). With backend usually faster than anvil to become healthy, the heartbeat preflight can race anvil cold-start and exit fatally; combined with the new `restart: on-failure:5` it can burn its retry budget in well under a minute on a slow VPS. Add to dev profile only:

```yaml
heartbeat:
  depends_on:
    convex-backend: { condition: service_healthy }
    anvil-fork:     { condition: service_healthy }   # dev only — see profile guard below
```

Compose 2.x supports the conditional via per-service overrides; otherwise widen `RPC_RETRY_MAX` from 30 to ~60.

**M2 — Webhook auth uses non-constant-time string equality.** `apps/server/convex/heartbeat.ts:127`. `auth !== \`Bearer ${secret}\`` leaks length/prefix timing. With a high-entropy secret the practical exploit cost is high, but Convex HTTP actions are reachable from anywhere the routed `.site` origin is exposed in prod. Fix: compare via `crypto.timingSafeEqual` after normalizing both buffers to the same length, or hash both sides with HMAC-SHA256 and compare hashes.

**M3 — `CONVEX_BACKEND_TAG` / `CONVEX_DASHBOARD_TAG` default to `:latest`.** `docker-compose.yml:92, 113`. `.env.template:215-216` sets them to `latest` as ship default. Self-hosted Convex backend is the source of truth for game state; pulling an unpinned image lets an upstream supply-chain compromise or behaviour change land on next `compose up` with zero audit trail. Pin to a specific image digest in `.env.template` (recommended) and document upgrade procedure. Same applies to the new socat proxy image (which IS pinned at `1.7.4.4` — good) and to `node:22-alpine` in `agents/heartbeat/Dockerfile:3` (also unpinned, lower blast radius).

**M4 — `convex_data` volume path changed from `/data` to `/convex/data`.** `docker-compose.yml:104`. The change is silent; if upstream `ghcr.io/get-convex/convex-backend:latest` ever expected `/data` and you don't see persisted data after the next image bump, you'd lose state on the bump. There's no runbook entry pointing operators at this if a future image regressed. Add a one-line comment near the volume mount linking to the upstream path docs, and bake a startup assertion (e.g. `make check-stack-health`) that verifies `/convex/data` is writable and non-empty after first deploy.

**M5 — Rate-limited heartbeat windows can age the healthcheck marker past `HEARTBEAT_HEALTH_THRESHOLD_S`.** `packages/runner/src/heartbeatScheduler.ts:202-213`, `agents/heartbeat/README.md:42-52`. Rate-limited path correctly returns success without writing the marker (no tx was sent — nothing to record). The README documents keeping the threshold > on-chain interval, but doesn't mention that an unexpectedly long rate-limit window (e.g. RPC clock skew, owner widens `heartbeatIntervalSeconds`) will flap the container "unhealthy" even though the scheduler is functioning normally. Either (a) touch the marker on rate-limit too, OR (b) add an explicit README note: "If you widen `heartbeatIntervalSeconds()`, restart this container with a wider `HEARTBEAT_HEALTH_THRESHOLD_S`." (b) is the safer choice — touching on rate-limit hides real on-chain stalls.

**M6 — `bin/backup-convex.sh` defaults `CONVEX_SELF_HOSTED_URL` to loopback even when run on a prod host.** `bin/backup-convex.sh:21`. If an operator runs `make backup-convex` on the prod VPS without first sourcing a prod-routed URL, the backup targets `http://127.0.0.1:3210` — which in a fresh shell may resolve to nothing (convex-backend is on the docker network, not the host loopback unless the `convex-backend-dev-port` proxy is up). The script will produce an error or, worse, succeed against the wrong (dev) instance if the proxy is up. Compare with `bin/deploy-convex.sh:60`, which calls `require_prod_origins` to fail-loud. backup-convex.sh has no prod guard. Add `[[ "${CHAIN_NETWORK:-dev}" == "prod" && -z "${CONVEX_SELF_HOSTED_URL:-}" ]] && fail` plus the same `is_local_origin` rejection.

**M7 — `EXPECTED_CHAIN_ID=84532` hardcoded for prod in entrypoint.** `agents/heartbeat/entrypoint.sh:13-16`. Today the project targets Base Sepolia only (per `CLAUDE.md` §6) so this is correct. The risk is silent: when ClanWorld migrates off Base Sepolia, this hard-coded assertion will pass against a different chain with the same id or fail against a different chain id without the developer realising the entrypoint was the gate. Add a one-line README note ("if the prod chain changes, update entrypoint.sh:7-16 and re-verify viem's `baseSepolia` chain config in `packages/shared/src/adapters`"), OR move the expected id into env (`EXPECTED_CHAIN_ID_DEV=84532 EXPECTED_CHAIN_ID_PROD=84532`).

## LOW severity findings

**L1 — README overstates success-file semantics.** `agents/heartbeat/README.md:42-46`. Says "after either (a) a confirmed heartbeat transaction with a **successful webhook POST**". Code: `runnerCastHeartbeat.ts:142-146` writes the marker AFTER `postHeartbeatWebhook()`, but that helper catches all errors (HTTP 4xx/5xx + network exceptions) and never throws — so the marker is written even when Convex rejects the bearer or is unreachable. The README's later paragraph correctly clarifies "webhook and runnerStatus failures … are non-fatal" — but the bullet contradicts. Drop "with a successful webhook POST" from item (a).

**L2 — Stale SettleLatch prose in planning doc.** `docs/plans/dockerize-v1-revision-notes.md:65` still says "coordinates with SettleLatch so Cycle A waits for Cycle B." Cycle B in `tickLoop.ts` no longer signals Cycle A. Update or strike.

**L3 — Compose comment makes an unverifiable inline claim.** `docker-compose.yml:127`. "Verified 2026-05-21: ghcr.io/get-convex/convex-dashboard:latest includes /usr/bin/curl" — an ephemeral fact tied to whatever `:latest` resolves to today. With M3 in place (pin tag/digest), this comment becomes stable. Until then, replace with a Dockerfile-side `RUN command -v curl` check or revert to `wget --spider` (the previous, equally valid healthcheck).

**L4 — `CONVEX_DEPLOY_URL` set on heartbeat container is dead env.** `docker-compose.yml:221`. The container also receives `CONVEX_WEBHOOK_URL` explicitly, so `configFromEnv` skips the `CONVEX_DEPLOY_URL`→`.convex.site` derivation. Removing `CONVEX_DEPLOY_URL` from the heartbeat env makes the boundary obvious.

**L5 — `Makefile` `reset-anvil` silently no-ops on non-default project name.** `Makefile:51-58`. `docker volume rm clan-world_anvil_data || true` assumes `COMPOSE_PROJECT_NAME` defaults to `clan-world`. If the user clones into a different directory, the named volume is `<dirname>_anvil_data` and the recipe deletes nothing while reporting success. Either compute the project name via `$(notdir $(CURDIR))` or call `docker compose down -v anvil-fork`.

**L6 — `bin/import-convex-schema.sh` doesn't enforce 0600 on pre-existing `HOSTED_CONVEX_EXPORT_ZIP`.** `bin/import-convex-schema.sh:50-82`. Only freshly-exported zips get `chmod 0600`. External zips supplied by the operator keep their original perms. Low impact (operator-supplied) but worth a one-line `chmod 0600 "$export_zip"` after the existence check.

**L7 — bash-isms in heartbeat entrypoint despite `#!/bin/sh`.** `agents/heartbeat/entrypoint.sh:1` declares `/bin/sh` but uses only POSIX-portable forms — actually clean. (No finding; verified as correct.)

**L8 — `apps/server/package.json` deploy script depends on env-time variable expansion.** `apps/server/package.json:11`. `npx -y convex@${CONVEX_CLI_PINNED_VERSION:-1.39.1}` works because the shell invoking pnpm expands `${...}`. The same pattern is also in `packages/sdk/package.json`. Cross-package version skew if `CONVEX_CLI_PINNED_VERSION` is set globally in one shell but not another. The deploy/backup/import shell scripts all guard with `check_cli_version` against `CONVEX_CLI_PINNED_VERSION` — so the gate is in shell, not in pnpm scripts. OK as defence in depth; consider centralising the default in one source so the `1.39.1` literal isn't duplicated across three files (drift risk during the next bump).

## Cross-cutting observations

- **SettleLatch removal is clean.** No runtime references to `SettleLatch` / `markSettled` / `lastSettledTick` remain in `packages/runner/src/`, `packages/runner/test/`, `apps/orchestrator/`, `apps/server/convex/`, or `packages/agents/`. The only residue is one prose line in `docs/plans/dockerize-v1-revision-notes.md` (L2). Test fixtures that previously mocked the latch have been removed. The new `writeHeartbeatSuccessFile()` call sites correctly cover both success paths (callHeartbeat() and the receipt-timeout recovery in heartbeatScheduler.ts) and consciously skip rate-limited (M5).
- **Schema source-of-truth respected.** `apps/server/convex/schema.ts` re-exports `@clan-world/sdk/convex/schema.ts` — no drift surface.
- **Webhook + runnerStatus auth is mandatory, fail-closed**, with `INDEXER_SECRET` consistently required across the heartbeat container env and the Convex env. The runner DOES use INDEXER_SECRET (via `IConvexClient.postRunnerStatus`); it is not dead env.
- **Phase goal delivered.** Compose now boots a full self-hosted Convex (backend + dashboard + dev-only host loopback proxies), an anvil-fork dev RPC, and a heartbeat container running the existing `@clan-world/runner heartbeat` loop — with bootstrap, backup, import, deploy, and health-check make targets backed by guarded shell scripts. No state-machine drift between sim and real heartbeat paths now that the latch coordination is gone.
- **Container security posture is acceptable for hackathon.** Secrets via Docker file-secrets (not env), `agents/secrets/` and `agents/backups/` in `.dockerignore` + `.gitignore`, `0700` directories and `0600` keys, no host crontab bind-mount. Image pinning (M3) and timing-safe auth (M2) are the residual security debt items.
- **Hackathon-scope discipline observed.** Minimal-tests rule respected (the heartbeat tests cover happy path + the EACCES fault-tolerance branch + the receipt-timeout recovery path). Env-var simplicity rule respected (one var per concept; CONVEX_WEBHOOK_URL fail-loud rather than silent fallback). Aligns with `CLAUDE.md` §4.
EXIT=0
