# PR #561 R2 Super-Swarm Synthesis (head 62efa1d)

**Models run:** Codex 5.3 ✓ | Codex 5.4 ✓ | Codex 5.5 ✓ | Opus 4.6 ✓ | Opus 4.7 ✓ | Gemini 3.1 Pro ✓

## Verdicts

| Reviewer | Verdict | NEW HIGH | NEW MED | NEW LOW |
|---|---|---|---|---|
| Codex 5.3 | CLEAN — merge ready | 0 | 0 | 0 |
| Codex 5.4 | NEEDS_FIXES | 0 | 1 (doc-drift from R1) | 1 |
| Codex 5.5 | CLEAN — merge ready | 0 | 0 | 0 |
| Opus 4.6 | CLEAN — merge ready | 0 | 0 | 1 (idempotency leak) |
| Opus 4.7 | merge-ready conditional | 0 | 1 (absolute-path shell bypass) | 1 (off-by-one) |
| Gemini 3.1 Pro | NEEDS_FIXES | 1 (wipe-% dotfile, pre-existing) | 1 (claimNext O(N)) | 0 |

## R1 fixes — all VERIFIED

All three R1 fix-round changes verified by all 6 reviewers:
- ✓ `ackCommand` + `failCommand` now use `+ COMPLETION_GRACE_MS` (symmetric with `completeCommand` and `sweepStaleDelivered`)
- ✓ 6 new deny entries in `agents/shared/home-claude/settings.json` (`Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen)`, `Bash(compgen *)`, `Bash(typeset)`, `Bash(typeset *)`)
- ✓ `agents/Makefile` lifecycle targets (`reset-%`, `restart-%`, `wipe-%`, `pause-heartbeat`, `unpause-heartbeat`) gain `check-profile` dep + propagate `--profile $(PROFILE)`

## NEW findings (post-R1)

### Code/security findings worth a tight R3 fix-round

| Severity | Models | Surface | Finding |
|---|---|---|---|
| HIGH | Gemini | `agents/Makefile:204,208` (wipe-% target body, **pre-existing** from PR #548, missed in R1) | `rm -rf /workspace/*` glob doesn't match hidden files. Workspace `.env`, `.git`, `.claude`, etc. survive the wipe → state leakage between runs. Fix: change to `sh -c 'find /workspace -mindepth 1 -delete'` OR `rm -rf /workspace/* /workspace/.[!.]* /workspace/..?* 2>/dev/null || true`. |
| MED | Opus 4.7 | `agents/shared/home-claude/settings.json` (defense-in-depth gap **NOT closed** by R1) | Deny patterns match literal command prefix only: `Bash(sh -c *)` blocks `sh -c` but NOT `/bin/sh -c`, `/bin/bash -c`, `/usr/bin/python3 -c`, etc. Also `cat //proc/*/environ` (double-slash CC convention) doesn't block single-slash literal. Fix: add `Bash(/*sh -c *)`, `Bash(/*python* -c *)`, `Bash(/*node -e *)`, `Bash(/*perl -[eE] *)`, `Bash(/*ruby -e *)`, plus the single-slash `/proc/*/environ` variant. Verify CC's permission matcher supports these glob patterns before locking in. |

### Doc drift caused by R1 fix (worth a quick patch)

| Severity | Models | Surface | Finding |
|---|---|---|---|
| MED | Codex 5.4 | `docs/runbooks/dockerize-migration-v1.md:96` | Runbook examples show `make pause-heartbeat`, `make reset-elder-3`, etc. WITHOUT `PROFILE=...`. R1 `check-profile` requirement makes these now exit-1 instead of running. Fix: append `PROFILE=dev|prod` to each example. (Note: this runbook is Bundle 4 rewrite territory — could DEFER.) |
| LOW | Codex 5.4 | `agents/README.md:45` | Same — dev workflow examples need `PROFILE=` annotation. Fix: add a one-line preamble that all lifecycle targets require PROFILE, or annotate each example. |

### Minor/deferrable

| Severity | Models | Surface | Finding |
|---|---|---|---|
| LOW | Opus 4.6 | `apps/server/convex/commandBus.ts:131-132` | `completeCommand` idempotency guard `if (cmd.status === "completed") return;` fires BEFORE `leaseOwner` check. Any authenticated elder can probe completion state of another elder's command (silent no-op vs "not found" error). No state mutation. Acceptable for internal bus. DEFER — Bundle 4 strips this. |
| LOW | Opus 4.7 | `apps/server/convex/commandBus.ts:248` | Sweep predicate `.lt(leaseExpiresAt, sweepBefore)` (strict) vs ack/fail `<=` (≤). At exact 30s boundary, ack/fail throws but sweep doesn't requeue — 1ms stuck window, self-healing on next tick. Self-resolves with Bundle 4 strip. DEFER. |
| MED | Gemini | `apps/server/convex/commandBus.ts:88` | `claimNext` control-verb priority does post-index `.filter(...)` — O(N) scan over `by_target_status` rows. Acceptable for small queues. Compound `by_target_status_kind` index would fix. DEFER per Bundle 4. |

## Bundle 4 coordination note (Opus 4.7 cross-cutting)

> ttyd `--writable` removed in entrypoint.sh (R1 verified). After Bundle 4 strips the command bus, operators have NO input path unless ttyd is re-enabled writable. Coordination concern for Bundle 4's PR, not this one.

## Recommended action

**Option A (tight R3 fix-round — ~10 min):**
1. `agents/Makefile` — fix `wipe-%` dotfile glob (1 line, pre-existing Bundle 3 bug — Gemini HIGH)
2. `agents/shared/home-claude/settings.json` — add absolute-path-prefix deny patterns (~6 entries, Opus 4.7 MED)
3. `docs/runbooks/dockerize-migration-v1.md` + `agents/README.md` — append `PROFILE=` to lifecycle command examples (Codex 5.4 doc-drift)

Then R3 super-swarm + merge.

**Option B (merge now, defer all):**
- All new findings are minor or pre-existing
- 3 of 6 reviewers said CLEAN merge-ready
- 1 said "merge-ready conditional" (Opus 4.7)
- 2 said "NEEDS_FIXES" but the highest-severity is a pre-existing dotfile bug, not a regression

Bundle 4 will rewrite or strip most of this code. Investing in R3 polish has diminishing returns.

**Recommendation:** Option A for the dotfile glob + absolute-path bypass (security/operator surface that survives Bundle 4). Skip the doc drift (Bundle 4 rewrites the runbook anyway).

---

_R2 synthesis written 2026-05-23 post-super-swarm._
