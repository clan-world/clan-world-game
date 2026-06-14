# Phase Super-Swarm Review — PR #561 (head 2de51e1) — codex-5-4

## SUMMARY
NEEDS_FIXES. Bundle 3 lands the missing Caddy service, Makefile, and runbook pieces, and the ttyd posture is materially better now that `--writable` is gone. But two merge-blocking seams remain: the migration runbook inverts the locked coexist policy and the expanded Claude deny-list still leaves trivial env-var exfil paths open. I would fix those before merge; the remaining issues are operational follow-up.

## HIGH severity findings

- `docs/runbooks/dockerize-migration-v1.md:370-378`, `docs/runbooks/dockerize-migration-v1.md:549-578`, `docs/plans/dockerize-elder-infra-v1.md:93`, `docs/plans/dockerize-elder-infra-v1.md:959`  
  The new runbook disables `clanworld-runner.service` and starts the Docker heartbeat in Step 6, then only does the internal health gate, public routing cutover, and 30-minute "coexist" observation afterward. That is the opposite of the plan’s locked policy: legacy must stay live through smoke + cutover + observation, with the new heartbeat paused during coexist. As written, a bad Docker heartbeat, bad webhook URL, or bad Convex env turns the migration into an early one-way heartbeat cutover with no live legacy caller left while operators debug. Keep legacy running until after the full validation gate, and use `pause-heartbeat`/`unpause-heartbeat` for the handoff instead of stopping legacy first.

- `agents/shared/home-claude/settings.json:19-39`, `agents/shared/run.sh:35-45`, `docker-compose.yml:263-276`  
  PR #551 improves the deny-list, but it still does not cover the brief’s required exfil paths. `env`/`printenv`/`set` are blocked, yet direct shell expansion still survives via commands like `echo $CLAUDE_CODE_OAUTH_TOKEN`, `printf '%s\n' "$CLAUDE_CODE_OAUTH_TOKEN"`, and `compgen -v`; the elder OAuth token is definitely present because `run.sh` hard-fails without it and compose injects it from `agents/elder-N/.env`. That leaves a straightforward secret-dump path from the browser-terminal/agent tool surface the PR claims to harden. Add explicit denies for `Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen -v*)`, and the other prompt-brief variants, then verify against Claude Code’s actual permission matcher.

## MEDIUM severity findings

- `agents/Makefile:249-290`, `agents/Makefile:274`, `Makefile:16-33`  
  `bootstrap-bus-secrets` now writes the right secret files and pushes the matching `BUS_OPERATOR_SECRET`, `BUS_ELDER_SECRET_1..4`, and `WEBHOOK_SHARED_SECRET` names into Convex, but its default target URL is still `http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}`. That works in dev because Bundle 1 added the loopback proxy, but prod does not publish the backend on localhost. Following the documented `make -C agents setup PROFILE=prod` path can therefore generate files and then fail midway, or worse, talk to the wrong local instance if a dev proxy is also up. Make prod fail loud unless `CONVEX_SELF_HOSTED_URL` is explicitly set to the routed self-hosted admin URL, or provide a deliberate prod-only admin loopback.

- `agents/Makefile:230-240`, `agents/Makefile:353-354`, `bin/check-stack-health.sh:14`, `bin/check-stack-health.sh:64-70`  
  The new operator flow tells VPS users to finish setup with `make smoke-test`, but the target does not forward `PROFILE`, so the script silently falls back to `PROFILE=dev`. On prod that means the advertised final health gate can probe the wrong topology, and even in the right profile it only checks Convex backend/site/dashboard reachability, not the new Caddy router, `/elder-N/` routing, heartbeat freshness, or an elder command-bus round trip. At minimum pass `PROFILE=$(PROFILE)` through the target; ideally either rename this to reflect its current scope or expand it into the end-to-end smoke gate the runbook now depends on.

## LOW severity findings

- `apps/server/convex/commandBus.ts:6-8`  
  PRE-EXISTING: auth still uses plain string equality for `BUS_OPERATOR_SECRET` and `BUS_ELDER_SECRET_N`, not constant-time comparison. This was already called out on PR #560 and is unchanged here.

- `packages/elder-runtime/src/tmuxSink.ts:35-39`  
  PRE-EXISTING: the bracketed-paste path is still unsanitized for embedded `\x1b[201~`, so the prompt-injection follow-up from PR #560 remains open. This PR improves ttyd exposure but does not change the tmux sink risk.

## Cross-cutting observations

- Verified fix: `agents/entrypoint.sh` now starts ttyd read-only, so the earlier public `--writable` RCE concern is reduced to browser viewing plus command-bus writes.
- Verified wiring: the new Caddy config routes `/elder-1/` through `/elder-4/` to the Bundle 2 ttyd ports and preserves the `/` + `/map` frontend fan-out.
- Verified tests improved in the right place: `apps/server/convex/commandBus.test.ts` now covers control-command priority and the new 30s completion grace path, but there is still no release-level smoke covering `cloudflared -> caddy -> ttyd` plus a real command-bus round trip.
