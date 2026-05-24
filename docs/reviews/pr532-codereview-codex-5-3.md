# Phase Super-Swarm Review — PR #532 (head 1ed8d60)

## SUMMARY
NEEDS_FIXES. The integrated phase lands most containerization goals, but it introduces a load-bearing gameplay regression: SettleLatch coordination was removed while `packages/runner/src/main.ts` still runs Cycle A (heartbeat) and Cycle B (elder settle loop) in the same process. That allows heartbeat advancement during an active settle window, breaking the core “orders before next tick” invariant. Merge should be blocked until that coordination is restored (or runner topology is changed so only standalone heartbeat runs Cycle A).

## HIGH severity findings

1. **Cycle A/B coordination regression after SettleLatch removal can advance ticks before elders finish settle window (broken game invariant).**  
   **Files:** `packages/runner/src/main.ts:137`, `packages/runner/src/main.ts:145`, `packages/runner/src/heartbeatScheduler.ts:123`, `packages/runner/src/tickLoop.ts:163`, `packages/runner/src/settleLatch.ts` (deleted), `packages/runner/src/convexSnapshotSettleLatch.ts` (deleted)  
   The runner still starts heartbeat scheduler and tick loop concurrently, but all latch gating was removed (`settleLatch` dep deleted from scheduler and tick loop). With `RUNNER_SETTLE_WINDOW_SEC` potentially longer than heartbeat cadence, Cycle A can fire `heartbeat()` while Cycle B is still in settle/ack-clear. This directly reintroduces timing overlap the latch was preventing and can cause elders to miss intended submission windows or submit against stale tick assumptions.  
   **Suggested fix:** restore an explicit cross-cycle gate in `main` mode (shared latch/watermark or equivalent), or split responsibilities so the integrated runner does not run Cycle A at all when Cycle B is active. Add an integration test that asserts no second heartbeat fire occurs before tick loop marks settle complete.

## MEDIUM severity findings

1. **Heartbeat health marker can report progress when Convex ingest path is failing, masking operational outage.**  
   **Files:** `packages/runner/src/heartbeatScheduler.ts:215-231` (timeout-advance success path writes success), `agents/heartbeat/README.md` health semantics  
   In receipt-timeout recovery, scheduler marks success based on `nextHeartbeatAtTs` advancing, even though no confirmed receipt and no guaranteed webhook ingest occurred. Container health stays green from the marker file while Convex ingestion may be broken. This is documented, but still a meaningful ops blind spot for this phase’s “self-hosted Convex + heartbeat” integration.  
   **Suggested fix:** split liveness markers: `heartbeat-chain-progress` vs `heartbeat-convex-ingest`, or add a second health/alert channel tied to webhook/indexer freshness.

2. **Convex images default to `:latest` in stack config (supply-chain/rollback risk).**  
   **Files:** `.env.template:212-213`, `docker-compose.yml` Convex services image references  
   Phase focuses on deployability, but shipping `latest` defaults for backend/dashboard weakens reproducibility and rollback safety in prod.  
   **Suggested fix:** require SHA-pinned defaults for prod path (or hard fail in prod when tags are `latest`).

## LOW severity findings

1. **`load_env` scripts `source` `.env`/`.env.local` directly (trusted-local assumption).**  
   **Files:** `bin/deploy-convex.sh`, `bin/backup-convex.sh`, `bin/import-convex-schema.sh`, `bin/check-stack-health.sh`  
   This is acceptable for trusted operator workflows, but worth noting as a local code-exec footgun if env files are ever untrusted.  
   **Suggested fix:** optional follow-up to parse key/value lines instead of sourcing, if threat model expands.

## Cross-cutting observations

- SettleLatch removal appears complete mechanically (no dangling references in touched files/tests), but the replacement pattern is not behaviorally equivalent for integrated runner mode.
- Container hardening improved (secret-file handling, explicit preflight, loopback-only dev ports), but the critical game-loop invariant needs to be restored before merge.
- Integration tests were updated for removed latch paths, but there is no replacement end-to-end assertion for Cycle A/Cycle B sequencing in `main` mode.
```

If you want, I can also generate a one-command heredoc you can run locally to write this exact content into the target file.
