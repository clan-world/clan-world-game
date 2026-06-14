# Phase Super-Swarm Review — PR #561 R2 (head 62efa1d) — Gemini

## SUMMARY
R1 fixes for the grace asymmetry, deny-list gaps, and Makefile profile propagation have been verified as properly implemented. I have identified one NEW HIGH severity issue where `wipe-%` leaves hidden files behind in the workspace, and one NEW MEDIUM severity issue regarding `claimNext` query performance. Merge is recommended after patching the workspace wipe bug.

## R1 fixes verification
- **ackCommand+failCommand grace:** VERIFIED. Both `ackCommand` and `failCommand` now apply the `COMPLETION_GRACE_MS` symmetrically with `sweepStaleDelivered` and `completeCommand` (`apps/server/convex/commandBus.ts:110,165`).
- **Deny-list expansion:** VERIFIED. 27 new strict entries including `Bash(echo $*)`, `Bash(compgen)`, and language eval blocks have been properly appended and the JSON is valid (`agents/shared/home-claude/settings.json`).
- **Makefile --profile:** VERIFIED. `check-profile` dependency and `--profile $(PROFILE)` are propagated to all relevant lifecycle/mutating targets (`agents/Makefile:181-216`).

## HIGH severity findings (NEW only)
**`agents/Makefile:204,208`** — `wipe-%` leaves workspace dotfiles intact.
The targets use `sh -c 'rm -rf /workspace/*'` to clear the workspace. Because the POSIX `*` glob does not match hidden files, dotfiles like `/workspace/.env` and `/workspace/.git` will survive the wipe, leading to state-leakage between runs.
*Suggested fix:* Change the command to `sh -c 'rm -rf /workspace/* /workspace/.* 2>/dev/null || true'` or use `sh -c 'find /workspace -mindepth 1 -delete'`.

## MEDIUM severity findings (NEW only)
**`apps/server/convex/commandBus.ts:88`** — `claimNext` control-verb priority causes O(N) table scan.
The new `claimNext` logic does a `.filter(...)` over the `by_target_status` index to find control commands before falling back to normal messages. Because Convex `.filter` runs post-index, if the agent has a deep queue of normal messages but no control commands, this evaluates every queued message and could hit Convex scan limits.
*Suggested fix:* While acceptable for small queues, consider a `by_target_status_kind` compound index in a future migration, or explicitly query the exact verbs to avoid the filter scan.

## LOW severity findings (NEW only)
None.

## DEFERRED-PER-BUNDLE-4
(carryover from R1 — listed for completeness, no action required this round)
- Migration runbook coexist reorder
- bootstrap-bus-secrets prod URL guard
- Bracketed-paste prompt injection (pre-existing)
- TOCTOU supervisor.lock (pre-existing)
- Freeze persistence (pre-existing)
- `lastTickProcessed` semantics (pre-existing)
- Non-constant-time auth (pre-existing)
- Env-exfil via untracked commands like `tail`, `grep`, `awk` (deny-list is inherently incomplete without user isolation).

## Cross-cutting observations
The move to loopback-only Docker Caddy with cloudflared ingress provides a much cleaner security model, dropping the dependency on host Caddy for internal API routing. The new `rehearsal` environment variables and scripts significantly de-risk the cutover.
