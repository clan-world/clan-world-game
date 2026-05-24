# Phase Super-Swarm Review — PR #525 R2 (head 72e96fb)

## SUMMARY
NEEDS_FIXES. The Round 1 fixes landed correctly, successfully improving container security, least-privilege variable passing, and heartbeat healthcheck reliability. However, the fix-round introduced two new severe bugs: a hardcoded absolute file path in Vitest tests that will cause parallel test suite flakiness, and a startup race condition in Docker Compose where the heartbeat container quickly exhausts its restart budget and permanently dies before the dev RPC service completes its slow boot sequence. Recommend fixing these two high-severity issues before merging.

## R1 FIX VERIFICATION

| R1 Finding | Status | Notes |
|---|---|---|
| USER node directive | LANDED | `USER node` is set correctly in `agents/heartbeat/Dockerfile` after copying files and applying `chown`. |
| writeHeartbeatSuccessFile timeout-success | LANDED | `writeHeartbeatSuccessFile()` is now explicitly invoked in `attemptHeartbeatWithBackoff` after resolving the advanced-chain receipt timeout. |
| env_file → allowlist | LANDED | `env_file: [.env]` was successfully removed from `docker-compose.yml`, replaced with an explicit allowlist and `:?` assertions. |
| init: true | LANDED | `init: true` is present on the `heartbeat` service in `docker-compose.yml`. |
| HEARTBEAT_HEALTH_THRESHOLD_S | LANDED | `HEARTBEAT_HEALTH_THRESHOLD_S` is passed into the environment and correctly expands inside the shell healthcheck via the escaped `$$HEARTBEAT_HEALTH_THRESHOLD_S`. |

## HIGH severity findings
(new in R2)

1. **Test Flake / Concurrency Bug: Hardcoded `/tmp/last-heartbeat-success` in parallel tests**
   Both `heartbeatScheduler.test.ts` and `runnerCastHeartbeat.test.ts` use the hardcoded absolute path `/tmp/last-heartbeat-success` for testing the success file logic. Both files also execute `rmSync` on this exact path in their `beforeEach` and `afterEach` hooks. Because Vitest runs test files in parallel by default across multiple workers, these files will race and overwrite/delete each other's test state on the host file system, leading to persistent flaky test failures.
   **Fix:** Accept an optional `successFile` path in `startHeartbeatScheduler` and test with dynamically generated, isolated temp files (e.g., `mkdtempSync(join(tmpdir(), '...'))`) instead of a shared global `/tmp` path.

2. **Startup Race Condition: `heartbeat` exhausts restart budget before `anvil-fork` is ready**
   In `docker-compose.yml`, the `heartbeat` service is configured with `restart: on-failure:5` but lacks a dependency on the `anvil-fork` service. In the `dev` profile, `anvil-fork` takes several seconds to boot up and load state. The `heartbeat` container's `entrypoint.sh` immediately executes a `cast chain-id` preflight check upon booting; if it fails, the container crashes. Docker Compose executes its 5 immediate retries without a backoff delay, meaning the `heartbeat` service will permanently fail and stop within ~1 second—long before `anvil-fork` is healthy and ready to serve RPC requests. This completely breaks the dev profile flow.
   **Fix:** Introduce a sleep backoff loop inside `entrypoint.sh` (e.g., `until cast chain-id ...; do sleep 2; done`) before failing the script, or add an explicit `depends_on: anvil-fork: condition: service_healthy` check for the `dev` profile.

## MEDIUM severity findings
(new in R2)

*(None)*

## LOW severity findings
(new in R2)

1. **Carriage returns (`\r`) in `WEBHOOK_SHARED_SECRET_FILE` invalidate HMAC**
   In `entrypoint.sh`, the assignment `WEBHOOK_SHARED_SECRET="$(cat "$WEBHOOK_SHARED_SECRET_FILE")"` cleanly strips trailing UNIX newlines (`\n`), but if the mounted Docker secret file was generated with Windows line endings (`\r\n`), the trailing carriage return (`\r`) will be retained in the exported variable. This silent inclusion of whitespace will cause all Convex webhook HMAC signatures to fail validation.
   **Fix:** Use `tr -d '\r\n'` instead of `cat` to safely trim whitespace when reading the secret file.