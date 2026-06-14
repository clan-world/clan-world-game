# Phase Super-Swarm Review — PR #525 (head 44f72e4)

## SUMMARY
NEEDS_FIXES. Scope is mostly honored (containerizes existing TypeScript heartbeat loop without shell-loop rewrite), and PID-1/signal flow is correct via `entrypoint.sh -> exec pnpm` plus loop-level SIGTERM/SIGINT handling. The main risks are operational: health semantics are hard-coded to a 120s freshness window and can flap unhealthy if on-chain interval changes, and secret-file newline handling can silently break webhook auth in real deploys. Recommend merge only after the medium findings below are addressed.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- `agents/heartbeat/entrypoint.sh` (secret-file read block): `WEBHOOK_SHARED_SECRET="$(cat "$WEBHOOK_SHARED_SECRET_FILE")"` does not trim trailing newline. Docker/K8s-style secret files commonly end with `\n`; this produces `Authorization: Bearer <secret>\n` in [runnerCastHeartbeat.ts](/home/claude/code/clan-world/clan-world-game/packages/runner/src/runnerCastHeartbeat.ts), causing auth mismatch and webhook 401s while heartbeats still report healthy. Suggested fix: trim CR/LF when loading (`tr -d '\r\n'`) and fail if trimmed value is empty.
- [docker-compose.yml](/home/claude/code/clan-world/clan-world-game/docker-compose.yml) healthcheck (`/tmp/last-heartbeat-success` age `<120`): this is coupled to the current 60s tick assumption. If `heartbeatIntervalSeconds` is raised (allowed by architecture docs), the container becomes persistently unhealthy despite correct behavior. Suggested fix: derive threshold from configured/queried interval (e.g., `2*interval + buffer`) or document/enforce interval invariant at startup.

## LOW severity findings
CLEAN — no findings.

## Cross-cutting observations
The PR stays close to the stated Option C scope and avoids architectural drift; core runner behavior (retry/backoff, runnerStatus writes, webhook best-effort) remains intact. The only drift-like risk is observability semantics: “healthy” currently means “recent successful on-chain fire under a fixed 120s SLA,” not “scheduler alive,” so ops tooling should treat this as a policy check, not pure process liveness.
