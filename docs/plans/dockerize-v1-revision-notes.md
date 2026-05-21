# dockerize-v1 plan revision notes

**Date:** 2026-05-16
**Input:** `docs/research/dockerize-v1-DA-codex.md` (codex DA verdict NEEDS_REWRITE; 48 findings).
**Scope:** ALL 18 HIGH findings addressed in-place. Secondary MED/LOW handled surgically where adjacent. Ambient MED/LOW deferred to follow-up issues.

## HIGH findings addressed (18)

3, 4, 6, 9, 10, 11, 12, 19, 20, 22, 24, 28, 29, 33, 37, 38, 39, 44 — all answered in-plan.

Key structural fixes:
- **#3+#37 (cutover order):** Locked decision #1 rewritten + Phase 2 fully restructured into 8 steps. Legacy systemd stays running through internal smoke + Caddy add + 30-min coexist window. Legacy disabled ONLY after explicit `make smoke-test` validation gate. Step 8a rollback for every failure-point.
- **#6+#19+#20+#22+#23 (command-bus):** Phase 1.8 adds `unfreeze` verb, explicit FSM (`queued→leased→delivered→completed/failed`), per-kind completion deadlines, `sweepStaleDelivered()` cron, `BUS_OPERATOR_SECRET`/`BUS_ELDER_SECRET_<id>` auth model, retention rules that preserve incomplete commands.
- **#24 (runner-vs-tmux):** Phase 1.6 redesigned — supervisor runs INSIDE elder container as sibling process to tmux+ttyd under tini. Drops the broken cross-container `tmux send-keys` design. Phase 1.9 and Appendix B updated. Pause/unpause via `kill -STOP`/`-CONT` on supervisor PID.
- **#9+#28+#29 (heartbeat):** Explicit `CHAIN_NETWORK=dev|prod` env (fail-fast if unset), no cross-env fallback. Chain-ID assertion at startup. `preflight-single-caller.sh` aborts if legacy heartbeat detected. Webhook payload aligned to AGENTS.md (`{chain, engineAddress, txHash, firedAtTs, source}`). HMAC-SHA256 with 60s replay window.
- **#10 (admin-key):** `make bootstrap-convex-admin-key` generates + persists at `/etc/clan-world/secrets/convex-admin.key`, mounted as Docker secret (not env var). Rotation deferred to #356.
- **#11 (schema migration):** Phase 1.13 pins CLI + backend + dashboard versions, requires schema-fingerprint check before import, requires recorded rehearsal transcript.
- **#12+#13 (ttyd WS):** Phase 1.5 ships canonical Caddyfile with `@ws_elder` matcher, `handle_path /elder-N/*` for prefix-strip, `transport http { versions h1 }` for ttyd HTTP/1.1, idle 1h, write 0. WS smoke via websocat AND Playwright.
- **#33 (PROFILE):** Makefile requires `PROFILE=dev|prod` explicit, no default. Confirmation banner shows profile + RPC + chain ID + contract before any container starts.
- **#39+#41 (smoke):** Per-elder Claude-auth smoke + per-elder game-loop proof (valid order accepted by chain/backend within 2 min OR explicit no-op decision with reasoning).
- **#44 (OAuth):** `make oauth-bootstrap` + `oauth-bootstrap-elder-N` moved from risk-text into Phase 1.12 committed scope + acceptance.

## Secondary findings handled in-place

1, 5, 7, 14, 15, 16, 17, 18, 25, 26, 27, 30, 31, 32, 34, 35, 40, 42, 43, 45, 46, 47, 48 — all addressed with terse adjacent edits. See revised plan sections matching each finding's location.

## Deferred to follow-up issues

- #356 — admin-key rotation automation
- #357 — Android updates (if mobile workspace archived)
- #358 — anvil-fork state-hash in `make status` (Finding 8)
- #359 — bandwidth measurement parity hosted vs self-hosted (Finding 2)

## Section growth (top 6)

Phase 2: 67→212 (+145). Phase 1.5: 23→108 (+85). Appendix B: 16→96 (+80). Phase 1.8: 41→93 (+52). Phase 1.10: 22→62 (+40). Phase 1.12: 25→63 (+38).

Plan total: 840 → 1497 lines (+657). Recommend re-DA before dispatch.

---

# Alignment review notes — 2026-05-21

**Date:** 2026-05-21 (5 days after original plan)
**Inputs:** Independent alignment reviews by `codex-5.5` + `claude-opus-4-7` against `origin/dev` HEAD `39da47c` (v2.13.0 + R6 toolkit-swarm).
**Source files:** `~/claudes-world/tmp/plan-alignment-codex-2026-05-21.md` + `~/claudes-world/tmp/plan-alignment-claude-2026-05-21.md`.
**Scope:** Misalignment-only — flag where the plan's assumptions no longer match current dev. NOT a full DA, NOT a quality critique.

## Why this review

Between the plan's 2026-05-16 freeze and 2026-05-21, dev shipped v2.10 → v2.13.0 (PRs #427, #460, #490, #491, #498, #503, #505, #512 + smaller). The five biggest architectural shifts: typechain hardening, SDK extraction (`@clan-world/sdk`), heartbeat-on-chain SOT refactor, indexer hardening, and cockpit/map unification.

## Cross-reviewer HIGH-confidence findings (both reviewers caught)

### CR-1. Convex schema moved to `@clan-world/sdk`

- Canonical schema: `packages/sdk/convex/schema.ts:94-419` (not `apps/server/convex/schema.ts`, which is now a 17-line re-export).
- `@clan-world/server` depends on `@clan-world/sdk`. Adding tables means editing the SDK package + running its codegen.
- **Affects:** Phase 1.4 (self-host Convex), Phase 1.8 (command-bus schema), Phase 1.13 (migration runbook).
- **Action:** Re-target schema edits to SDK; deploy/codegen scripts need full workspace install.

### CR-2. Heartbeat is now a TS scheduler reading on-chain interval, not a 60s shell loop

- `scripts/start-heartbeat-loop.sh` is now a 10-line compatibility shim that runs `pnpm --filter @clan-world/runner heartbeat`.
- `packages/runner/src/heartbeatScheduler.ts` reads `heartbeatIntervalSeconds()` from the diamond at boot, schedules off `nextHeartbeatAtTs`, retries with backoff, writes `runnerStatus`, sends Telegram alerts on failure, coordinates with `SettleLatch` so Cycle A waits for Cycle B.
- **Affects:** Phase 1.10 entire scope (heartbeat container Dockerfile + entrypoint + cadence + observability).
- **Action:** Phase 1.10 PR (#417) needs **substantial rewrite** — Dockerfile is Node-based (not foundry+curl+bash), entrypoint is `pnpm --filter @clan-world/runner heartbeat`, sandbox container needs full pnpm workspace install.

### CR-3. Webhook auth is `Authorization: Bearer`, not HMAC

- `apps/server/convex/heartbeat.ts:125-132` validates bearer token against `WEBHOOK_SHARED_SECRET`. `packages/runner/src/runnerCastHeartbeat.ts:184-210` posts that header. No HMAC, no replay window.
- Plan's `X-Heartbeat-Signature: t=..., v1=hex` HMAC scheme is a **new feature**, not a "turn back on" of existing code.
- **Affects:** Phase 1.10 webhook spec, plus the migration story for the current TS runner.
- **Action:** Decide: ship HMAC as planned (security improvement, requires updating runner + accepting bearer during migration), or keep bearer + drop HMAC from plan.

### CR-4. Webhook payload now requires `blockNumber`

- `apps/server/convex/heartbeat.ts:23-30` declares payload type `{txHash, blockNumber, engineAddress, firedAtTs, chain, source}`. Lines 146-151 reject with 400 if `txHash` is missing in real-indexer mode.
- Plan's stated payload (`{chain, engineAddress, txHash, firedAtTs, source}` — "no `tick`") is incomplete. The receipt-driven indexer needs `blockNumber`.
- **Affects:** Phase 1.10 entrypoint, smoke criterion #3, AGENTS.md row.
- **Action:** Update payload spec; ensure Phase 1.10 caller serializes `blockNumber` from cast/forge output.

### CR-5. Phase 0 gate is satisfied — but landed scope is broader than the gate spec

- v2.13.0 shipped #333-#337 + #503 heartbeat SOT + #505 indexer hardening + a 5-round super-swarm convergence.
- **Affects:** Phase 0 section + Wave 2 ordering + Phase 1.4/1.8 unblocking language.
- **Action:** Mark Phase 0 DONE in plan. Update acceptance/runbook references to v2.13's actual evidence; preserve the extra heartbeat/watchdog scope.

### CR-6. Command-bus PR (#415) is pre-v2.13 + uses stale `acked` FSM

- The recover branch `recover/issue-351-command-bus-schema` edits `apps/server/convex/schema.ts` directly (now obsolete location) and uses a `status: "acked"` FSM (`commandBus.ts:101-112`) that conflicts with the plan's revised `queued → leased → delivered → completed/failed` model AND with v2.13's `runnerStatus` semantics.
- **Affects:** Phase 1.8 PR revival entirely.
- **Action:** Rebuild PR #415 on `packages/sdk/convex/schema.ts`, drop the `acked` FSM, preserve v2.13's `runnerStatus` + `pollerHealth` + retention infrastructure.

## Single-reviewer findings (still real, lower confidence)

### codex-only

- **M-2 SDK extraction reaches into the elder image build.** `@clan-world/shared` → `@clan-world/sdk` → `@clan-world/contract-types` chain means the heartbeat container needs full pnpm workspace deps (not just foundry+curl). Phase 1.2 Dockerfile spec needs workspace-aware install steps.
- **M-9 CONVEX_URL vs CONVEX_DEPLOY_URL.** Shared `createConvexClient()` reads `CONVEX_URL` (or stubs). Runner uses `CONVEX_DEPLOY_URL` for webhook derivation only. Plan's runtime supervisor env spec needs both.
- **M-12 `runnerStatus` overlaps with planned `elderHeartbeat`.** Plan's per-elder liveness signal mirrors v2.13's heartbeat-caller liveness table. Decide: reuse `runnerStatus` (re-keyed) or keep them distinct (and document the difference).

### claude-only

- **M-3 Phase 1.9 conflicts with v2.13's Cycle A/Cycle B SettleLatch.** v2.13 just spent 6 super-swarm rounds hardening `packages/runner/` with in-process settle-latch coordination. Plan's "rename packages/runner/ and gut it" line would regress that work. Decide: lift the latch into a Convex coordination row (cross-container), or accept the loss.
- **M-6 Phase 1.11 doubly invalidated.** `apps/web/src/components/WorldMapEmbed.tsx` already unifies cockpit + map at the component level. Liam deferred the URL rename PR; the underlying refactor argument is much weaker now.
- **M-8 CONVEX_WEBHOOK_URL silent no-op.** `runnerCastHeartbeat.ts:60-67` auto-derives `CONVEX_WEBHOOK_URL` only when `CONVEX_DEPLOY_URL.hostname.endsWith('.convex.cloud')`. Self-hosted setups (`http://convex-backend:3210`) MUST set `CONVEX_WEBHOOK_URL` explicitly or webhook fan-out silently disables.
- **M-9 Mutually-exclusive feature flags.** `CLANWORLD_USE_FAKE_HEARTBEAT` vs `CLANWORLD_USE_REAL_INDEXER` — `crons.ts:7-14` throws if both true. `.env.template` must document. Self-hosted indexing needs `CLANWORLD_USE_REAL_INDEXER=true` + `INDEXER_START_BLOCK` + `INDEXER_SECRET` + `RPC_URL_PRIMARY` + `CLAN_WORLD_LENS_ADDRESS`.

## Open questions surfaced (Liam needs to decide)

1. **Heartbeat container impl:** containerize `@clan-world/runner heartbeat` (preserves retry/backoff/SettleLatch/Telegram alerts/runnerStatus) OR ship a new shell+foundry caller (loses observability but matches plan's "thin container" intent)?
2. **Webhook auth migration:** bearer → HMAC atomic switch (update runner + Convex together) OR dual-accept for one release?
3. **Command-bus retention:** bespoke retention crons (per plan) OR fold `agentCommands` + `commandResults` into v2.13's `purgeGroupedPreserveLatest` retention config?
4. **SDK codegen workflow for self-hosted Convex:** edit SDK schema → run SDK codegen → touch app schema → run server codegen? Document the canonical sequence in Phase 1.13.
5. **`runnerStatus` vs `elderHeartbeat`:** reuse `runnerStatus` table (re-key on elder ID) OR keep them distinct (and document semantic boundary)?

## Updated sub-issue rebase risk summary

Consensus severity (where both reviewers agreed) + the stricter of the two (codex is consistently more rigorous on the rewrite-vs-rebase axis):

| Sub-issue | PR | Severity | Recommended approach |
|---|---:|---|---|
| 1.1 compose scaffold | #408 | MED | Transplant only; add `CLANWORLD_USE_REAL_INDEXER`, `INDEXER_START_BLOCK`, `INDEXER_SECRET`, `RPC_URL_PRIMARY`, `CLAN_WORLD_LENS_ADDRESS`, `CONVEX_WEBHOOK_URL` to `.env.template` |
| 1.2 agents Dockerfile | #409 | MED | Add workspace-aware install for SDK + contract-types + shared + agents |
| 1.3 anvil-fork | #410 | LOW | Rebase clean; verify env names against current runner |
| 1.4 self-host Convex | #411 | **HIGH** | Rewrite deploy/codegen around SDK schema + full workspace install; add indexer env vars |
| 1.5 Caddy | #412? | MED | Preserve current hardcoded ttyd URLs; verify WS upgrade against host caddy |
| 1.6 elder-N service | #413 | MED | Rebase carefully; runtime package/workspace deps changed |
| 1.7 agents-shared | #414 | MED | Rebase carefully; validate `runtime/elders/personalities.yaml` + current Claude/OAuth settings |
| 1.8 command-bus schema | #415 | **HIGH** | Rebuild on `packages/sdk/convex/schema.ts`; drop `acked` FSM; preserve v2.13 retention/cron infra |
| 1.9 elder-runtime | #416 | **HIGH** | Redesign around Cycle A/B split; decide SettleLatch coordination strategy; don't "gut packages/runner" |
| 1.10 heartbeat | #417 | **HIGH** | Substantial rewrite — Node-based Dockerfile, runner-package entrypoint, payload with `blockNumber`, bearer-vs-HMAC decision |
| 1.11 URL rename | #418 | LOW-MED | Defer (per Liam) — cockpit/map already share `WorldMapEmbed`; rename is now optional aesthetics |
| 1.12 Makefile | #419 | MED-HIGH | Rewrite env/status targets for SDK workspace + current heartbeat/status semantics |
| 1.13 migration runbook | #420 | **HIGH** | Rewrite import/codegen/schema fingerprint + heartbeat cutover sections; version labels v2.8.4 → v2.13.0 |

## Bonus findings (not plan drift — real dev observations)

- **`apps/server/convex/heartbeat.ts:281` comment** documents a known-dead-code-but-kept-for-intent guard. Not a bug, just FYI.
- **`packages/runner/README.md` "Run it" section** still describes the legacy host-tmux model. Will need a docs PR alongside dockerize landing.
- **CHANGELOG.md missing v2.9-v2.12 entries** — v2.13.0 CHANGELOG explicitly notes those were not backfilled. Plan's Phase 2 step-2 fingerprint check references "v2.8.4 → self-hosted" which is now stale (should be v2.13.0).
- **`runtime/elders/personalities.yaml`** referenced in Phase 1.7 — needs presence check before dispatching PR #414.

---

**Next step after alignment review:** Walk through draft PRs #408-#420 one at a time with Liam, applying the per-PR rebase strategy above. Start with the LOW-severity quick wins (#410) to build momentum, then take the HIGH-severity rewrites (#415, #416, #417) as paired discussion sessions where the design decisions in "Open questions" get resolved.
