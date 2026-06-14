# Swarm Review Synthesis — PR #547 (Phase 2 migration runbook)

**Head SHA:** `66f3bf6`
**Round:** 1
**Tiers run:** 2 (Codex CLI) ✓ / 3 (Gemini flash) ✓ — T1 skipped due to Anthropic API outage incident at 04:16 UTC (capacity-conservation choice for docs-only PR)

**Overall verdict:** **NEEDS_FIXES.** 2 operational HIGHs + 4 MEDs in runbook accuracy. Fix-round dispatch warranted (not architectural, all docs-text changes).

## MUST FIX

| # | Severity | Tiers | File:Line | Finding |
|---|---|---|---|---|
| H-1 | HIGH | T2 | `docker-compose.rehearsal.yml:23` | No `INSTANCE_SECRET` set; `generate_admin_key.sh` depends on it. Image may auto-generate but runbook doesn't capture/prove that, so Step 1 admin-key generation can produce an unusable key silently. **Fix:** Add explicit `INSTANCE_SECRET` env value (random) + a verification step that the generated admin-key actually authenticates against the backend. |
| H-2 | HIGH | T2 | `docs/runbooks/dockerize-migration-v1.md:340` (Step 6) | Step 6 starts Docker `heartbeat` while legacy runner stays live until Step 11. If heartbeat fires on-chain transactions or Convex scheduler writes during coexist window, production work double-fires. No single-writer gate documented. **Fix:** Either (a) reorder — mask legacy `clanworld-runner.service` in Step 5 BEFORE Step 6 starts Docker heartbeat, OR (b) document that Docker heartbeat starts in a paused state until Step 11. |

## SHOULD FIX

| # | Severity | Tiers | File:Line | Finding |
|---|---|---|---|---|
| M-1 | MED | T2 | `docs/runbooks/dockerize-migration-v1.md:79` | `.env.local` is not auto-loaded by Docker Compose (only `.env` is). Operators following instruction can hit missing-variable failures. **Fix:** Use `--env-file .env.local` explicitly OR rename to `.env`. |
| M-2 | MED | T2 | `docs/runbooks/dockerize-migration-v1.md:110` | `CLAN_WORLD_LENS_ADDRESS` missing from Required Environment table but set in Step 5. Can silently push empty value to Convex. **Fix:** Add to table. |
| M-3 | MED | T2 | `docs/runbooks/dockerize-migration-v1.md:111` | Env inventory names `BUS_ELDER_SECRET_FILE_1..4` but Step 5 hardcodes `agents/secrets/bus-elder-N.key`. Operators with custom `.env` paths read wrong files silently. **Fix:** Use `${BUS_ELDER_SECRET_FILE_N:-agents/secrets/bus-elder-N.key}` pattern. |
| M-4 | MED | T2 | `docs/runbooks/dockerize-migration-v1.md:428` (Step 8) | Step 8 rollback says "remove the additive host Caddy import/snippet and reload host Caddy" but gives no file path or command. **Fix:** Reference `bin/install-caddy-snippet.sh --uninstall`. |
| L-1 | LOW | T3 | `docs/runbooks/dockerize-migration-v1.md` (~Step 1) | Variable name inconsistency — intro says `export CONVEX_CLI_PINNED_VERSION=1.17.4` but Step 1 rehearsal block uses `export CONVEX_CLI_VERSION=1.17.4`. **Fix:** Normalize to `CONVEX_CLI_PINNED_VERSION` (Makefile-canonical name). |

## DEFER

| # | Severity | Tiers | File:Line | Finding |
|---|---|---|---|---|
| L-2 | LOW | T2 | `docs/runbooks/dockerize-migration-v1.md:638` | Pager Quick Ref lists only dev loopback Convex URLs, omitting production routed API/dashboard URLs needed during Step 3/8/9 incident response. **Defer:** add follow-up issue or fold into a future docs polish PR. |

## SKIP

- Gemini's HIGH "Repo/Path Mismatch" + "Missing Infrastructure" findings — Gemini's sandbox failed to read the repo; FALSE POSITIVES.
- Gemini's HIGH "Step 3/4 Reachability" — partially valid but unverifiable from diff alone; covered by Codex's MED M-1 (env-file loading).

## Cross-tier overlap stats

- Findings flagged by 2+ tiers: 0 (T2 + T3 caught different angles — Codex on accuracy, Gemini on consistency)
- Single-tier findings: 7

## Per-tier verdicts

- **T2 (Codex CLI):** NEEDS_FIXES — 7 findings (2 HIGH, 4 MED, 1 LOW). Methodical accuracy pass; flagged real operational risks (coexist window, INSTANCE_SECRET, env-file gotcha).
- **T3 (Gemini flash):** NEEDS_FIXES — 1 valid finding (variable name inconsistency). Other 5 were sandbox-error false-positives.
- **T1 (Claude subagent):** SKIPPED — Anthropic API outage incident at 04:16 UTC, conserving capacity for #546 (architectural review). Docs-PR doesn't need deep cross-tier coverage.

## Recommended action

Dispatch codex fix-round on PR #547 to apply HIGH + MED + LOW fixes. Re-stage swarm tier 2 + 3 after fixes land. Merge when clean.

L-2 (Pager Quick Ref prod URLs) → file follow-up issue for next docs polish PR.

## Refs

- T2 review: `~/claudes-world/tmp/swarm-review-tier2-547.md`
- T3 review (notes): see Gemini agent output `ac1662e0e7cdb47f8.output`
