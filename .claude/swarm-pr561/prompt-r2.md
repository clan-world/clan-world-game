# Phase Super-Swarm Review — PR #561 ROUND 2 (head 62efa1d)

You are doing a ROUND 2 review of PR #561 after R1 super-swarm findings were addressed in commit `62efa1d`.

**Head SHA:** `62efa1d` (R1 fix-round)
**Previous head:** `2de51e1` (R1 super-swarm reviewed this)
**R1 commit:** `62efa1d fix(pr561-r1): super-swarm fix-round — grace + deny-list + Makefile profile`

## What changed since R1

R1 super-swarm flagged a NEW HIGH (failCommand+ackCommand grace asymmetry), a NEW HIGH (env-exfil deny-list gaps), and a 5-model MED (Makefile --profile propagation). All three were applied. Other findings (migration runbook reorder, bracketed-paste injection, supervisor.lock TOCTOU, etc.) were DEFERRED per Liam's strategic directive — Bundle 4 will strip the command bus + supervisor logic entirely, so investing fix effort in code about to be removed is wasted.

### R1 fix-round delta (commit 62efa1d, 4 files / +100 / -32):

1. **`apps/server/convex/commandBus.ts`** — extended `COMPLETION_GRACE_MS = 30_000` to `ackCommand` (line 110) and `failCommand` (line 165) checks. Both now do `cmd.leaseExpiresAt + COMPLETION_GRACE_MS <= Date.now()` symmetrically with `completeCommand` and `sweepStaleDelivered`. Error messages updated to "Lease expired beyond grace — re-claim the command before <acking|failing>".

2. **`agents/shared/home-claude/settings.json`** — 6 new deny entries: `Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen)`, `Bash(compgen *)`, `Bash(typeset)`, `Bash(typeset *)`. Validated as JSON.

3. **`agents/Makefile`** — added `check-profile` dependency to lifecycle pattern targets (`reset-%`, `restart-%`, `wipe-%`, `pause-heartbeat`, `unpause-heartbeat`). Propagated `--profile $(PROFILE)` to all mutating `$(DC)` calls in these targets. `exec` calls unchanged per Opus 4.7 L2 (exec doesn't need profile).

4. **`apps/server/convex/commandBus.test.ts`** — 86 new lines of test coverage on the grace boundary for both `ackCommand` and `failCommand`.

## Your task — R2 disambiguation rules

**CRITICAL: Anchor on the `-` lines in the diff (what got REMOVED in the fix-round). Verify each R1 finding has its OLD code REMOVED before claiming it's "still broken".**

Past R2 sweeps have hallucinated that R1 fixes are "still present" by reading the OLD code in pre-fix context lines without checking the NEW state. Per memory `feedback_r2_super_swarm_hallucinates_r1_fixes.md`. To avoid this:

- For each R1 fix below, verify the EXACT line in the diff with the `-` prefix is gone, and the `+` replacement is present.
- If you want to flag the same finding as "still present at R2", READ THE FILE FROM DISK at the cited line and confirm. Don't trust diff context.

### R1 findings status (verify each)

| R1 Finding | Status to verify | File:line |
|---|---|---|
| ackCommand+failCommand grace asymmetry | Should have `+ COMPLETION_GRACE_MS` in both checks | `apps/server/convex/commandBus.ts:110`, `:165` |
| Env-exfil deny-list gaps | 6 new entries present after `Bash(export *)` | `agents/shared/home-claude/settings.json` (search for "compgen") |
| Makefile --profile missing | `check-profile` dep + `--profile $(PROFILE)` on `reset-%`, `restart-%`, `wipe-%`, `pause-heartbeat`, `unpause-heartbeat` | `agents/Makefile:181-216` |

If all three R1 fixes verified, mark them CLEAN in your output.

## Now — R2 focus areas

After confirming R1 fixes landed, look for:

1. **REGRESSIONS introduced by R1 fix-round.** Did the `COMPLETION_GRACE_MS` extension break any test logic? Did the Makefile `check-profile` dep create an unexpected target ordering issue? Does the deny-list change interact with any allow-list pattern?

2. **NEW findings in the unchanged code.** R1 reviewers focused on the 26-file diff. Are there bugs in the integrated state (Bundle 1 + 2 + 3 on dev-containerize-agents head) you can surface that R1 missed?

3. **DEFERRED-bucket validation.** Items DEFERRED per Liam's strategic directive (Bundle 4 will strip):
   - Migration runbook coexist reorder
   - bootstrap-bus-secrets prod URL guard
   - Bracketed-paste prompt injection (pre-existing)
   - TOCTOU supervisor.lock (pre-existing)
   - Freeze persistence (pre-existing)
   - `lastTickProcessed` semantics (pre-existing)
   - Non-constant-time auth (pre-existing)
   
   If you flag any of these in R2, MARK THEM `DEFERRED-PER-BUNDLE-4` so we know to not action them again. Don't re-litigate — just note presence.

## Output format

Write your full R2 review to `docs/reviews/pr561-r2-codereview-<your-model>.md`.

```
# Phase Super-Swarm Review — PR #561 R2 (head 62efa1d) — <YOUR_MODEL_NAME>

## SUMMARY
1-3 sentences: R1 fixes verified or not; new findings (if any); merge recommendation.

## R1 fixes verification
- ackCommand+failCommand grace: VERIFIED / NOT VERIFIED + evidence
- Deny-list expansion: VERIFIED / NOT VERIFIED + evidence
- Makefile --profile: VERIFIED / NOT VERIFIED + evidence

## HIGH severity findings (NEW only — DEFERRED items go to a separate section below)
file:line — one-paragraph explanation + suggested fix

## MEDIUM severity findings (NEW only)
...

## LOW severity findings (NEW only)
...

## DEFERRED-PER-BUNDLE-4
(carryover from R1 — listed for completeness, no action required this round)

## Cross-cutting observations
```

If CLEAN, say "CLEAN — R1 fixes verified, no new findings, merge ready."

Diff is at `/home/claude/claudes-world/tmp/swarm-pr561/diff-r2.txt` (also `.claude/swarm-pr561/diff-r2.txt` in-repo for gemini). Repo head is `62efa1d`. Read both as needed.
