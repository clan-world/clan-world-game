# Phase Super-Swarm Review — PR #561 R2 (head 62efa1d) — codex-5-4

## SUMMARY
R1 fixes are verified clean at `62efa1d`: the old non-grace lease checks were removed, the six deny-list entries landed, and the mutating `agents/Makefile` targets now enforce `PROFILE`. One new MEDIUM regression remains: operator docs still show the newly profile-gated targets without `PROFILE=...`, so those commands now fail as written. Not merge-ready until that doc drift is fixed.

## R1 fixes verification
- ackCommand+failCommand grace: VERIFIED — the old `cmd.leaseExpiresAt <= Date.now()` guards were removed from [apps/server/convex/commandBus.ts](/home/claude/code/clan-world/clan-world-game/apps/server/convex/commandBus.ts), and commit `62efa1d` now uses `cmd.leaseExpiresAt + COMPLETION_GRACE_MS <= Date.now()` for both `ackCommand` and `failCommand` (plus matching tests in `commandBus.test.ts`).
- Deny-list expansion: VERIFIED — `Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen)`, `Bash(compgen *)`, `Bash(typeset)`, and `Bash(typeset *)` are present in [agents/shared/home-claude/settings.json](/home/claude/code/clan-world/clan-world-game/agents/shared/home-claude/settings.json).
- Makefile --profile: VERIFIED — `pause-heartbeat`, `unpause-heartbeat`, `reset-%`, `restart-%`, and `wipe-%` all depend on `check-profile` and propagate `--profile $(PROFILE)` in commit `62efa1d`'s `agents/Makefile`.

## HIGH severity findings (NEW only — DEFERRED items go to a separate section below)
None.

## MEDIUM severity findings (NEW only)
docs/runbooks/dockerize-migration-v1.md:96 — The R1 Makefile fix made `pause-heartbeat`, `unpause-heartbeat`, `reset-elder-3`, `restart-elder-3`, and `wipe-elder-3` hard-require `PROFILE`, but this runbook still documents them without `PROFILE=...`. At `62efa1d`, each of those commands now exits via `check-profile` instead of doing the operator action, so the migration runbook is wrong at the exact point it is supposed to guide coexist cutover. Suggested fix: update every newly gated example in this runbook to `make -C agents <target> PROFILE=dev|prod ...`, matching the Makefile contract.

## LOW severity findings (NEW only)
agents/README.md:45 — The dev workflow still shows `make reset-elder-3` and `make wipe-elder-3` with no `PROFILE`, so those examples now fail the same `check-profile` gate. Suggested fix: update the examples to include `PROFILE=dev|prod`, or add one line above the workflow stating that all lifecycle targets require `PROFILE`.

## DEFERRED-PER-BUNDLE-4
- Migration runbook coexist reorder
- `bootstrap-bus-secrets` prod URL guard
- Bracketed-paste prompt injection
- `supervisor.lock` TOCTOU
- Freeze persistence
- `lastTickProcessed` semantics
- Non-constant-time auth

## Cross-cutting observations
The code-side R1 fixes landed cleanly and the new Convex tests cover the intended grace-window behavior. The only new breakage I found is documentation drift from the stricter Makefile contract.
