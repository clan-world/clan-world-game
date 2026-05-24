# Phase Super-Swarm Review — PR #560 (dev → main)

You are a senior staff engineer doing the FINAL pre-merge code review for the v2.14 release-train PR. This PR merges Bundles 1, 2, and 3 from `dev` to `main`.

**Head SHA:** `09f78c8`
**Diff size:** 7716+/389- across 103 files (9771 diff lines)
**Branches merged:** `dev-containerize-services`, `dev-containerize-agents`, `dev-phase-3-final-polish`

## Phase context

This release ships the full ClanWorld elder-agent dockerization migration. Components shipping:

- **Bundle 1 (containerize-services):** Self-hosted Convex backend (#347), heartbeat container (#353), docker-compose scaffold (#344)
- **Bundle 2 (containerize-agents):** Elder container image w/ tmux+ttyd+Claude Code (#345), shared/ layout (#350), Node supervisor w/ command-bus poll+tmux dispatch (#352), URL scheme rename cockpit→root (#354)
- **Bundle 3 (phase-3-final-polish):** Command-bus schema extraction (#351), Makefile bootstrap (#355), migration runbook (#356), dockerized Caddy v3 (#348), SettleLatch removal (#517)
- **Cloud-review fix rounds:** #557, #558, #559 (Copilot findings on per-bundle integration branches)

Each sub-issue went through individual swarm cycles (1-6 super-swarm rounds each). This is the COHESIVE PHASE review.

## Your task

This is a cohesive multi-bundle release. Look for:

1. **CROSS-BUNDLE bugs** — Bundle 2's supervisor command bus calls into Bundle 1's Convex schema; Bundle 3's Caddy + Makefile assume Bundle 2's elder-N service names. Integration seams.
2. **ARCHITECTURAL drift** — does the phase actually deliver "elders running in containers w/ centralized command bus"? Any sub-issue that diverged from plan?
3. **SECURITY surface** — auth (BUS_ELDER_SECRET, OAuth tokens as secrets), input validation, prompt injection on bracketed-paste, TOCTOU (lock file race), resource leaks, dashboard auth (HTPASSWD bcrypt vs SHA512-crypt), Convex env var handling
4. **DATA-flow correctness** — command-bus schema consistency, idempotency (commandId, nonce), error paths, lease expiry sweep, agentCommands + elderHeartbeat tables, replay safety
5. **Integration risks** — newly-added container infra effect on existing on-chain paths (heartbeat firing schedule, Convex polling), regression surface, host-host vs container-host networking
6. **Operational risk** — deploy ordering (convex first, heartbeat second, elders third), rollback safety, runtime config gaps, env-var fail-closed defaults, Docker secret mounts
7. **Missing test coverage** on integration seams — supervisor command-bus → tmux dispatch chain is high-risk

USE PARALLEL TOOL CALLS / SUB-AGENTS aggressively. You have full repo read access at `/home/claude/code/clan-world/clan-world-game`. Read all changed files. Look up callers of new functions. Trace state machines end-to-end. Don't just skim the diff — understand the SHIPPING SURFACE.

## Recent memory anchors (lessons from this work)

- PR #543 supervisor shipped with `execFileAsync(..., { input: content } as any)` — Node's `input` option is sync-variant only, async silently ignores. Fixed in PR #545 (`ff705bf`). Look for OTHER sync-vs-async API option overlaps.
- PR #503 SettleLatch introduced Cycle A waiting for Cycle B latch across 6 super-swarm rounds without ever being approved by Liam. Reverted in #523/#517. Look for OTHER undocumented architectural drift.
- Cross-PR seam bugs — 2+ sub-PRs touching same codegen surface OR import/export pair often pass individual CI while combined state breaks (`feedback_cross_pr_seam_bugs_need_combined_typecheck.md`). This is exactly what this combined release surfaces.

## Output format (write the entire review to the file at the path your dispatch invocation specifies)

```
# Phase Super-Swarm Review — PR #560 (head 09f78c8) — <YOUR_MODEL_NAME>

## SUMMARY
2-4 sentences: overall verdict (CLEAN | NEEDS_FIXES), top concerns, merge recommendation.

## HIGH severity findings
(real bugs, security issues, data corruption, broken invariants. Each with file:line and one-paragraph explanation + suggested fix.)

## MEDIUM severity findings
(should-fix; design quality, missing edge cases, operational issues)

## LOW severity findings
(defer-OK; nits, style, minor cleanups, follow-up issues to file)

## Cross-cutting observations
(things that don't fit the per-finding format — patterns across the diff, architectural drift, suggested refactors)
```

If clean, say "CLEAN — no findings" under each section.

Diff is at `/home/claude/claudes-world/tmp/swarm-pr560/diff.txt`. Repo is at `/home/claude/code/clan-world/clan-world-game`. Read both as needed.
