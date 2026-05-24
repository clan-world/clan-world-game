# Phase Super-Swarm Review — PR #561 (head 2de51e1) — codex-5-3

## SUMMARY
NEEDS_FIXES. Bundle 3 wiring is mostly coherent (Docker Caddy routing, command-bus secret bootstrap, ttyd `--writable` removal, lease/grace alignment), but one operator-critical Makefile path is miswired: reset/wipe flows invoke `docker compose up` without profile selection and can fail against profile-gated elder services. Merge after that lifecycle bug is fixed; pre-existing security follow-ups remain.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- `agents/Makefile:201`, `agents/Makefile:214`, `agents/Makefile:306` — `reset-%`/`wipe-%` execute `$(DC) up -d --force-recreate $*` via `reset-$*` without `--profile $(PROFILE)` and without `check-profile`. Elder services are profile-scoped (`dev`/`prod`), so documented commands like `make reset-elder-3` / `make wipe-elder-3 LEVEL=session` can fail with service-disabled/profile resolution errors or behave inconsistently depending on current compose state. Suggested fix: require `PROFILE` on reset/wipe targets (or propagate stored profile), and use `$(DC) --profile $(PROFILE) ...` for all mutating elder lifecycle calls.

## LOW severity findings
- PRE-EXISTING — `apps/server/convex/commandBus.ts:8`, `apps/server/convex/commandBus.ts:17`: secret checks still use direct string comparison (non-constant-time). This was already flagged in prior swarm; unchanged in this delta.
- PRE-EXISTING (partially improved) — `agents/shared/home-claude/settings.json:19`: deny-list was expanded, but the specific exfil paths called out in prior swarm are still not explicitly blocked (`declare -p`, `compgen -v`, plus `echo $VAR`-style expansions through allowed shells). Keep as follow-up hardening.

## Cross-cutting observations
- Verified fix in this PR: ttyd is now started without `--writable` in `agents/entrypoint.sh`, reducing direct browser-terminal write risk on `/elder-N/` routes.
- Verified cross-bundle bus wiring: `bootstrap-bus-secrets` generates `BUS_OPERATOR_SECRET`, `BUS_ELDER_SECRET_1..4`, `WEBHOOK_SHARED_SECRET` files with `chmod 0600` and injects matching Convex env vars.
- Verified lease/race mitigation alignment: `apps/server/convex/commandBus.ts` raises lease to 6m, adds `COMPLETION_GRACE_MS`, and `packages/elder-runtime/src/config.ts` docs now match the intended timeout margin.
- Docker Caddy routing (`agents/shared/caddy.conf`) correctly strips `/elder-N` prefixes and pins elder upstream transport to HTTP/1.1 for ttyd WebSocket compatibility.
