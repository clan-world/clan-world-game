# Phase Super-Swarm Review — PR #525 (head 44f72e4)

## SUMMARY
NEEDS_FIXES. The containerization shape is mostly sound: shell quoting is careful, secrets are mounted via Docker secrets, and the runner path preserves the existing TS scheduler. I found two cross-cutting integration issues that should be fixed before merge: health can go stale on the runner's own timeout-success path, and the documented compose smoke path fails unless operators hand-fill a webhook URL missing from the template.

## HIGH severity findings
CLEAN — no findings

## MEDIUM severity findings
- `packages/runner/src/runnerCastHeartbeat.ts:146` / `packages/runner/src/heartbeatScheduler.ts:215`: The healthcheck timestamp is written only inside `RunnerCastHeartbeat.callHeartbeat()` after `waitForTransactionReceipt()` returns success. The scheduler already has a separate success path for receipt timeouts where `nextHeartbeatAtTs` advanced (`heartbeatScheduler.ts:215-231`), and tests assert that path is success (`packages/runner/test/heartbeatScheduler.test.ts:326-352`). In that case the chain is advancing and `runnerStatus` records success, but `/tmp/last-heartbeat-success` is not refreshed, so compose marks the container unhealthy even while the heartbeat loop is doing its job. Move the success-file write to the scheduler success boundary, or expose a callback/helper and call it for both direct success and timeout-with-advanced-state.
- `docker-compose.yml:188` / `.env.template:47-52`: `CONVEX_WEBHOOK_URL` is now compose-required, but the root env template still leaves it commented out as optional/disable-able. Following the documented copy-template flow plus `docker compose --profile dev config` will fail before the container can start, despite the README listing that as a smoke test. Add a concrete self-hosted default such as `CONVEX_WEBHOOK_URL=http://convex-backend:3210` in the Docker/compose env section, or make the compose default explicit for dev/prod.
- `agents/heartbeat/Dockerfile:3`: The runtime container runs as root even though it only needs Node, `cast`, network access, `/tmp`, and a read-only Docker secret. That leaves unnecessary write authority over the whole image filesystem to a process holding the heartbeat private key and webhook secret. Add a non-root user, chown the app directory if needed, and run the entrypoint as that user; Docker secrets remain readable if mounted with suitable mode/uid or copied/exported by the entrypoint before dropping privileges.

## LOW severity findings
- `agents/heartbeat/entrypoint.sh:2`: The script uses `set -eu` but not `pipefail`. There are no pipelines today, so this is not currently breaking behavior, but adding `set -o pipefail` where supported by Alpine ash would match the requested shell hardening and prevent a future pipeline from silently passing.
- `agents/heartbeat/entrypoint.sh:33-38`: The prod local-RPC guard catches `anvil-fork`, `localhost`, and `127.0.0.1`, but misses common loopback/private spellings like `0.0.0.0`, `[::1]`, `host.docker.internal`, or another Docker service alias. If the intent is "prod must not point at local/anvil", parse the URL host and reject loopback plus known dev service names instead of substring matching only three cases.
- `docker-compose.yml:200`: The healthcheck shell assumes the timestamp file contains a clean integer. The atomic rename prevents partial target writes, but a stale bad file would make the arithmetic expression fail noisily. Consider validating with a simple numeric case pattern before arithmetic for easier operator diagnostics.
- `packages/runner/test/runnerCastHeartbeat.test.ts:169-260`: The new success-file behavior has no focused test, and the timeout-success scheduler path specifically is untested against health-file refresh. Add one minimal test around the callback/helper after moving the write out of `RunnerCastHeartbeat`.

## Cross-cutting observations
- Entrypoint variable expansion is consistently quoted, and `exec pnpm --filter @clan-world/runner heartbeat` gives Node PID 1 signal delivery, matching `heartbeatLoopMain.ts`'s SIGTERM/SIGINT handler.
- Reading `WEBHOOK_SHARED_SECRET_FILE` into `WEBHOOK_SHARED_SECRET` is reasonable for the existing bearer-auth contract; the entrypoint does not log the secret.
- The Dockerfile's manifest-first install layer is cache-friendly and `.dockerignore` excludes `.env*` plus `agents/secrets/`, so the broad `COPY . .` is not currently baking obvious secret files.
