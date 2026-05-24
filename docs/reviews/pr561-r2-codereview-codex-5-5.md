# Phase Super-Swarm Review — PR #561 R2 (head 62efa1d) — codex-5-5

## SUMMARY
CLEAN — R1 fixes verified in `diff-r2.txt`, no new R2 findings, merge ready. Deferred Bundle 4 items remain intentionally out of scope.

## R1 fixes verification
- ackCommand+failCommand grace: VERIFIED. The old direct expiry checks were removed (`- cmd.leaseExpiresAt <= Date.now()`), and `ackCommand`, `completeCommand`, `failCommand`, plus `sweepStaleDelivered` now use `COMPLETION_GRACE_MS` / `sweepBefore`; tests cover within-grace and beyond-grace behavior.
- Deny-list expansion: VERIFIED. `agents/shared/home-claude/settings.json` adds `Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen)`, `Bash(compgen *)`, `Bash(typeset)`, and `Bash(typeset *)` after the export deny entries.
- Makefile --profile: VERIFIED. `pause-heartbeat`, `unpause-heartbeat`, `reset-%`, `restart-%`, and `wipe-%` now depend on `check-profile`; mutating compose calls in those targets pass `--profile $(PROFILE)` where applicable. `exec` calls remain unprofiled as intended.

## HIGH severity findings (NEW only — DEFERRED items go to a separate section below)
None.

## MEDIUM severity findings (NEW only)
None.

## LOW severity findings (NEW only)
None.

## DEFERRED-PER-BUNDLE-4
- Migration runbook coexist reorder / production cutover sequencing: still intentionally deferred.
- bootstrap-bus-secrets prod URL guard: still intentionally deferred.
- Bracketed-paste prompt injection: still intentionally deferred.
- supervisor.lock TOCTOU: still intentionally deferred.
- Freeze persistence: still intentionally deferred.
- `lastTickProcessed` semantics: still intentionally deferred.
- Non-constant-time auth: still intentionally deferred.

## Cross-cutting observations
The R1 fix-round is internally consistent: grace behavior is symmetric across ack/complete/fail/sweep, deny-list additions do not conflict with visible allow-list intent, and Makefile profile enforcement now matches the operator-safety requirement.
