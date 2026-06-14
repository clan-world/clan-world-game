# Phase Super-Swarm Review — PR #561 (head 2de51e1) — codex-5-5

## SUMMARY
NEEDS_FIXES. The merge mostly wires the Bundle 3 pieces together, but the production migration runbook now disables the legacy runner before the advertised coexist/health gates, and the Elder Claude deny-list still allows trivial env-var exfiltration. I would not merge until those two are corrected; the rest can be follow-up.

## HIGH severity findings

- `docs/runbooks/dockerize-migration-v1.md:370` / `docs/runbooks/dockerize-migration-v1.md:377` — The runbook masks `clanworld-runner.service` before the internal health gate, public routing gate, web Convex swap, and 30-minute observation. This contradicts the locked coexist policy in `docs/plans/dockerize-elder-infra-v1.md:93`, which says legacy stays enabled/running through smoke + routing + observation and only then gets disabled. Operationally this turns the migration into a one-way heartbeat cutover before the new stack has passed its own gates; a bad Docker heartbeat, bad webhook URL, or bad Convex env leaves no live legacy heartbeat while operators debug. Fix by starting the new stack with the Docker heartbeat paused/stopped during coexist, keeping legacy runner live until after the full validation gate, then performing the heartbeat handoff as the final cutover step.

- `agents/shared/home-claude/settings.json:15` — The added deny-list still does not cover the prompt brief's required env exfil paths. `env`, `printenv`, `set`, and some interpreters are blocked, but `echo $CLAUDE_CODE_OAUTH_TOKEN`, `printf '%s\n' "$CLAUDE_CODE_OAUTH_TOKEN"`, and `compgen -v` remain allowed; `declare -p` depends on the broad `Bash(declare *)` match but should be explicit. Since the per-Elder OAuth token is injected by `env_file` and the agent has Bash access, this still lets a compromised prompt dump secrets. Add explicit deny patterns for `Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen -v*)`, `Bash(declare -p*)`, and the single-slash `/proc/*/environ` variants, then smoke-test the actual Claude Code permission matcher.

## MEDIUM severity findings

- `agents/Makefile:249` — `bootstrap-bus-secrets` does inject `BUS_OPERATOR_SECRET`, `BUS_ELDER_SECRET_1..4`, and `WEBHOOK_SHARED_SECRET`, but it silently defaults `CONVEX_SELF_HOSTED_URL` to `http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}` at `agents/Makefile:274`. In the prod compose profile the backend API is not published on localhost; only dev has the loopback proxy. Running the documented `make -C agents setup PROFILE=prod` can therefore generate files and then fail or target the wrong local instance when setting Convex env. Make prod fail loud unless `CONVEX_SELF_HOSTED_URL` is explicitly set to the routed self-hosted API URL, or start/use a deliberate prod admin loopback.

- `agents/Makefile:353` / `bin/check-stack-health.sh:64` — `make -C agents smoke-test` is documented as an end-to-end stack health check, but the script only checks Convex backend/site/dashboard reachability. It does not check the new Caddy router, `/elder-N/` routes/WebSocket upgrade, heartbeat freshness, per-Elder tmux/ttyd/supervisor health, or a command-bus round trip. This leaves the release-level operational checklist with a false green. Either rename the target to `check-convex-health` or expand it to the advertised smoke gate before relying on it in the migration runbook.

- `agents/Makefile:184` / `agents/Makefile:190` / `agents/Makefile:197` — Several state-mutating targets ignore the stated `PROFILE` contract. `pause-heartbeat`, `unpause-heartbeat`, `reset-%`, `restart-%`, and `wipe-%` call `docker compose` without `--profile $(PROFILE)` and do not run `check-profile`, even though the file header says `PROFILE` is required on every state-mutating target. In a mixed dev/prod operator session this is easy to run against the wrong compose profile or to start a profiled service implicitly. Add `check-profile` prerequisites and pass `--profile $(PROFILE)` consistently.

## LOW severity findings

- `apps/server/convex/commandBus.ts:10` — PRE-EXISTING: operator and Elder secret comparisons are still plain string equality, not constant-time. This was already called out from PR #560; keep as follow-up unless this release wants to touch command-bus auth now.

- `packages/elder-runtime/src/main.ts:92` — PRE-EXISTING: `lastTickProcessed` is still incremented per processed command at `packages/elder-runtime/src/main.ts:132`, not per game tick. Dashboard/status consumers should not interpret it as an actual chain tick until renamed or rewired.

- `packages/elder-runtime/src/tmuxSink.ts:35` — PRE-EXISTING: bracketed paste still passes content through without sanitizing embedded bracketed-paste control sequences. The async stdin loading fix is present, but the prompt-injection hardening remains follow-up.

## Cross-cutting observations

- Verified: Docker Caddy routes `/elder-1/` through `/elder-4/` to the Bundle 2 ttyd port `7681` in `agents/shared/caddy.conf:24`, and `agents/entrypoint.sh:45` now starts ttyd read-only by omitting `--writable`.

- Verified: `bootstrap-bus-secrets` writes `0600` secret files and sets the matching Convex env names used by `apps/server/convex/commandBus.ts:10` and `apps/server/convex/commandBus.ts:19`; the remaining issue is prod URL targeting, not env-name mismatch.

- Verified: command-bus tests now cover control-command priority and the new 30s completion grace path. They do not cover the production bootstrap path or Caddy/ttyd routing, which is where the release-level risk remains.
