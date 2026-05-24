# Phase Super-Swarm Review — PR #561 R2 (head 62efa1d) — Opus 4.6

## SUMMARY

All three R1 findings verified as fixed in the diff. `COMPLETION_GRACE_MS` is symmetric across ackCommand, failCommand, completeCommand, and sweepStaleDelivered. Deny-list has the 6 new entries. Makefile `check-profile` + `--profile $(PROFILE)` propagated to all mutating lifecycle targets. One new LOW (completeCommand idempotency skips leaseOwner check). No new HIGHs or MEDIUMs. **Merge ready.**

## R1 fixes verification

- **ackCommand+failCommand grace: VERIFIED.** Diff removes `cmd.leaseExpiresAt <= Date.now()` from both ackCommand (line ~110 in new file) and failCommand (line ~165 in new file), replacing with `cmd.leaseExpiresAt + COMPLETION_GRACE_MS <= Date.now()`. `COMPLETION_GRACE_MS = 30 * 1000` defined at module scope. Error messages updated to "Lease expired beyond grace". sweepStaleDelivered uses `const sweepBefore = now - COMPLETION_GRACE_MS` symmetrically. All four lease-check paths now share the same 30s grace window. Test coverage includes within-grace (1s past) and beyond-grace (35s past) for both ack and fail, using `vi.useFakeTimers()` with fixed timestamps.

- **Deny-list expansion: VERIFIED.** Six new entries present in `agents/shared/home-claude/settings.json` after the existing `Bash(export *)` entry: `Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen)`, `Bash(compgen *)`, `Bash(typeset)`, `Bash(typeset *)`. These are additive to the broader deny block (which also includes `Bash(set)`, `Bash(declare *)`, interpreter one-liners, etc.). No interaction with allow-list patterns.

- **Makefile --profile: VERIFIED.** `check-profile` is a dependency on `reset-%`, `restart-%`, `wipe-%`, `pause-heartbeat`, and `unpause-heartbeat`. All `$(DC)` calls in these targets include `--profile $(PROFILE)`. `pause-elder-%` and `unpause-elder-%` correctly omit profile — they exec into a specific named container, which doesn't need profile scoping. `wipe-%` recursive `$(MAKE) reset-$*` propagates `PROFILE=$(PROFILE)`.

## HIGH severity findings (NEW only)

None.

## MEDIUM severity findings (NEW only)

None.

## LOW severity findings (NEW only)

**`apps/server/convex/commandBus.ts`:~131-132 — completeCommand idempotency guard skips leaseOwner check.** The new `if (cmd.status === "completed") return;` fires before the `cmd.leaseOwner !== args.agentId` check. This means any authenticated elder calling completeCommand on another elder's already-completed command gets a silent no-op instead of the pre-existing "not found or not owned" error. No state mutation occurs (no `db.patch`, no `db.insert`), so data integrity is preserved. Impact is limited to masking a caller mismatch that could indicate a bug in the supervisor. Suggested fix: either check `leaseOwner` before the idempotency return, or accept the current behavior and document that completeCommand is deliberately idempotent regardless of caller identity.

## DEFERRED-PER-BUNDLE-4

Carryover from R1 — listed for completeness, no action required this round:

- **Migration runbook coexist reorder** — Step ordering in the cutover runbook.
- **bootstrap-bus-secrets prod URL guard** — `bootstrap-bus-secrets` target does not gate on `PROFILE=prod` or validate the Convex URL before pushing secrets.
- **Bracketed-paste prompt injection** (pre-existing) — tmux paste sink doesn't sanitize bracketed paste escape sequences.
- **TOCTOU supervisor.lock** (pre-existing) — file-based lock in elder-runtime has a check-then-act race.
- **Freeze persistence** (pre-existing) — freeze state is not persisted across container restart.
- **`lastTickProcessed` semantics** (pre-existing) — off-by-one ambiguity in tick tracking.
- **Non-constant-time auth** (pre-existing) — `checkElderAuth`/`checkOperatorAuth` use `===` string comparison instead of timing-safe equals.

All of the above live in code that Bundle 4 will strip (command bus + supervisor logic).

## Cross-cutting observations

- LEASE_MS raised from 5 min to 6 min with `COMPLETION_GRACE_MS = 30s` gives a 2.5-min safety window against the elder-runtime's 4-min `nonceTimeoutMs` default. The config comment in `packages/elder-runtime/src/config.ts` was updated to reflect the new arithmetic. Coherent.
- The `claimNext` control-verb priority (two-query approach: control commands first, then any queued) runs inside a Convex mutation and is therefore serializable. No TOCTOU concern between the two queries.
- Test mock's `.or()` implementation (`args.some(Boolean)`) correctly mirrors Convex's `q.or` semantics for the filter used by `claimNext`.
- `caddy.conf` uses `handle /map*` which over-matches (catches `/maps`, `/maple`, etc.). Cosmetic — no other `/map*` routes exist today. Noting for awareness, not action.
