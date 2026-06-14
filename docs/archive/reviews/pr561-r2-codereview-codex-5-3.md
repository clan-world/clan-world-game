# Phase Super-Swarm Review — PR #561 R2 (head 62efa1d) — codex-5-3

## SUMMARY
R1 fixes are verified as landed (grace symmetry, deny-list expansion, Makefile profile propagation). No concrete regressions or new non-deferred findings were identified in this round. CLEAN — R1 fixes verified, no new findings, merge ready.

## R1 fixes verification
- ackCommand+failCommand grace: VERIFIED. In `apps/server/convex/commandBus.ts`, old expiry checks were removed (`- leaseExpiresAt <= Date.now()`) and replaced with grace-aware checks (`+ leaseExpiresAt + COMPLETION_GRACE_MS <= Date.now()`) for both ack and fail paths, with symmetric error text updates.
- Deny-list expansion: VERIFIED. In `agents/shared/home-claude/settings.json`, the six requested deny entries are present: `Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen)`, `Bash(compgen *)`, `Bash(typeset)`, `Bash(typeset *)`.
- Makefile --profile: VERIFIED. In `agents/Makefile`, lifecycle mutators include `check-profile` dependency and use `--profile $(PROFILE)` on `pause-heartbeat`, `unpause-heartbeat`, `reset-%`, `restart-%`, `wipe-%` (plus other profile-scoped mutators).

## HIGH severity findings (NEW only — DEFERRED items go to a separate section below)
None.

## MEDIUM severity findings (NEW only)
None.

## LOW severity findings (NEW only)
None.

## DEFERRED-PER-BUNDLE-4
- Migration runbook coexist reorder — DEFERRED-PER-BUNDLE-4
- bootstrap-bus-secrets prod URL guard — DEFERRED-PER-BUNDLE-4
- Bracketed-paste prompt injection — DEFERRED-PER-BUNDLE-4
- TOCTOU supervisor.lock — DEFERRED-PER-BUNDLE-4
- Freeze persistence — DEFERRED-PER-BUNDLE-4
- `lastTickProcessed` semantics — DEFERRED-PER-BUNDLE-4
- Non-constant-time auth — DEFERRED-PER-BUNDLE-4

## Cross-cutting observations
R2 objective (verify R1 deltas via removed lines) checks out: old vulnerable branches are removed where expected and replaced with the intended grace/profile/deny-list behavior.
