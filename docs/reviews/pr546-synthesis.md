# Swarm Review Synthesis — PR #546 (Caddy host-imported snippet)

**Head SHA:** `c1e1478`
**Round:** 1
**Tiers run:** 1 (Claude subagent) ✓ / 2 (Codex CLI) ✓ / 3 (Gemini flash) ✓ / cloud reviewers — pending (PR just opened)

**Overall verdict:** **NEEDS_FIXES — BLOCK MERGE.** 2 architectural HIGHs that are not fixable in a small patch; needs Liam's call on the infrastructure approach.

## MUST FIX (block merge)

| # | Severity | Tiers | File:Line | Finding | Notes |
|---|---|---|---|---|---|
| C-1 | CRITICAL | T1+T2 (cross-tier overlap) | `agents/entrypoint.sh:43` + `agents/shared/caddy.conf:38` | **Public RCE risk.** Entrypoint launches ttyd with `--writable` + no auth; snippet would proxy that to public-internet `app.clan-world.com/elder-N/`. Legacy `cockpit.clan-world.com/elder-N-tty/` uses `-R` (readonly) per `runtime/elders/systemd/ttyd-elder.service.template:9`. PR silently inverts the security posture — public RCE on elder containers (claude OAuth tokens, OPERATOR_PRIVATE_KEY, RPC). **Architectural decision required: basicauth in Caddy vs Cloudflare Access policy vs revert entrypoint to `--readonly` + no auth gate.** |
| C-2 | CRITICAL | T1 (single-tier but verified on-host) | `agents/shared/caddy.conf:1` | **Snippet won't actually route traffic.** Defines top-level `app.clan-world.com { ... }` site block, but host caddy wraps every `*.clan-world.com` hostname inside `:18080 { bind 127.0.0.1 }` because cloudflared terminates TLS and forwards plain HTTP to that loopback port. Verified via `/etc/cloudflared/config.yml` (no `app.clan-world.com` entry) + `ss -tlnp` on host (caddy binds `:443`, `:80`, `127.0.0.1:18080`). Install + validate would succeed green, but production traffic never reaches the new block. **Fix: nest snippet inside `:18080` block OR add new cloudflared ingress entry for app.clan-world.com.** |

## SHOULD FIX (during fix-round)

| # | Severity | Tiers | File:Line | Finding |
|---|---|---|---|---|
| H-1 | HIGH | T1 | `agents/shared/caddy.conf:93-103` | Vercel reverse_proxy blocks missing `import cf_https_proto`. Cockpit pattern uses this everywhere — without it Vercel sees `X-Forwarded-Proto: http` and can emit 301 redirect loops / mixed-content asset URLs. |
| H-2 | HIGH | T3 | `apps/web/src/components/cockpit/tabs/TerminalTab.tsx:29` + `useConnectionStatus.ts:24` | Hardcoded `https://app.clan-world.com` — web app and ttyd co-served from same Caddy, so relative URLs (`/elder-N/`) would be environment-portable. Breaks local dev / staging. |
| M-1 | MED | T1 | `agents/shared/caddy.conf` global + `bin/install-caddy-snippet.sh` | Host-global `servers { timeouts { idle 1h, write 0 } }` documented in README-caddy.md as required, but NOT verified or set by installer. Current host global has only `protocols h1 h2`. Symptom: every ttyd session drops at default 5-minute idle, install appears successful. Same silent-failure shape as recent tmuxSink `execFileAsync({input}as any)` bug. |
| M-2 | MED | T3 | `bin/install-caddy-snippet.sh:58,143` | `sudo caddy` PATH fragility — Debian's `secure_path` excludes `/usr/local/bin`. Capture `CADDY_BIN=$(command -v caddy)` in preflight. |
| M-3 | MED | T3 | `bin/install-caddy-snippet.sh:128` | Appending import at EOF risks nesting inside unclosed block. Also unquoted `SNIPPET_PATH` breaks if path contains spaces. |
| M-4 | MED | T2 | `bin/install-caddy-snippet.sh:139` | Restore-on-reload-failure runs `sudo systemctl reload caddy \|\| true` then unconditionally exits 4 with "original restored" message. If second reload also fails, log claim is misleading. |

## DEFER (file follow-up issues)

| # | Severity | Tiers | File:Line | Finding |
|---|---|---|---|---|
| L-1 | LOW | T3 | `agents/shared/caddy.conf:30` | `@ws_elder` matcher defined but never used (Caddy handles WS automatically). |
| L-2 | LOW | T3 | `bin/install-caddy-snippet.sh:111` | Dots in `SNIPPET_PATH` unescaped regex wildcards in `sed`. |
| L-3 | LOW | T2 | `bin/install-caddy-snippet.sh:47` | `grep -Fxq` without `sudo` on root-owned 640 Caddyfile. |

## SKIP

None — all findings appear actionable or worth deferring as issues.

## Cross-tier overlap stats

- Findings flagged by 2+ tiers: 1 (C-1 — both T1 + T2 caught the no-auth issue)
- Single-tier findings: 8 (T1 caught 3 high-severity infrastructure issues via on-host verification; T3 caught script gotchas + URL portability; T2 caught script masking-error)

## Per-tier verdicts

- **T1 (Claude subagent):** NEEDS_FIXES — 4 findings (2 CRITICAL, 1 HIGH, 1 MED). Most thorough — verified against actual on-host caddy + cloudflared config.
- **T2 (Codex CLI):** NEEDS_FIXES — 3 findings (1 HIGH, 1 MED, 1 LOW). Caught security gap + install script silent-failure.
- **T3 (Gemini flash):** NEEDS_FIXES — 5 findings (1 HIGH, 2 MED, 2 LOW). Caught URL portability + script gotchas.

## Recommended action

**BLOCK MERGE pending Liam's architectural call.**

C-1 and C-2 are not fixable in a small patch — they require infrastructure-design decisions:

1. **Auth model:** Cloudflare Access (zero-trust) policy on `app.clan-world.com`? Caddy `basicauth`? Tokenized URL? Revert ttyd `--writable` to `--readonly` regardless?
2. **Routing model:** Add `app.clan-world.com` to `/etc/cloudflared/config.yml` ingress AND nest snippet inside `:18080 { bind 127.0.0.1 }`? Or add a direct cloudflared ingress that bypasses caddy for ttyd routes?

H-1 / M-1..4 / L-1..3 are mechanical fixes that can land in the fix-round once the architectural shape is decided.

## Refs

- T1 review: `~/claudes-world/tmp/swarm-review-tier1-546.md`
- T2 review: `~/claudes-world/tmp/swarm-review-tier2-546.md`
- T3 review: `~/claudes-world/tmp/swarm-review-tier3-546.md`
- Legacy infra reference: `~/.claude/projects/-home-claude-claudes-world/memory/reference_cockpit_clan_world_infra.md`
