# Phase Super-Swarm Review — PR #525 R2 (head 72e96fb)

## SUMMARY
CLEAN — ready to merge. The Round 1 MUST/SHOULD fixes landed correctly: the container now runs as `node`, the timeout-with-advanced-chain success path refreshes the health timestamp, compose uses an explicit env allowlist with `init: true`, and healthcheck timing is configurable. I found no new HIGH/MED regressions in the R1→R2 delta.

## R1 FIX VERIFICATION

| R1 Finding | Status | Notes |
|---|---|---|
| USER node directive | LANDED | `agents/heartbeat/Dockerfile` chowns `/app` then switches to `USER node` before the entrypoint (`72e96fb:agents/heartbeat/Dockerfile:39-42`). |
| writeHeartbeatSuccessFile timeout-success | LANDED | `attemptHeartbeatWithBackoff` now calls `writeHeartbeatSuccessFile()` when receipt timeout is reconciled by an advanced `nextHeartbeatAtTs` (`72e96fb:packages/runner/src/heartbeatScheduler.ts:216-233`). |
| env_file → allowlist | LANDED | No `env_file` remains for heartbeat; compose passes explicit variables including `RUNNER_PRIVATE_KEY`, `INDEXER_SECRET`, `CONVEX_URL`, `CONVEX_WEBHOOK_URL`, secret file, threshold, and runner id (`72e96fb:docker-compose.yml:174-194`). |
| init: true | LANDED | Heartbeat service has `init: true` (`72e96fb:docker-compose.yml:169-173`). |
| HEARTBEAT_HEALTH_THRESHOLD_S | LANDED | Compose sets default `180` and healthcheck uses container env expansion (`72e96fb:docker-compose.yml:193,203`). README documents the tuning contract. |

## HIGH severity findings
(new in R2)

None.

## MEDIUM severity findings
(new in R2)

None.

## LOW severity findings
(new in R2)

None.

## Cross-cutting observations

The success-file helper is intentionally best-effort: it writes atomically via temp file + rename and logs/swallow failures (`72e96fb:packages/runner/src/runnerCastHeartbeat.ts:261-269`), with tests for confirmed receipt, timeout-success refresh, and EACCES swallow. One minor architectural smell remains: `heartbeatScheduler.ts` now imports a concrete helper from `runnerCastHeartbeat.ts`; acceptable for this container healthcheck fix, but if more health-marker logic appears, move it to a tiny neutral module.
