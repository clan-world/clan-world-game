# Phase Super-Swarm Review — PR #525 (head 44f72e4)

## SUMMARY
NEEDS_FIXES. Scope is mostly honored: this does containerize the existing TypeScript heartbeat loop instead of rewriting it. The main issues are on the integration seam: the health signal misses one scheduler success path, dev boot can race `anvil-fork`, and the root env template still does not match the new compose contract.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- `packages/runner/src/runnerCastHeartbeat.ts:143` and `packages/runner/src/heartbeatScheduler.ts:215`: `/tmp/last-heartbeat-success` is written only on the direct receipt-confirmed success path inside `callHeartbeat()`. The scheduler has a second success path for `HeartbeatTimeoutError` where `nextHeartbeatAtTs` advanced (`heartbeatScheduler.ts:215-231`), and it already records that as `lastFireResult: 'success'`. In that case chain progress is real, but the health file is stale, so compose can mark the container unhealthy while the loop is behaving correctly. Suggested fix: move the success-file touch to the scheduler-level success boundary, or expose a helper/callback and invoke it for both direct success and timeout-with-advanced-state.
- `docker-compose.yml:196-199` and `agents/heartbeat/entrypoint.sh:11-27`: in `CHAIN_NETWORK=dev`, the container needs `anvil-fork`, but `depends_on` only gates on `convex-backend`. A fresh `docker compose up` can therefore start heartbeat before the fork RPC is listening; the entrypoint fails `cast chain-id`, then relies on `restart: on-failure:5` to eventually recover. That is a boot-order race, not a deterministic startup contract. Suggested fix: in dev profile, add an explicit healthy dependency on `anvil-fork`, or split dev/prod heartbeat services so the dev one can depend on the fork cleanly.
- `docker-compose.yml:188` and `.env.template:47-52`: the PR makes `CONVEX_WEBHOOK_URL` compose-required, but the root template still documents it as optional/commented-out. Following the repo’s documented “copy template then run compose” path will fail before the container starts, even though `agents/heartbeat/README.md` lists `docker compose --profile dev config` as a smoke test. Suggested fix: give `.env.template` a concrete self-hosted default or make compose supply the dev default directly.

## LOW severity findings
- `agents/heartbeat/Dockerfile:3`: the runtime image runs as root even though it only needs Node, `cast`, network access, `/tmp`, and a read-only secret mount. Drop to the existing `node` user after the copy/chmod step.
- `agents/heartbeat/entrypoint.sh:33-38`: the prod RPC guard only rejects URLs containing `anvil-fork`, `localhost`, or `127.0.0.1`. That misses common dev-local spellings like `0.0.0.0`, `[::1]`, `host.docker.internal`, or another Docker service alias. If the intent is “prod must not point at local/dev RPC,” parse the host and reject loopback plus known local aliases.
- `packages/runner/test/runnerCastHeartbeat.test.ts`: there is still no test coverage for the success-file writer. This is now a load-bearing ops seam because the compose healthcheck trusts that file completely.

## Cross-cutting observations
- Architectural drift is low. Exporting `RPC_URL_PRIMARY` in the entrypoint to preserve `configFromEnv()` is the cleanest part of the patch.
- Secret handling is mixed. `WEBHOOK_SHARED_SECRET_FILE` is a good move, but the service still grows a stronger runtime contract with compose than the root template advertises.
- The healthcheck model is directionally right, but it is tied to scheduler semantics now. That means the success-file update should live at the scheduler’s notion of success, not only at the wallet client’s happiest path.