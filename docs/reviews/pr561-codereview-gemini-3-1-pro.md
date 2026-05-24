# Phase Super-Swarm Review — PR #561 (head 2de51e1) — Gemini

## SUMMARY
NEEDS_FIXES. This PR successfully absorbs the Bundle 3 stranded commits, wires Docker Caddy efficiently, and adds robust lease grace periods to the command bus. However, there is a critical security gap in the Claude permissions blocklist for environment exfiltration, and a major process deviation in the migration runbook regarding the legacy runner's "coexistence" phase.

## HIGH severity findings

**Security gap in Claude's environment exfiltration deny-list**
*File:* `agents/shared/home-claude/settings.json:19`
*Description:* While PR #551 extended the deny-list to correctly block `set`, `declare`, and `export`, it missed the most direct environment exfiltration vectors: `env`, `printenv`, `compgen`, and variable expansion via `echo`. A malicious prompt can still easily exfiltrate `BUS_ELDER_SECRET_N` by invoking `Bash(env)` or `Bash(printenv)`.
*Fix:* Add `"Bash(env)"`, `"Bash(env *)"`, `"Bash(printenv)"`, `"Bash(printenv *)"`, `"Bash(compgen *)"`, and `"Bash(echo $*)"` to the blocklist.

**PRE-EXISTING HIGH:** Bracketed-paste prompt injection in `packages/elder-runtime/src/tmuxSink.ts` (paste content not sanitized for `\x1b[201~`).
**PRE-EXISTING HIGH:** TOCTOU race in `packages/elder-runtime/src/main.ts:28-64` supervisor.lock.

## MEDIUM severity findings

**Runbook deviates from locked coexistence plan by stopping legacy runner early**
*File:* `docs/runbooks/dockerize-migration-v1.md:275` (Step 6)
*Description:* Step 6 stops and disables `clanworld-runner.service` *before* the 30-minute coexistence observation window. This contradicts the Phase 2 plan which mandates "Legacy systemd units stay ENABLED AND RUNNING". While stopping the legacy runner is operationally necessary to prevent nonce collisions (since both runners use the same `RUNNER_PRIVATE_KEY`), it means legacy is NOT actively processing chain events during the observation window. If the new stack fails, the game experiences downtime. 
*Fix:* Update the Runbook and Plan to acknowledge this reality—"coexistence" is strictly for observing Convex data routing, but chain processing requires a hard cutover.

**PRE-EXISTING MEDIUM:** Freeze gate in-memory only — restart silently unfreezes.
**PRE-EXISTING MEDIUM:** `lastTickProcessed` counts commands not ticks.

## LOW severity findings

**Makefile `PROFILE` parameter not propagated to all `docker compose` commands**
*File:* `agents/Makefile:158` (and lines 165, 180, 183)
*Description:* Targets like `pause-elder-%`, `reset-%`, and `restart-%` invoke `$(DC)` (which aliases `docker compose`) without propagating the `--profile $(PROFILE)` flag. While `exec` and explicit service restarts often infer context correctly if the service exists, commands like `$(DC) up -d --force-recreate $*` inside `reset-%` execute without the explicit profile context, which can cause erratic behavior if dependencies differ by profile.
*Fix:* Consistently pass `--profile $(PROFILE)` to all `$(DC)` invocations inside lifecycle targets.

**PRE-EXISTING LOW:** Non-constant-time auth comparison in `apps/server/convex/commandBus.ts`.

## Cross-cutting observations

- **Cross-elder Paste Vulnerability FIXED:** The pre-existing issue (`ttyd --writable` + bridge-network ACCEPT) was successfully fixed in this delta by removing the `--writable` flag from `agents/entrypoint.sh`, properly enforcing read-only terminals.
- **Integration with Dev Base:** The PR correctly wires the Caddy ttyd routes, dropping the explicit WebSocket headers in favor of Caddy v2's native support, which safely integrates with the Bundle 2 ttyd bracketed-paste additions.
- **Cross-bundle Wiring:** `bootstrap-bus-secrets` successfully pushes `BUS_ELDER_SECRET_N` to the Convex env, verifying integration with the auth gates introduced in Bundle 2's `commandBus.ts`.
- **Test Coverage:** `commandBus.test.ts` thoroughly validates the new control-verb priorities and the 30s lease grace window, successfully handling lease-expiry edge cases.
