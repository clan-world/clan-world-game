# Phase Super-Swarm Review — PR #525 R2 (head 72e96fb)

## SUMMARY

**CLEAN — ready to merge.** All five R1 MUST/SHOULD fixes landed correctly and semantically. The fix-round commit (`72e96fb`) is tight: ~99 lines across 7 files, narrowly scoped to the R1 punch-list. No new HIGH/MED bugs introduced; only a handful of LOW test-hygiene and image-size nits that can be deferred. Verified against the R1→R2 git diff (`git diff 44f72e4..72e96fb`).

## R1 FIX VERIFICATION

| R1 Finding | Status | Notes |
|---|---|---|
| USER node directive | LANDED | `agents/heartbeat/Dockerfile:39-40` — `RUN chown -R node:node /app` then `USER node` placed AFTER `touch .env.local` + `chmod +x` so both ops still execute as root. Entrypoint becomes effective. |
| writeHeartbeatSuccessFile timeout-success | LANDED | `packages/runner/src/heartbeatScheduler.ts:232` — call added inside the `nextAfterTimeout > deps.nextHeartbeatAtTs` branch, right before `return { success: true }`. Symmetric with the happy path in `runnerCastHeartbeat.ts:146`. Vitest case at `heartbeatScheduler.test.ts:367-368` proves it (asserts file exists + contains `'100'`). |
| env_file → allowlist | LANDED | `docker-compose.yml:173` — `env_file: [.env]` removed. R2 explicitly enumerates required keys with `:?` fail-loud on missing: `RUNNER_PRIVATE_KEY`, `INDEXER_SECRET`, `CONVEX_WEBHOOK_URL`. `CONVEX_URL=http://convex-backend:3210` added per createConvexClient requirement. |
| init: true | LANDED | `docker-compose.yml:172` — `init: true` set on the `heartbeat` service. tini handles PID-1 zombie reaping + signal forwarding to the pnpm/tsx/node chain. |
| HEARTBEAT_HEALTH_THRESHOLD_S | LANDED | `docker-compose.yml:193` declares env with `:-180` default; healthcheck on line 203 references `$$HEARTBEAT_HEALTH_THRESHOLD_S` (correctly `$$`-escaped so the var resolves inside the container, not at compose-render time). README `agents/heartbeat/README.md:54-62` explains tuning vs. on-chain cadence. |

Bonus (not on the R1 must-list but landed cleanly):
- `writeHeartbeatSuccessFile` signature changed from private to exported with optional `successFile` arg (`runnerCastHeartbeat.ts:261-269`) — enables the EACCES unit test without touching `/tmp` permissions.
- Two new vitest cases (`runnerCastHeartbeat.test.ts:165-203`) cover the happy-path write + EACCES swallow.

## HIGH severity findings

**None.**

## MEDIUM severity findings

**None.** No regressions introduced by the fix-round. The R2 changes are mechanically what R1 asked for.

## LOW severity findings

### L1 — Shared `/tmp/last-heartbeat-success` path across two test files invites cross-file flakiness
`packages/runner/test/heartbeatScheduler.test.ts:14-19` and `packages/runner/test/runnerCastHeartbeat.test.ts:36-41` both declare `cleanupHeartbeatSuccessFile()` operating on the same hard-coded `/tmp/last-heartbeat-success`. Vitest's default is one fork per test file with files running in parallel — so File A's `beforeEach` can `rmSync` the very file File B just wrote, before File B asserts on it. The tmp file uses `process.pid` to avoid collisions, but the final renamed path does not. Probability is low (only 3 tests touch the path total) but the failure mode is non-deterministic CI flake. **Fix:** parameterize `writeHeartbeatSuccessFile` to a `mkdtempSync` path in both tests (mirroring the EACCES test pattern), or set `pool: 'forks'` with `poolOptions.forks.singleFork: true` in `packages/runner/vitest.config.ts`.

### L2 — EACCES test is brittle when the test runner is uid 0
`packages/runner/test/runnerCastHeartbeat.test.ts:184-202` sets `chmodSync(unwritableDir, 0o500)` then expects `writeFileSync` to emit EACCES. Root bypasses mode bits, so if the test happens to run as uid 0 (e.g., inside a containerized CI without an explicit user) the `expect(warn).toHaveBeenCalledWith(...)` assertion fails outright. Not a vacuous pass — it'd surface loudly, but it'd block CI for a non-bug. **Fix:** `it.skipIf(process.getuid?.() === 0)` or assert behavior via a stubbed `writeFileSync` instead of relying on real FS perms.

### L3 — `RUN chown -R node:node /app` doubles image size
`agents/heartbeat/Dockerfile:39` runs `chown -R` AFTER `COPY . .`, producing a layer that contains every file again with new ownership metadata. With pnpm's `node_modules` symlink farm this can be hundreds of MB. **Fix:** `COPY --chown=node:node . .` on the prior `COPY` instruction, and drop the standalone chown. Optimization, not correctness.

### L4 — Empty `HEARTBEAT_HEALTH_THRESHOLD_S` would break the healthcheck shell
`docker-compose.yml:203` healthcheck is `[ N -lt $$HEARTBEAT_HEALTH_THRESHOLD_S ]`. The `:-180` default in the env section only applies when the host env var is unset; if the operator exports `HEARTBEAT_HEALTH_THRESHOLD_S=` (empty), Compose passes the empty string and `[ N -lt ]` becomes a `sh: -lt: argument expected` failure → container marked unhealthy on every check. **Fix:** validate numeric in the entrypoint (`case "$HEARTBEAT_HEALTH_THRESHOLD_S" in ''|*[!0-9]*) fail ... ;; esac`) OR document that the var must be a positive integer.

### L5 — `heartbeatScheduler.ts` now imports concrete `./runnerCastHeartbeat`
`packages/runner/src/heartbeatScheduler.ts:3` imports `writeHeartbeatSuccessFile` from the cast-specific module. The scheduler was previously framework-agnostic; this couples a generic dispatcher to a specific impl. Hackathon scope is fine, but the cleaner shape is an injected `onHeartbeatSuccess?: () => void` callback on `HeartbeatSchedulerDeps`. Defer.

### L6 — `RUNNER_PRIVATE_KEY` + `INDEXER_SECRET` still pass through env, visible in `docker inspect`
The env_file removal was the right move for the "kitchen sink" finding, but the two new required secrets now live in the service `environment:` block, exposed via `docker inspect`. `WEBHOOK_SHARED_SECRET_FILE` already uses the secrets pattern; mirroring it for `RUNNER_PRIVATE_KEY` (mount as `/run/secrets/runner-private-key` + entrypoint `cat`) would close the gap. Out of R1 scope; flag for follow-up.

## Cross-cutting observations

- **Scope discipline is good.** The fix-round commit message accurately summarizes what changed; no incidental refactors or unrelated cleanups slipped in.
- **The "restart: on-failure:5" change visible in the prompt's `diff.txt` is not a R2 change** — `git diff 44f72e4..72e96fb -- docker-compose.yml` confirms restart policy was already `on-failure:5` at R1 head; the `0 → 5` delta in the cumulative diff comes from the pre-R1 baseline. Worth noting so reviewers don't double-count.
- **`writeHeartbeatSuccessFile` is now reachable from two call sites** (happy path in `runnerCastHeartbeat.callHeartbeat` AND timeout-success branch in the scheduler). Both invocations are correct. Note that the scheduler-side call fires AFTER `postRunnerStatus` posts success — same ordering as the happy path, so the success-file and runnerStatus stay in lockstep.
- **Coverage matches the bug class.** The two new vitest cases (happy-path write + EACCES swallow) plus the timeout-success file-existence assertion address all three branches where the file is touched. 153 → 155 tests, all green per the prompt.

CLEAN — ready to merge.
