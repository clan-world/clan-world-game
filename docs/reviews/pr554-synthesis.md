# Swarm Review Synthesis — PR #554 (dockerized Caddy v3)

**Head SHA:** `72bc366`
**Round:** 1 (full 3-tier)
**Tiers run:** 1 (Claude subagent) ✓ / 2 (Codex CLI) ✓ / 3 (Gemini flash) ✓

**Overall verdict:** **NEEDS_FIXES.** C-1 + C-2 from PR #546 are concretely fixed. New findings — 3 HIGH (1 silent-failure env-var passthrough verified live by Tier 1; 2 operator-safety runbook gaps from Tier 2) + 2 MED (healthcheck scope, port-hardcoding from cross-tier T2+T3 overlap) + 4 LOW (deferred).

## MUST FIX

| # | Severity | Tiers | File:Line | Finding |
|---|---|---|---|---|
| H-1 | HIGH | T1 (verified LIVE) | `docker-compose.yml` caddy service | `CLAN_WORLD_WEB_UPSTREAM` env var is referenced in caddy.conf via `{$CLAN_WORLD_WEB_UPSTREAM:default}` (Caddy reads from its own process env) but the caddy service has NO `environment:` block — Docker doesn't pass ambient env vars by default. Operator setting `CLAN_WORLD_WEB_UPSTREAM=http://host.docker.internal:58740` in their .env gets silently ignored, falls back to Vercel default. **Same silent-failure class as tmuxSink execFile.input bug.** Tier 1 verified live by running `caddy:2-alpine` v2.11.3 against the actual caddy.conf — config validates, `/healthz`, `/elder-1`, `/elder-1/`, `/`, `/map` all work, WebSocket pass-through verified. |
| H-2 | HIGH | T2 | `docs/runbooks/dockerize-migration-v1.md:462` | Step 8 says "insert before catch-all" but never checks if `app.clan-world.com` already exists as earlier ingress rule. Cloudflared matches first — silent shadow if duplicate. Operator could complete runbook with old route still active. |
| H-3 | HIGH | T2 | `docs/runbooks/dockerize-migration-v1.md:469` | `curl -I` exits 0 on 404/502. Verification step looks like it passed even when cloudflared is routing to wrong backend. |
| M-2 | MED→HIGH (cross-tier T2+T3 overlap) | T2 + T3 | `docs/runbooks/dockerize-migration-v1.md` + README-caddy.md | Hardcoded 18081 in cloudflared YAML vs runtime CADDY_HOST_PORT. If operator overrides, cloudflared silently 502s. Cloudflared has no shell expansion in config.yml. |

## SHOULD FIX

| # | Severity | Tiers | File:Line | Finding |
|---|---|---|---|---|
| M-1 | MED | T2 | `docker-compose.yml:274` | Caddy healthcheck is self-check only (`/healthz` → static `respond "ok"`). Compose reports healthy while Vercel-upstream is dead or elder-N missing — silent upstream failure. Don't change healthcheck (Docker healthcheck shouldn't depend on external services) — document the gap in README-caddy.md instead. |

## DEFER (follow-up polish PR)

| # | Severity | Tiers | Finding |
|---|---|---|---|
| L-1 | LOW | T1 | Two `header_up Host {upstream_hostport}` warnings on Caddy adapt. Config validates; cosmetic. Drop redundant directives. |
| L-2 | LOW | T3 | `handle /map*` block redundant — catch-all `handle` below covers same paths. |
| L-3 | LOW | T3 | Elder routes hardcoded for elder-1..4. Scaling to 12 needs manual edits to Caddyfile + depends_on. |
| L-4 | LOW | T3 | `/convex-admin/` route with basicauth was in original plan; absent here with no documented rationale. |

## SKIP

- Nothing skipped — all findings actionable or worth deferring.

## Cross-tier overlap stats

- Cross-tier overlap on port-hardcoding (M-2): T2 + T3 — high confidence
- Single-tier HIGH findings (H-1, H-2, H-3): all verified — Tier 1 ran live container for H-1
- LOWs single-tier (4 different aspects, all minor)

## Per-tier verdicts

- **T1 (Claude subagent):** NEEDS_FIXES — 1 HIGH (H-1 env-var passthrough silent failure, verified live by running real Caddy container) + 1 LOW (cosmetic Caddy adapt warning). Most thorough — actually exercised the container end-to-end.
- **T2 (Codex CLI):** NEEDS_FIXES — 4 findings (2 HIGH operator-safety on cloudflared runbook + 1 MED healthcheck scope + 1 LOW port allocator drift).
- **T3 (Gemini flash):** NEEDS_FIXES — 4 findings (1 MED port-hardcoding cross-tier with T2 + 3 LOW caddy.conf redundancies/coverage).

## Recommended action

Dispatch codex fix-round R1 to apply 3 HIGHs + 2 MEDs. Re-verify with codex tier 2 only (others already verified live or focused on architecture). Merge after R2 verify clean. LOWs go to follow-up polish PR.

## Refs

- T1 review: `~/claudes-world/tmp/swarm-review-tier1-554.md` — Claude ran real Caddy container
- T2 review: `~/claudes-world/tmp/swarm-review-tier2-554.md`
- T3 review: `~/claudes-world/tmp/swarm-review-tier3-554.md`
