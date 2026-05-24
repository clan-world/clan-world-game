# Phase Super-Swarm Review — PR #560 (head 09f78c8) — codex-5-3

## SUMMARY
NEEDS_FIXES. The phase is largely coherent (containerized elders + Convex command bus + heartbeat/caddy/make glue), but there are still a few integration and operational correctness gaps that can mislead operators or create avoidable failure modes. The biggest issue is a misleading bus-secret path contract between compose/runtime scripts that can mask real command-bus health. Recommend fixing the findings below before merge.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- `agents/shared/run.sh:50` + `docker-compose.yml:276` + `packages/elder-runtime/src/config.ts:25`  
  `run.sh` warns `BUS_ELDER_SECRET` is unset and says command-bus participation is disabled, but the actual runtime path now uses `BUS_ELDER_SECRET_FILE` (Docker secret mount) and reads it in `loadConfig()`. In this shipped compose config, the warning is always false-positive, which degrades operator signal and can hide real boot/auth problems during incident triage. Suggested fix: update `run.sh` to validate `BUS_ELDER_SECRET_FILE` (or remove this legacy warning entirely) so logs reflect the real auth path.

- `apps/server/convex/commandBus.ts:44` + `packages/sdk/convex/schema.ts:446`  
  Broadcast sequencing reads the latest row from index `by_broadcast_sequence`, where the indexed field is optional on non-broadcast rows. That makes sequence monotonicity depend on optional-index ordering behavior and mixed-row shape. If optional-key ordering changes or undefined-key rows compete in index ordering, fan-out batches can reuse sequence ids. Suggested fix: track broadcast sequence in a dedicated singleton counter table (or ensure only broadcast rows are indexed/queryable for this lookup).

## LOW severity findings
- `apps/server/convex/commandBus.ts:210`  
  Numbering comments skip from `6` to `8` to `9` to `10`, which makes operational references in logs/review notes harder during incident response. Suggested fix: renumber section comments consistently.

## Cross-cutting observations
- Integration direction is correct: command-bus schema (`agentCommands` / `commandResults` / `elderHeartbeat`), runtime claim/ack/complete flow, and stale-lease sweeper are aligned.
- Test coverage is strong at unit level (`apps/server/convex/commandBus.test.ts`, `packages/elder-runtime/test/*`) but still lacks an end-to-end seam test for `enqueue -> claim -> tmux dispatch -> nonce completion -> result row` across package boundaries, which is the highest-risk runtime path in this phase.
