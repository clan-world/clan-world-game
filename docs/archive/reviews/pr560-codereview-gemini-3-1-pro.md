# Super-Swarm Review — PR #560

## 1. Cross-Bundle Integration Bugs
- **File:** `docker-compose.yml`
  **Finding:** The `caddy` service is completely omitted from the compose stack, and `agents/caddy/Caddyfile` is missing from the PR. Bundle 3's routing and Makefile assume `caddy` exists, breaking all routes.
- **File:** `docs/plans/dockerize-elder-infra-v1.md`:5246
  **Finding:** Phase 2 cutover brings up compose (including `heartbeat`) while legacy systemd units are still running for a 30-min window. This violates the "ONLY active heartbeat caller" requirement by running two concurrent heartbeat callers.

## 2. Security & Operational Risks
- **File:** `packages/elder-runtime/src/tmuxSink.ts`:35
  **Finding:** Bracketed paste prompt injection vulnerability. A user `text` payload containing `\x1b[201~` ends the paste early and executes the rest as arbitrary commands in the Elder session.
- **File:** `packages/elder-runtime/src/main.ts`:30
  **Finding:** TOCTOU race in `supervisor.lock`. If a process is preempted between `openSync` and `writeSync`, another process reads an empty file, parses `NaN`, and blindly `unlinkSync`s it, allowing multiple active supervisors.
- **File:** `docker-compose.yml`
  **Finding:** Caddy does not natively support `_FILE` env variables for basicauth hashes. Mounting `/run/secrets/dashboard-basicauth` into `CONVEX_DASHBOARD_BASIC_AUTH_HASH_FILE` will leave the dashboard unauthenticated or broken.

## 3. Data & State Integrity
- **File:** `packages/runner/src/heartbeatScheduler.ts`
  **Finding:** The `SettleLatch` integration was completely removed. Heartbeats now fire purely on a timer and no longer wait for Cycle B to settle the current tick, desyncing the chain from Elder actions.
- **File:** `packages/sdk/convex/schema.ts`:433
  **Finding:** The `agentCommands` table schema defines `status` as `"queued" | "leased" | "acked" | "completed" | "failed"`. However, the plan and `apps/server/convex/crons.ts` sweep the `delivered` status, which is missing from the schema.

## 4. Operational & Rollback Gaps
- **File:** `docs/plans/dockerize-elder-infra-v1.md`:5378
  **Finding:** Since the docker Caddy container was omitted, rollback and coexist procedures referencing the `caddy` service or its routes are invalidated, preventing a safe abort-mid-flight.

## 5. Architectural Drift & Misc
- **File:** `packages/elder-runtime/src/tmuxSink.ts`:17
  **Finding:** Good regression fix converting `execFileAsync` input option to `spawn` with `stdin.end()` for `loadBuffer`.
- **Finding:** The PR drops major components of Phase 1.5 (Caddy container implementation), causing significant architectural drift from the approved plan.
