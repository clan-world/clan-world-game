# Phase Super-Swarm Synthesis — PR #561 (head 2de51e1)

**Models run:** Codex 5.3 ✓ | Codex 5.4 ✓ | Codex 5.5 ✓ | Opus 4.6 ✓ | Opus 4.7 ✓ | Gemini 3.1 Pro ✓
**Phase:** dev-containerize-agents → dev (Bundle 3 merge-order recovery)
**Diff size:** 2061+/291- across 26 files (2581 diff lines)

## Verdicts

| Reviewer | Verdict | HIGH | MED | LOW |
|---|---|---|---|---|
| Codex 5.3 | NEEDS_FIXES | 0 | 1 | 2 (pre-existing) |
| Codex 5.4 | NEEDS_FIXES | 2 | 2 | 2 (pre-existing) |
| Codex 5.5 | NEEDS_FIXES | 2 | 3 | 3 (pre-existing) |
| Opus 4.6 | NEEDS_FIXES (non-blocking, "merge safe") | 1 | 3 | 3 |
| Opus 4.7 | NEEDS_FIXES (minor, "ship-able") | 0 | 7 | 4+ |
| Gemini 3.1 Pro | NEEDS_FIXES | 1 NEW + 2 pre-existing | 3 | 2 |

**Overall verdict:** 4 of 6 say NEEDS_FIXES; both Opus variants say "merge safe / ship-able". The HIGHs fall into 3 buckets: NEW in this delta (1 cross-model), DOC-only (1 cross-model), or pre-existing (carried from earlier Bundle 2). Recommend a tight fix-round on the 2 NEW HIGHs + 1 cross-model MED, then merge.

## MUST FIX (NEW in this PR's delta)

| Severity | Models | Surface | Finding |
|---|---|---|---|
| HIGH | Opus 4.6, Opus 4.7 (2-model) | `apps/server/convex/commandBus.ts:110-115` (ackCommand) + `:165-167` (failCommand) | **`ackCommand` and `failCommand` ignore the new `COMPLETION_GRACE_MS` window.** Only `completeCommand` (`:151-152`) and `sweepStaleDelivered` (`:248-249`) honour the 30s grace. Race: supervisor calls `failCommand` at T=361s (1s past 360s lease), gets `Lease expired` error; sweeper at T=361s does NOT requeue (within grace); command stuck `leased`/`acked` until T=391s. Self-healing but produces noisy error logs + stale "stranded" window. **VERIFIED against actual file at line 165** — no `+ COMPLETION_GRACE_MS` present. Fix: add `+ COMPLETION_GRACE_MS` to both checks (2 line touches). |
| HIGH | Codex 5.4, 5.5, Gemini 3.1 Pro, Opus 4.6, Opus 4.7 (5-model) | `agents/shared/home-claude/settings.json:15-21` | **Env-var exfiltration deny-list still allows direct shell expansion.** PR #551 added 13 new entries blocking `set`, `declare`, `export`, `node -e`, `python -c`, etc. — but `echo $TOKEN`, `printf '%s\n' "$TOKEN"`, `compgen -v` remain allowed. The primary defense is the allow-list (`Bash(elder *)`, `Bash(date *)`); non-listed commands would prompt for permission. But under `bypassPermissions` (used in autonomous container modes) the deny-list is the only gate. Fix: add `Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen)`, `Bash(compgen *)`, `Bash(typeset *)` to deny-list. Smoke-test against actual Claude Code permission matcher. |
| MED | Codex 5.3, 5.4, 5.5, Gemini, Opus 4.6 (5-model) | `agents/Makefile:300-323` (reset-%, restart-%, wipe-%) | **Lifecycle pattern targets miss `--profile $(PROFILE)` flag.** Elder services are profile-scoped (`profiles: [dev, prod]`), so Docker Compose v2 rejects `up -d` calls without `--profile`. Documented operator commands like `make reset-elder-3` / `make wipe-elder-3 LEVEL=session` fail with "service elder-N is not enabled by any profile." Fix: add `check-profile` dep + `--profile $(PROFILE)` to all `$(DC)` invocations in `reset-%`, `restart-%`, `wipe-%`, `pause-heartbeat`, `unpause-heartbeat`. |

## DEFER TO FOLLOW-UP PR (DOC-only or pre-existing)

| Severity | Models | Surface | Reason for deferral |
|---|---|---|---|
| HIGH | Codex 5.4, 5.5 (2-model) | `docs/runbooks/dockerize-migration-v1.md:370-378, 549-578` | Runbook orders `systemctl disable clanworld-runner` BEFORE the 30-min coexist observation window — contradicts locked plan policy. DOC issue. Operationally relevant only when an operator follows the runbook step-by-step on prod cutover. Not yet executed; can fix in a follow-up PR before any prod migration is attempted. |
| HIGH | Gemini 3.1 Pro (pre-existing) | `packages/elder-runtime/src/tmuxSink.ts:35` + `commandHandlers/userMessage.ts:30-36` | Bracketed-paste prompt injection. Pre-existing from PR #543 / merged with Bundle 2. NOT introduced by this PR. Follow-up: sanitize `payload.text` for `\x1b[201~` before paste. |
| HIGH | Gemini 3.1 Pro (pre-existing) | `packages/elder-runtime/src/main.ts:28-64` | TOCTOU race in supervisor.lock between openSync and writeSync. Pre-existing. Narrow practical window. Follow-up: use `flock(2)` or atomic write-then-rename. |
| MED | Codex 5.4, 5.5, Opus 4.7 (3-model) | `agents/Makefile:380-382` `bootstrap-bus-secrets` | Defaults `CONVEX_SELF_HOSTED_URL` to `http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}` — works in dev (loopback proxy), silently mis-targets in prod (no host port published). Runbook step 5 explicitly sets the right URL, so documented path is safe. Follow-up: add `check-profile`-style fail-loud guard when `PROFILE=prod` and `CONVEX_SELF_HOSTED_URL` unset. |
| MED | Codex 5.4, 5.5 (2-model) | `agents/Makefile:353` `smoke-test` target | Only checks Convex reachability, NOT Caddy router / per-elder ttyd / command-bus round-trip. False green. Doesn't forward `PROFILE`. Follow-up: rename to `check-convex-health` OR expand to full stack smoke. |
| MED | Opus 4.6 (single-model) | `apps/server/convex/commandBus.test.ts` | No explicit test for `claimNext` fallback path (when no control verbs queued). Implicitly covered. Follow-up: add explicit test documenting the two-query contract. |
| MED | Opus 4.7 (single-model) | `agents/shared/caddy.conf:30-58` | No auth on `/elder-N/` routes — fully reliant on Cloudflare Access. Acceptable for hackathon scope per `agents/shared/README-caddy.md:14-17`. Follow-up: add Caddy basicauth defense-in-depth layer. |
| MED | Opus 4.7 (single-model) | `agents/Makefile:401-428` `bootstrap-convex-dashboard-auth` | Dead code that ships in help menu. No `/convex-admin/` Caddy route consumes the file. Computes sha512crypt hash that Caddy basicauth (bcrypt-only) would reject. Follow-up: delete or wire up. |
| MED | Opus 4.7 (single-model) | `agents/Makefile:317-323` `wipe LEVEL=full` followup | Printed instruction `make oauth-bootstrap-elder-N` is a no-op without `FORCE=1` because the host `agents/elder-N/.env` survives the volume wipe. Follow-up: print `FORCE=1` variant or clarify host-token persistence. |
| MED | Opus 4.7 (single-model) | `docker-compose.rehearsal.yml:18, 41` | Rehearsal compose defaults Convex images to `:latest` while root compose pins SHA. Rehearsal validity at risk. Follow-up: align defaults to root compose pin. |
| MED | Gemini (pre-existing) | freezeGate.ts | Freeze gate in-memory, lost on restart. Pre-existing. Follow-up: persist to `${stateDir}/freeze.flag`. |
| MED | Gemini (pre-existing) | `packages/sdk/convex/schema.ts:8881` | `lastTickProcessed` counts commands not ticks. Pre-existing semantic drift. Follow-up: rename or rewire. |
| LOW | Codex 5.3, 5.4, 5.5, Opus 4.6 (4-model pre-existing) | `apps/server/convex/commandBus.ts:8,17` + `heartbeat.ts:127` | Non-constant-time `!==` for secret comparison. Carried from prior PRs. Follow-up: `crypto.timingSafeEqual`. |
| LOW | Opus 4.7 | `agents/shared/caddy.conf:65` | `handle /map*` matches `/map/`, `/mapper`, `/mapquest` (overly broad). Functionally OK since both routes go to same upstream. Polish: `handle /map/*` exact. |
| LOW | Opus 4.7 | `agents/shared/caddy.conf:31` | `redir @bare_elder {path}/ 308` vs plan's 301. 308 is more correct (preserves method); doc should match. |
| LOW | Opus 4.7 | `agents/Makefile:139` vs rehearsal doc | Convex CLI pin (1.39.1 Makefile default vs 1.17.4 rehearsal). Comment would help. |

## Verified WINS from this delta

- ✓ `ttyd --writable` removed from `agents/entrypoint.sh` — closes the PR #560 cross-elder paste RCE surface (gemini + all opus reviewers confirmed)
- ✓ Bus secret bootstrap path complete: `bootstrap-bus-secrets` writes mode-0600 secret files + pushes matching `BUS_OPERATOR_SECRET` + `BUS_ELDER_SECRET_1..4` + `WEBHOOK_SHARED_SECRET` into Convex env (codex 5.3 + 5.4 + opus 4.7 verified)
- ✓ Caddy `/elder-N/*` route stripping + HTTP/1.1 upstream WebSocket compatibility (codex 5.3 + gemini verified)
- ✓ Command bus control-verb priority + 30s `COMPLETION_GRACE_MS` window for completeCommand/sweepStaleDelivered (verified across all reviewers — note H1 above for the ack/fail asymmetry)
- ✓ Extended secret-exfil deny-list in `settings.json` (13 new entries, though gaps remain — see HIGH-B above)
- ✓ `commandBus.test.ts` extended to cover control-verb priority + 30s completion grace path

## Recommended action

**Tight fix-round (2-3 file touches):**
1. `apps/server/convex/commandBus.ts` — add `+ COMPLETION_GRACE_MS` to ackCommand line 110 + failCommand line 165
2. `agents/shared/home-claude/settings.json` — add 5 deny entries: `Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen)`, `Bash(compgen *)`, `Bash(typeset *)`
3. `agents/Makefile` — add `check-profile` dep + `--profile $(PROFILE)` to `reset-%`, `restart-%`, `wipe-%`, `pause-heartbeat`, `unpause-heartbeat` (5-model MED consolidated)

Estimated: ~15 min codex fix-round + re-swarm.

Then merge PR #561 to dev (Liam-only per ADR 0018). Then recycle PR #560 super-swarm against the now-complete diff.

**Defer to a single follow-up PR (`fix/bundle3-doc-and-prexisting-followup`):**
- Migration runbook reorder
- Bracketed-paste sanitization
- Supervisor.lock TOCTOU
- Freeze persistence
- `lastTickProcessed` rename
- Non-constant-time auth
- Smoke-test scope expansion
- Caddy basicauth defense-in-depth
- Various MED/LOW polish

---

_Synthesis written 2026-05-23 by orchestrator post-super-swarm._
