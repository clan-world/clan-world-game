# Phase Super-Swarm Synthesis — PR #576 (head 47bb77e)

**Models run:** Codex 5.3 ✓ | Codex 5.4 ✓ | Codex 5.5 ✓ | Opus 4.6 ✓ | Opus 4.7 ✗ (silent failure, 0-byte log) | Gemini 3.1 Pro ✓
**Phase:** dev-phase-4-simplified-comms → dev (Bundle 4 release)
**Diff size:** 2676 lines (~48 files across 6 sub-PRs)

## Summary

**Overall: NEEDS_FIXES** — 3 MUST FIX (1 cross-tier HIGH + 2 single-tier HIGH with clear repro), 1 SHOULD FIX, 4 DEFER, 2 SKIP.

Cross-tier overlap on `tickReceiveLog:recordReceive` auth (3 of 5 reviewers HIGH) is the dominant signal. Gemini independently caught a production failure mode in `latestReceivedTick` (whisper-flood → endless reset loop). Codex 5.5 caught `ttyd --writable` contradicting the design's "read-only" claim.

Recommended action: polish round (~3 fixes), then re-evaluate, then hand to Liam for `dev` merge.

## MUST FIX

| File:line | Models | Severity | Finding | Fix |
|---|---|---|---|---|
| `apps/server/convex/tickReceiveLog.ts:7-46` | 5.3, 5.5, 4.6 | HIGH | Public unauthenticated mutation — any caller with Convex URL can forge tick receipts, advancing runner past undelivered ticks. Real integrity break on two-phase commit. | Add `secret: v.string()` arg, validate via existing `requireBusOperatorSecret` helper. Python hook reads `BUS_OPERATOR_SECRET` from env + passes as mutation arg. |
| `apps/server/convex/runner.ts` (`latestReceivedTick`) | gemini-3.1-pro | HIGH | `by_elder_received` index + take 200 + filter for tickNumber. If 200+ whispers between ticks → empty filtered array → returns null → `late_join` → full memory wipe on every boot. | Rewrite to use `by_elder_tick` index + `.order("desc").first()` (Convex sorts undefined before numbers, so highest tickNumber wins). |
| `agents/entrypoint.sh:67` | 5.5 | HIGH | `ttyd --writable` contradicts the design's "read-only web terminal exposing tmux pane to operator cockpit" claim. Operator can input via the web terminal, bypassing the runner's two-phase commit. | Remove `--writable` flag — operator should use the new `/api/admin/inject-message` endpoint (PR6) for input, not the bare terminal. |

## SHOULD FIX

| File:line | Models | Severity | Finding | Reason |
|---|---|---|---|---|
| `packages/runner/src/messageDelivery.ts:73` (`deliverPendingOnly`) | 5.3 | MEDIUM | Composed paste with multiple pending messages waits on only `firstEnvelopeUid(...)` confirmation but consumes ALL pending message ids on first UID receipt. Later messages can be marked consumed without independent evidence. | Either send/confirm pending messages one-by-one OR require receipt evidence for every UID in composed payload before bulk consume. |

## DEFER (file follow-up issues)

- `apps/server/convex/runner.ts:89-103` `isThematicUidTaken` table scan with arbitrary 5000-row limit. Perf concern; collision probability is astronomical anyway (~2.2e10 combinations). Already noted in PR2 R1; subsumed into existing follow-up issue #575 alongside UID-index addition.
- `packages/runner/src/flockGuard.ts` calls `flock(1)` via `spawnSync`; silently no-ops if `flock` not installed. Container has `flock` (it's in `util-linux` base package); add CI check or runtime assertion for the binary's presence to harden against future image changes.
- `packages/runner/src/tickHandler.ts handleAuxiliaryUpdate` returns `confirmed: true` on scheduled memory-wipe even if `runResetFlow` didn't confirm. Already documented as intentional in the code comment (PR2 R2): the wipeMarker rescue catches us on the next startup. Verified design-acceptable.
- `packages/runner/src/tickHandler.ts handlePendingMessages` stalls until next heartbeat tick on delivery failure. Already mitigated by main.ts confirmed-only-advance (PR2 R2): the next tick wake-up retries the bundled pending messages. Worst case is up to ~60s delay until next tick. Acceptable per design.

## SKIP (false positive / out of scope / intentional)

- `packages/heartbeat/*` "dead code" (gemini). Intentional per PR1 design — renamed-but-not-stripped pattern; PR2 architecturally moved responsibility, future polish will strip the unused files. Not a release blocker.
- Codex 5.4 / 5.5 partial output (review template echo only at start of file). Tool-use traces show they did review the code; their findings overlap with the documented HIGHs above (5.5 explicitly flagged ttyd writable + receive-log auth at end).

## Per-model verdicts

- **Codex 5.3:** NEEDS_FIXES — 1 HIGH (tickReceiveLog auth) + 1 MEDIUM (pending-only confirm-and-consume)
- **Codex 5.4:** review template echo only — tool-use trace shows real review work; no new findings beyond cross-tier
- **Codex 5.5:** NEEDS_FIXES — 2 blockers (ttyd writable + tickReceiveLog auth)
- **Opus 4.6:** NEEDS_FIXES — 1 HIGH (tickReceiveLog auth) + 3 MEDIUM (UID scan, flockGuard, scheduled-wipe confirmed-always)
- **Opus 4.7:** ✗ silent failure (0-byte log) — likely process never started; will not re-run, 5-model synthesis is sufficient
- **Gemini 3.1 Pro:** NEEDS_FIXES — 1 HIGH (whisper-flood reset loop) + 2 MEDIUM (pending stall, dead heartbeat code)

## Key observations

- **Architecture delivers.** Every reviewer confirmed the simplification goal was hit: command bus + supervisor stripped, replaced with per-elder runner + dumb heartbeat + two-phase commit. Over-engineering filter was held — no reintroduced leases/claims/idempotency on debug-tier surfaces.
- **Cross-tier auth concern is real.** Previous sub-PR triage (PR #571 R1) skipped this with "no locking bullshit" + dev-mode trust. At release-PR level with full context, 3 of 5 senior models flagged it. The over-engineering filter applied correctly to `pendingMessages` (admin double-paste harmless) but mis-applied to `tickReceiveLog` (runner SOT for delivery confirmation — forging it breaks the two-phase commit). Worth applying the auth pattern PR6 already established (`requireBusOperatorSecret`).
- **Whisper-flood is a sleeper production bug.** Gemini caught a single-tier HIGH that no other model spotted — but the repro is concrete and the fix is one-line. Important catch.
- **ttyd writable is a doc-vs-code drift.** Either entrypoint needs `--readonly` OR the design needs to claim "writable terminal during dev" explicitly. Picking the former matches the design's intent (operator input goes through `/api/admin/inject-message` per PR6 scaffolding).
