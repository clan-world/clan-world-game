# Phase Super-Swarm Review — PR #561 (dev-containerize-agents → dev)

You are a senior staff engineer doing the FINAL pre-merge code review for the Bundle 3 merge-order recovery PR.

**Head SHA:** `2de51e1`
**Diff size:** 2061+/291- across 26 files (2581 diff lines)
**Branch:** `dev-containerize-agents` → `dev`

## Phase context

This PR is a **merge-order recovery**. Bundle 3 work landed on `dev-containerize-agents` 16 seconds AFTER PR #552 already merged that branch into dev — so Bundle 3 got stranded. This PR absorbs the 11 stranded commits into dev.

Components absorbed:
- **Bundle 3 release merge** (PR #553) — phase-3-final-polish
- **PR #554** dockerized Caddy v3 router (`agents/shared/caddy.conf`, `caddy:` service in compose) + cloud-review + R1/R2 fix-rounds
- **PR #557** Bundle 3 cloud-review fixes (`agents/Makefile` status target, dashboard-auth bcrypt validation)
- **PR #551** `agents/shared/home-claude/settings.json` — 13 secret-exfil deny entries (PR #421 opus 4.7 addendum)
- **PR #549** command-bus survivors (PR #421 R1+R2+addendum correctness fixes)
- **PR #548** `agents/Makefile` + `.docker-mounts` scaffolding — operator entrypoint (issue #355)
- **PR #547** Phase 2 migration runbook + rehearsal compose + transcript (issue #356)

## Your task

Each sub-PR already cleared per-PR swarm. This release-PR-level review focuses on:

1. **Integration with what's already on dev.** The base (`dev`) already has Bundle 1 (heartbeat container, self-hosted Convex) + Bundle 2 (elder containers, supervisor, command-bus schema, URL rename, ttyd bracketed-paste protocol). The delta absorbs Bundle 3 on top. Look for integration seams where Bundle 3's additions miss-wire against Bundle 2's pre-existing state.
2. **Cross-bundle wiring correctness.** Does `agents/Makefile`'s `bootstrap-bus-secrets` actually push the matching `BUS_OPERATOR_SECRET` + `BUS_ELDER_SECRET_N` into the self-hosted Convex (so Bundle 2's `commandBus.ts` auth gates actually work)? Does the dockerized Caddy actually route to the per-elder ttyd ports declared in Bundle 2?
3. **Operational completeness.** Are documented Makefile targets (`make up`, `make status`, `make logs`, `make pause-elder-N`, `make reset-elder-N`, `make wipe-elder-N LEVEL=<workspace|session|full>`, `oauth-bootstrap`) all actually implemented? Do they handle PROFILE correctly?
4. **Security surface.** ttyd authentication on the new Caddy reverse-proxy path. Dashboard basicauth via `_FILE` env (Caddy doesn't support natively — was this fixed?). Secret-file permissions (chmod 0600).
5. **Migration safety.** Phase 2 cutover runbook — heartbeat container vs legacy systemd timer overlap window. Rollback steps if cutover fails mid-flight.
6. **Test coverage.** New `commandBus.test.ts` (644 lines) — does it exercise the full FSM including failure paths?

## Cross-cutting heads-up (from PR #560 super-swarm 30 min ago)

These findings are PRESENT on dev (i.e. introduced earlier in Bundle 2, NOT in this PR's delta) and you may re-flag them — treat them as DEFER-FOR-FOLLOWUP rather than block-this-merge:

- Bracketed-paste prompt injection in `packages/elder-runtime/src/tmuxSink.ts` (paste content not sanitized for `\x1b[201~`)
- TOCTOU race in `packages/elder-runtime/src/main.ts:28-64` supervisor.lock
- Freeze gate in-memory only — restart silently unfreezes
- ttyd `--writable` + bridge-network ACCEPT = cross-elder paste
- `lastTickProcessed` counts commands not ticks
- Non-constant-time auth comparison in `apps/server/convex/commandBus.ts`
- CC permission deny-list env-var exfiltration gaps in `agents/shared/home-claude/settings.json:15-21` — was extended in PR #551 (13 new entries), please verify the extended list covers `echo $VAR`, `set`, `declare -p`, `compgen -v`

If any of these have been FIXED in this PR's delta, call out the fix. If they're unchanged, mention them as pre-existing.

USE PARALLEL TOOL CALLS aggressively. Repo is at `/home/claude/code/clan-world/clan-world-game`. Diff is at `/home/claude/claudes-world/tmp/swarm-pr561/diff.txt` (also at `.claude/swarm-pr561/diff.txt` in-repo for gemini's sandbox). The base for comparison is `origin/dev`.

## Output format

Write your full review to the file your dispatch invocation specifies (`docs/reviews/pr561-codereview-<your-model>.md`). If you cannot write to that path (sandbox restriction), emit the full review content to stdout and the orchestrator will save it.

```
# Phase Super-Swarm Review — PR #561 (head 2de51e1) — <YOUR_MODEL_NAME>

## SUMMARY
2-4 sentences: overall verdict (CLEAN | NEEDS_FIXES), top concerns, merge recommendation.

## HIGH severity findings
(real bugs, security issues, data corruption, broken invariants. Each with file:line and one-paragraph explanation + suggested fix. Mark PRE-EXISTING if not introduced by this PR's delta.)

## MEDIUM severity findings
(should-fix; design quality, missing edge cases, operational issues)

## LOW severity findings
(defer-OK; nits, style, minor cleanups, follow-up issues to file)

## Cross-cutting observations
(patterns across the diff, integration assertions verified or violated)
```

If clean, say "CLEAN — no findings" under each section.
