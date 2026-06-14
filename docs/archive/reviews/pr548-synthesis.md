# Swarm Review Synthesis — PR #548 (agents/Makefile + .docker-mounts)

**Head SHA:** `569e424`
**Round:** 1
**Tiers run:** 2 (Codex CLI) ✓ / 3 (Gemini flash) ✓ — T1 skipped due to Anthropic API outage incident

**Overall verdict:** **NEEDS_FIXES (minor).** 2 operator-edge-case MEDs + 1 security-improvement LOW. All small, fixable in one round. Fix-round dispatched.

## SHOULD FIX (during fix-round)

| # | Severity | Tiers | File:Line | Finding |
|---|---|---|---|---|
| M-1 | MED | T2 | `agents/Makefile:210-213` | `pause-elder-%`/`unpause-elder-%`: `kill -STOP $(pgrep ...)` emits no PID + exits non-zero when elder process isn't running. Direct `make pause-elder-N` invocation fails hard. Fan-out loop's `\|\| true` masks this for bulk ops only. **Fix:** Capture pgrep output, check for empty, log "already paused" if empty. |
| M-2 | MED | T2 | `agents/Makefile:228` | `reset-%`: only the `tmux-kill` line has Make error-ignore prefix; `$(DC) restart $*` has no fault tolerance. After LEVEL=full wipe (container removed), `restart` cannot act. **Fix:** Use `$(DC) up -d --force-recreate $*` which works on removed/stopped/running containers. |
| L-1 | LOW | T2 | `agents/Makefile:348` | `bootstrap-convex-dashboard-auth` stores password as unsalted SHA-256. **Fix:** Drop-in `openssl passwd -6` (SHA-512-crypt with random salt). Rename JSON field from `password_sha256` to `password_sha512crypt`. |

## CLEAN areas (verified by both tiers)

- `$$` vs `$` escaping throughout — correct (Tier 2 + Tier 3 confirmed)
- `.PHONY` declarations — pattern targets correctly use `FORCE` dependency (Tier 2 + Tier 3 confirmed)
- `bootstrap-bus-secrets` partial-failure recovery — local files skip on rerun, Convex env sets re-push unconditionally (Tier 2 confirmed)
- `bootstrap-convex-admin-key` delegation to root Makefile — correct pattern (Tier 2 confirmed)
- `oauth-bootstrap-%` shell injection — token written inside double-quotes; OAuth token charset is base64url-safe (Tier 2 confirmed; Tier 3 confirmed no injection)
- `pgrep -f 'tsx.*elder-runtime/src/main.ts'` probe pattern — accurate for containerized tsx runtime (Tier 3 confirmed)
- Caddy targets — correctly OMITTED per PR #546 architectural block (Tier 2 + Tier 3 confirmed)
- `.gitignore` `agents/.docker-mounts/*` + `!.docker-mounts/.gitkeep` negation pattern — correct (Tier 3 confirmed)

## Per-tier verdicts

- **T2 (Codex CLI):** NEEDS_FIXES — 3 findings (2 MED, 1 LOW). Focused operator-edge-case + security-hardening pass.
- **T3 (Gemini flash):** CLEAN — 0 findings. (Note: gemini-3-flash initially produced a HIGH about corrupted bash keywords, but the wrapper agent identified this as a flash hallucination and recorded the verdict as CLEAN.)

## Recommended action

Dispatch codex fix-round R1 to apply all 3 findings. Re-verify with codex Tier 2 only (gemini already CLEAN). Merge when re-verify passes.

## Refs

- T2 review: `~/claudes-world/tmp/swarm-review-tier2-548.md`
- T3 review: `~/claudes-world/tmp/swarm-review-tier3-548.md`
