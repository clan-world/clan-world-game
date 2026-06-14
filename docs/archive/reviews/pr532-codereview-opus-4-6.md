# Phase Super-Swarm Review — PR #532 (head 1ed8d60)

## SUMMARY

**Verdict: CLEAN** — no blocking findings. The phase coherently delivers containerized heartbeat, self-hosted Convex backend + dashboard, SettleLatch removal, and compose scaffold with proper integration seams. The SettleLatch removal is mechanically complete with zero dangling references. Env var management is consistent across shell scripts, compose, and `.env.template`. Docker security posture is solid (secrets mounted at runtime, `.dockerignore` excludes sensitive paths, images pin versions where it matters). Two MEDIUM findings around env-var workflow ergonomics and a runbook path error; four LOW nits. **Recommend merge.**

## HIGH severity findings

CLEAN — no findings.

## MEDIUM severity findings

### M-1: `.env.template` nested variable expansion is shell-only — silent misconfig if used as Docker Compose `.env`

**File:** `.env.template:105,109,116`

`.env.template` defines derived values using nested shell expansion:

```
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}
CONVEX_CLOUD_ORIGIN=http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}
CONVEX_DASHBOARD_DEPLOYMENT_URL=http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}
```

Docker Compose's `.env` file reader performs single-level `${VAR:-default}` substitution but does **not** recursively expand variables within values. If an operator copies `.env.template` to `.env` (a common pattern), `CONVEX_CLOUD_ORIGIN` would be the literal string `http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}`, not the expanded URL. The Convex backend would receive a broken origin.

The intended workflow (Makefile targets / shell scripts that `source .env && source .env.local`) handles this correctly because Bash does full expansion. But the footgun exists for anyone who runs `docker compose --profile dev up` directly after creating a `.env` file from the template.

**Suggested fix:** Add a comment at the top of `.env.template` warning that these derived values require shell sourcing (not direct Docker Compose `.env` usage), or replace the nested expansions with hardcoded defaults (`http://127.0.0.1:3210`) and add a comment saying to update if `CONVEX_BACKEND_HOST_PORT` is changed. Alternatively, add a `# shellcheck` directive or a short `bin/env-check.sh` that validates expansion.

### M-2: Volume mount path changed from `/data` to `/convex/data` — upgrade-in-place data visibility

**File:** `docker-compose.yml:104` (new) vs prior `convex_data:/data`

The `convex_data` named volume mount point changed from `/data` to `/convex/data`. For a fresh deployment this is fine. For anyone who ran the prior compose (from the #347 scaffold), the volume contains data written under the old internal path. If the self-hosted Convex backend image expects its SQLite DB at `/convex/data`, the existing volume's data at the old mount point would be invisible — the backend would initialize a new instance, generating a new instance secret and orphaning the previous admin key.

**Suggested fix:** Confirm that the `ghcr.io/get-convex/convex-backend:latest` image's `WORKDIR` or data directory is `/convex/data`. If this is the correct path for the current image version, add a note to the self-hosted Convex runbook warning that upgrading from the prior #347 scaffold requires either (a) a volume migration or (b) a fresh bootstrap with `make bootstrap-convex-admin-key FORCE=1`. If the image actually expects `/data`, revert the mount.

### M-3: Anvil-fork runbook references wrong Makefile path

**File:** `docs/runbooks/anvil-fork-dev-rpc.md:95,99`

The runbook instructs operators to run `make -C agents reset-anvil PROFILE=dev` and attributes the target to `agents/Makefile`. The `reset-anvil` target is in the **root** `Makefile` (line 223). `make -C agents` would look for `agents/Makefile`, which either doesn't exist or doesn't have this target, causing a confusing error.

The runbook also states "the Makefile target fails loud if PROFILE is unset or PROFILE=prod" but the root Makefile's `reset-anvil` hardcodes `--profile dev` with no such guard.

**Suggested fix:** Change to `make reset-anvil` (no `-C agents`). Remove or correct the claim about PROFILE guards.

## LOW severity findings

### L-1: Convex backend and dashboard images default to `:latest`

**File:** `docker-compose.yml:87,113`

`CONVEX_BACKEND_TAG` and `CONVEX_DASHBOARD_TAG` default to `latest`. In a hackathon context this is acceptable, but an unnoticed upstream image update could break the stack. The Foundry and socat images are correctly pinned.

**Suggested fix:** Pin to a tested digest or tag in `.env.template` before production use. File a follow-up issue.

### L-2: `node:22-alpine` base image not fully pinned in heartbeat Dockerfile

**File:** `agents/heartbeat/Dockerfile:3`

`node:22-alpine` floats with Alpine and Node patch releases. A SHA pin (`node:22-alpine@sha256:...`) would guarantee reproducible builds.

**Suggested fix:** Pin to a digest for production; acceptable as-is for hackathon.

### L-3: `CONVEX_DEPLOY_URL` is redundant in heartbeat service

**File:** `docker-compose.yml:208`

The heartbeat service sets both `CONVEX_URL` (for `createConvexClient()`) and `CONVEX_DEPLOY_URL`. Since `CONVEX_WEBHOOK_URL` is now explicitly set, the `deriveConvexWebhookUrl()` fallback that reads `CONVEX_DEPLOY_URL` is never reached. Keeping both isn't harmful but adds confusion about which URL serves which purpose.

**Suggested fix:** Remove `CONVEX_DEPLOY_URL` from the heartbeat service if it's confirmed unused, or add a comment explaining why it's still needed.

### L-4: Entrypoint does not validate `RUNNER_PRIVATE_KEY` format

**File:** `agents/heartbeat/entrypoint.sh`

The entrypoint validates `CHAIN_NETWORK`, RPC reachability, chain ID, contract address, and webhook secret — but not `RUNNER_PRIVATE_KEY`. A malformed key (wrong length, non-hex) passes preflight and fails deep inside the Node runner with an opaque viem error. Compose-level `:?` catches _missing_ values but not malformed ones.

**Suggested fix:** Add a quick format check (64 hex chars, optionally `0x`-prefixed) to the entrypoint preflight, or accept the current behavior since the runner fails fast anyway.

## Cross-cutting observations

**SettleLatch removal is complete.** Zero dangling references in source, tests, or configs. The only remaining `lastSettledTick` references are in the Solidity `Clan` struct (game state, unrelated). Replacement pattern (independent heartbeat cadence gated only by on-chain `nextHeartbeatAtTs`) is correct — no new timing issues introduced.

**Heartbeat success file coverage is correct.** `writeHeartbeatSuccessFile()` is called on both success paths: (1) inside `RunnerCastHeartbeat.callHeartbeat()` after receipt confirmation, and (2) in `heartbeatScheduler.ts`'s timeout-recovery path when on-chain state is observed to have advanced. The Docker healthcheck reads the same `/tmp/last-heartbeat-success` path (overridable via `HEARTBEAT_SUCCESS_FILE_OVERRIDE`), using the container-env `HEARTBEAT_HEALTH_THRESHOLD_S`. The `start_period: 60s` gives the first heartbeat time to land before healthchecks begin.

**Secret management is sound.** The `convex-admin-key` Docker secret was correctly removed — the self-hosted backend generates and persists its own instance secret in the `convex_data` volume; the admin key is derived post-boot via `make bootstrap-convex-admin-key`. The webhook shared secret remains file-mounted via Docker secrets. The entrypoint's secret-file reader correctly trims trailing whitespace and rejects embedded newlines/CRs.

**Deploy-time prod safety gates work.** `deploy-convex.sh:require_prod_origins()` rejects localhost/internal URLs for `CONVEX_CLOUD_ORIGIN`, `CONVEX_SITE_ORIGIN`, and `CONVEX_DASHBOARD_DEPLOYMENT_URL` when `CHAIN_NETWORK=prod`. The heartbeat entrypoint similarly rejects anvil/localhost RPC URLs in prod mode.

**Dev-only loopback proxy pattern is clean.** The `convex-backend-dev-port` and `convex-dashboard-dev-port` socat services bind `127.0.0.1` only (no wildcard exposure), are `profiles: [dev]` only, and depend on the upstream service being healthy before forwarding. This correctly separates dev convenience from prod network isolation.
EXIT=0
