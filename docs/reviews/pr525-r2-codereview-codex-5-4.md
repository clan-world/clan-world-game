# Phase Super-Swarm Review — PR #525 R2 (head 72e96fb)

## SUMMARY
CLEAN | ready to merge. I verified the Round 1 MUST/SHOULD items against the R1→R2 diff and the post-fix code, and they all landed correctly. I did not find any new HIGH or MED issues introduced by the fix-round, and the heartbeat-related test suite still passes at 153 passing tests.

## R1 FIX VERIFICATION

| R1 Finding | Status | Notes |
|---|---|---|
| USER node directive | LANDED | `agents/heartbeat/Dockerfile` now `chown`s `/app` and switches to `USER node`, so the container no longer runs as root. |
| writeHeartbeatSuccessFile timeout-success | LANDED | The normal success path still writes the file in [`packages/runner/src/runnerCastHeartbeat.ts`](/home/claude/code/clan-world/clan-world-game/.claude/worktrees/issue-353-heartbeat-rebuild/packages/runner/src/runnerCastHeartbeat.ts:146), and the receipt-timeout-but-chain-advanced branch now also writes it in [`packages/runner/src/heartbeatScheduler.ts`](/home/claude/code/clan-world/clan-world-game/.claude/worktrees/issue-353-heartbeat-rebuild/packages/runner/src/heartbeatScheduler.ts:232). |
| env_file → allowlist | LANDED | `docker-compose.yml` drops `env_file` and replaces it with an explicit heartbeat-only env allowlist plus required-var guards for the new required inputs. |
| init: true | LANDED | `docker-compose.yml` sets `init: true` on `heartbeat`, which fixes PID 1 signal handling. |
| HEARTBEAT_HEALTH_THRESHOLD_S | LANDED | `docker-compose.yml` now drives the healthcheck age threshold from `HEARTBEAT_HEALTH_THRESHOLD_S` with a default of `180`, and the README explains the operational constraint. |

## HIGH severity findings

None.

## MEDIUM severity findings

None.

## LOW severity findings

None.

## Cross-cutting observations

The fix-round is internally consistent: the healthcheck semantics now match both success branches, the compose/service docs align with the runtime behavior, and the non-root container change does not obviously break the runner’s write paths because the only runtime write touched here is `/tmp/last-heartbeat-success`.
