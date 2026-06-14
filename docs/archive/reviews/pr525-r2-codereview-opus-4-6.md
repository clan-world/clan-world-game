# Phase Super-Swarm Review — PR #525 R2 (head 72e96fb)

## SUMMARY

**CLEAN — ready to merge.** All five R1 MUST/SHOULD fixes landed correctly and are semantically sound. No new HIGH or MEDIUM findings introduced by the fix-round. The `writeHeartbeatSuccessFile` implementation uses proper atomic-write (write-tmp + rename) with a non-fatal catch, and the `HEARTBEAT_HEALTH_THRESHOLD_S` env-var decoupling is wired end-to-end from compose through the healthcheck shell command. New tests actually validate the claimed behaviors.

## R1 FIX VERIFICATION

| R1 Finding | Status | Notes |
|---|---|---|
| USER node directive | LANDED | `Dockerfile:45-46`: `RUN chown -R node:node /app` then `USER node` after all COPY/RUN steps. Correct ordering — ownership set before dropping privileges. |
| writeHeartbeatSuccessFile timeout-success | LANDED | `heartbeatScheduler.ts:231`: `writeHeartbeatSuccessFile()` called inside the `nextAfterTimeout > deps.nextHeartbeatAtTs` success branch. Import added at line 3. Normal success path covered by `RunnerCastHeartbeat.callHeartbeat()` at `runnerCastHeartbeat.ts:145`. Both paths now write the file. |
| env_file → allowlist | LANDED | `docker-compose.yml`: no `env_file` directive. Explicit `${VAR:?required}` for `RUNNER_PRIVATE_KEY`, `INDEXER_SECRET`, `CONVEX_WEBHOOK_URL`, `CLAN_WORLD_CONTRACT_ADDRESS`, `CHAIN_NETWORK`. Internal Docker-network URLs (`CONVEX_URL`, `CONVEX_DEPLOY_URL`) are correctly hardcoded since they don't vary per host. |
| init: true | LANDED | `docker-compose.yml:220`: `init: true` on heartbeat service. Combined with `exec` in entrypoint.sh line 60, Node receives signals correctly as PID 2 under tini. |
| HEARTBEAT_HEALTH_THRESHOLD_S | LANDED | Compose env line sets `${HEARTBEAT_HEALTH_THRESHOLD_S:-180}`. Healthcheck uses `$$HEARTBEAT_HEALTH_THRESHOLD_S` (double-dollar escapes compose interpolation; shell evaluates the env var at runtime inside the container). Default 180s gives 3x the 60s tick interval — adequate slack. |

## HIGH severity findings

None.

## MEDIUM severity findings

None.

## LOW severity findings

**L1 — Rate-limited path does not write success file.**
`heartbeatScheduler.ts:212` returns `{ success: true, rateLimited: true }` without calling `writeHeartbeatSuccessFile()`. In single-container deployments the prior tick's success file covers the gap (age < heartbeat interval < threshold), and `start_period: 60s` handles post-restart race. Not exploitable under current deployment topology, but worth a comment if multi-caller setups are planned.

**L2 — `chown -R node:node /app` scans all of node_modules.**
`Dockerfile:45` chowns the entire `/app` tree including `node_modules`. On large lockfiles this adds 5-15s to image builds. A future optimization: install deps as node, or use `--chown=node:node` on COPY directives. Non-blocking for hackathon.

**L3 — `CONVEX_DEPLOY_URL` is vestigial in the compose heartbeat env.**
With `CONVEX_WEBHOOK_URL` now explicit and `CONVEX_URL` added for the SDK client, `CONVEX_DEPLOY_URL` only serves the `deriveConvexWebhookUrl` fallback which won't activate (self-hosted hostname doesn't match `.convex.cloud`). Harmless but could confuse operators.

## Cross-cutting observations

- Atomic write pattern (`writeFileSync` to `.pid.tmp` then `renameSync`) is correct for concurrent-read safety from the healthcheck shell.
- Entrypoint `set -eu` + `exec` + `init: true` is the correct signal-handling trifecta for Alpine containers.
- Tests use `vi.setSystemTime()` to pin `Date.now()` for deterministic success-file assertions — properly validates the fix, not just "file exists."
- The prod RPC safety guard (`entrypoint.sh:173-179`) catching `anvil-fork|localhost|127.0.0.1` is a nice defense-in-depth addition.

CLEAN — ready to merge.
