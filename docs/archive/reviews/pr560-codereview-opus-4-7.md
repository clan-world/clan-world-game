# Phase Super-Swarm Review — PR #560 (head 09f78c8) — opus-4-7

## SUMMARY

**NEEDS_FIXES.** Architecturally the bundle hangs together, but it ships a non-functional command bus on a fresh deploy: there is no script or runbook step to generate the `BUS_OPERATOR_SECRET` / `BUS_ELDER_SECRET_N` values that `commandBus.ts` requires as `process.env`, and no `agents/secrets/bus-elder-*.key` bootstrap target — every bus mutation throws `Unauthorized` until an operator hand-rolls both sides. Bundle 3's promised Caddy snippet (#348) and migration runbook (#356) are not in the diff, the operator-facing VPS bootstrap runbook still references the legacy `~/clan-world/elder-N` layout, and `ttyd` is started `--writable` with no auth on a network where the egress firewall explicitly ACCEPTs inputs from every other elder. Recommend blocking merge until the bus-secret bootstrap + runbook gap is closed and ttyd is either bound to loopback or fronted by inter-container auth.

## HIGH severity findings

**H1 — Command bus is unusable on fresh deploy: no `BUS_*` secret bootstrap or `convex env set` step.**
`apps/server/convex/commandBus.ts:7-15` enforces `process.env.BUS_OPERATOR_SECRET` and `process.env.BUS_ELDER_SECRET_<N>` on every mutation. The Convex side reads these from the backend's runtime env, which on self-hosted requires `convex env set …`. But:
- `docs/runbooks/self-hosted-convex.md:41-56` lists every Convex env an operator needs to set after first deploy — `WEBHOOK_SHARED_SECRET`, `INDEXER_SECRET`, etc. — and omits all `BUS_*` keys.
- `Makefile:7` declares `bootstrap-convex-admin-key` but no `bootstrap-bus-secrets` target; `docs/plans/dockerize-elder-infra-v1.md:796/1491` calls for it explicitly. `agents/scripts/bootstrap-bus-secrets.sh` does not exist.
- `docker-compose.yml:28-43` references `./agents/secrets/bus-elder-{1..4}.key` and `bus-operator.key` as docker secrets, but the files are gitignored (`.gitignore:201`) and nothing creates them.

Net effect: on first `make up`, every elder calls `claimNext` → backend throws `Unauthorized: BUS_ELDER_SECRET_1 required` because Convex env was never populated; operator simultaneously has to invent the same secret on the host side. Fix: ship a `bootstrap-bus-secrets` target that (a) `openssl rand -hex 32` × 5, (b) writes them mode 0600 under `agents/secrets/`, (c) `convex env set BUS_OPERATOR_SECRET … && BUS_ELDER_SECRET_N …` for each. Add the corresponding section to `self-hosted-convex.md`. SHIP-BLOCKER.

**H2 — `ttyd --writable` with no auth + firewall ACCEPTs full bridge network = any elder can paste into any other elder.**
`agents/entrypoint.sh:43` runs `ttyd --port 7681 --writable tmux attach-session -t ${SESSION_NAME}` with no `--credential`. `agents/init-firewall.sh:50-55` then permits `INPUT` from `172.16.0.0/12` and `10.0.0.0/8`. The elder containers all sit on the `clan-world-internal` bridge (`docker-compose.yml:30-31`), so `elder-2` can `curl http://elder-1:7681/ws/...` and inject keystrokes into elder-1's claude pane. The bracketed-paste nonce protocol in `userMessage.ts` doesn't help because anyone on the bridge can speak the ttyd protocol directly. The host caddy is supposed to terminate auth (per `README.md:443` and the missing #348 snippet), but (a) caddy is not in this PR, and (b) caddy only sees north-south traffic — east-west between elders bypasses it. Fix: either `ttyd --interface 127.0.0.1` (then ttyd only accessible via `docker exec`) or `ttyd --credential <user>:<basicauth-bcrypt>` from a docker secret, or add iptables rules that restrict OUTPUT to peer ttyd ports. Don't rely on caddy for inter-container isolation.

**H3 — Freeze state is in-memory and silently lost on supervisor restart.**
`packages/elder-runtime/src/freezeGate.ts` keeps `frozen` in a Node field. `agents/entrypoint.sh:82-84` exits the container the moment the supervisor PID dies, and `docker-compose.yml:36` sets `restart: unless-stopped` — so any handler crash, OOM, or `docker restart elder-1` brings the elder back **unfrozen** with zero operator signal. `freeze` is documented as a kill-switch in `docs/plans/dockerize-elder-infra-v1.md` and is the only thing standing between an operator and an Elder that's misbehaving on-chain. Fix: persist the gate to `${stateDir}/freeze.flag` on every transition; read it on supervisor boot before starting the poll loop.

**H4 — `heartbeatState.lastTickProcessed++` per command, not per tick — misleads `elderHeartbeat.lastTickProcessed`.**
`packages/elder-runtime/src/main.ts:132` increments on every successfully dispatched command (any kind), then `heartbeat.ts:18` writes it as `lastTickProcessed` to the `elderHeartbeat` table (`packages/sdk/convex/schema.ts:8881`). The schema field name and the runbook framing (`agents/heartbeat/README.md:33`: "lastTickProcessed") imply game-tick progress, but the counter has no relationship to ticks — it counts user_message + system_message + freeze + unfreeze + snapshot_request + reset events. A dashboard alarming on "elder not advancing ticks" will be either falsely green (operator sent some snapshot pings) or falsely red (no ops events but elder is doing tick work invisibly). Fix: either rename the field to `commandsProcessed` everywhere or wire `lastTickProcessed` to actual chain tick progress (which requires the elder CLI to land — see M2).

## MEDIUM severity findings

**M1 — Bundle 3 is incomplete vs the brief:** PR brief lists "dockerized Caddy v3 (#348)" and "migration runbook (#356)" as Bundle 3 outputs. Neither exists in this PR — no `host/caddy/`, no `Caddyfile`, no migration runbook in `docs/runbooks/`. `README.md:443-453` documents the workflow as if the Makefile / caddy snippet exist. Either the bundle is mis-scoped or operators have no documented path to switch.

**M2 — `agents/elder` is a stub that exits 0 with a "not implemented" message, but the Elder system prompt instructs Claude to use it for everything.**
`agents/elder:14-19` prints "elder CLI not yet implemented" and `exit 0`. `agents/shared/APPENDED_SYSTEM_PROMPT.md:30-37` tells the Elder its **only** game interface is `elder world snapshot`, `elder clan view`, `elder clan submit-orders`, etc. Every Elder will boot, get its first tick, try `elder world snapshot`, see the stub message, and have no way to act. The shared `CLAUDE.md` doesn't warn about the stub. At minimum the stub should `exit 1` so handlers don't treat "success" as "I ran the command", and the APPENDED_SYSTEM_PROMPT should disclose the stub state.

**M3 — `handleReset` does not reset context.** `packages/elder-runtime/src/commandHandlers/reset.ts:11-17` calls `tmux.respawnPane()` which re-execs `run.sh`. `agents/shared/run.sh:122-125` always `claude --continue` when `$SESSIONS_DIR/*.jsonl` exists — and `runtime/elder-N/.claude/` is a persistent named volume (`docker-compose.yml:264-265`), so prior sessions always exist after first boot. So "reset" = "restart the same conversation". Operator expecting a clear loses confidence in the verb. Either rename the command to `restart` in the schema's union (`packages/sdk/convex/schema.ts:8852`) and matching runtime types, or implement a real clear (remove session JSONLs before respawn).

**M4 — Convex mutation `secret` args are visible in the dashboard log payload.**
`enqueueCommand`, `claimNext`, `ackCommand`, `completeCommand`, `failCommand`, `releaseLease`, `getQueuedFor`, `heartbeat` all take `secret: v.string()` as an arg. Convex dashboard logs the args object on each invocation — so any operator with dashboard auth can read every bus secret out of historical logs. Pass via header (`ctx.request.headers`) or move to ConvexAuth identity, not arg.

**M5 — `init-firewall.sh` resolves Anthropic IPs once at container start, no refresh.**
`agents/init-firewall.sh:73-87` `getent ahostsv4 api.anthropic.com` and pins the IPs into `iptables -A OUTPUT -p tcp -d <ip> --dport 443 -j ACCEPT`. Anthropic uses a CDN; IPs rotate. When the cached IP is dropped from rotation, the elder loses Claude API connectivity until `docker restart elder-N` rebuilds the firewall. There's no refresh cron, no DNS-name iptables module (`xt_owner` / `ipset` would help). For multi-day live demos this could cause silent multi-hour outages. Fix: add a cron inside the container that re-runs the allow-host stanza every ~10 min, OR use a tiny DNS-aware proxy / `ipset` to track live A-records.

**M6 — `agents/elder-1/.env.template` requires `CLAUDE_CODE_OAUTH_TOKEN` (run.sh:34-44 hard-fails on missing) — but `.env.template` line 277-280 also lists `ELDER_N_ANTHROPIC_API_KEY` and `ELDER_N_CLAUDE_CODE_OAUTH_TOKEN` as top-level defaults.**
Two parallel mechanisms (per-elder env_file + top-level overrides) for the same secret with no documented precedence. If both are set with different values, behavior depends on docker-compose merge order — easy to leak / misroute tokens between elders. Pick one source of truth.

**M7 — `tmuxSink.pasteBuffer` always uses bracketed paste `-p -r` against claude.**
`packages/elder-runtime/src/tmuxSink.ts:35-39` sends `\e[200~...\e[201~` framed input. claude-code's TUI must be in bracketed-paste-aware mode to strip the framing. If a future claude version (or a respawn during a non-TUI prompt) reads input raw, the framing bytes appear as literal text in the prompt — and the embedded NONCE marker is now on a multi-line paste, possibly breaking the line-anchored regex in `userMessage.ts:53-55`. Pin a claude-code version or add an integration test that asserts the marker matches against real claude output.

**M8 — `enqueueCommand` rate-limiting is absent.**
`apps/server/convex/commandBus.ts:23-67` takes `secret + targetAgentId + kind + payload` with no quota. A leaked operator secret = unbounded bus floods that exhaust the elder's claude budget. Pair this with the dashboard-log-leak (M4) and the blast radius is real. Add a per-source-window cap (10 / minute / source) and a max payload size.

## LOW severity findings

**L1 — `config.ts:parsePositiveInt` accepts trailing junk.** `parseInt("5min",10)` → `5`, no validation. Use `Number.isInteger(Number(val))` or a regex check. `packages/elder-runtime/src/config.ts:8-14`.

**L2 — Singleton lock cleanup not signal-driven.** `packages/elder-runtime/src/main.ts:148` calls `cleanupLock()` only after the while loop exits cleanly. SIGKILL / OOM leaves a stale file (the stale check on the next boot handles it, but adds a warning). Add `process.on("exit", cleanupLock)`.

**L3 — `handleSystemMessage` is a near-copy of `handleUserMessage`.** Future fixes to one will drift from the other. `packages/elder-runtime/src/commandHandlers/{userMessage,systemMessage}.ts` — extract shared `dispatchWithNonce` helper.

**L4 — `tmuxSink.sendKeys` passes a trailing empty-string arg.** `packages/elder-runtime/src/tmuxSink.ts:14` — `["send-keys", "-t", session, key, ""]`. tmux ignores empty key args but it's a confusing leftover, will trip future readers.

**L5 — `agents/elder` exits 0.** `agents/elder:19` — should be `exit 1` so callers (Claude included) see the stub state as a failure, not silent success.

**L6 — `agents/heartbeat/Dockerfile` does `COPY . .`.** Builds the whole monorepo into the image. `.dockerignore` filters it, but `apps/`, `packages/contracts/`, `apps/web/` all end up in the image regardless. Slow CI rebuilds, ~2GB image. Acceptable for hackathon, file for cleanup.

**L7 — `docker-compose.yml` elder healthchecks pgrep-match `tsx.*main.ts` and `ttyd`.** Loose patterns; any sibling process matching falsely passes the check. `pgrep -f '^tsx.*elder-runtime/src/main\.ts$'` is tighter.

**L8 — `config.ts:runScriptPath` is dead.** Set to `/opt/clan-world/shared/run.sh` but never referenced in the supervisor (entrypoint.sh owns tmux session creation). Remove from `ElderRuntimeConfig` (`packages/elder-runtime/src/types.ts:30`).

**L9 — `enqueueCommand` broadcast uses `ELDER_IDS` env (defaulting to elder-1..4) while `.env.template:272` documents `ELDER_COUNT=4`.** Two parallel knobs for the same fact; scaling to 12 (planned per `docker-compose.yml:233`) requires updating both. Wire one to the other or drop `ELDER_COUNT`.

**L10 — `entrypoint.sh:67-69`** warns and continues when `tsx`/`elder-runtime` is missing. With no supervisor the elder boots, claude runs, but no command bus participation. Should be fail-closed (`exit 1`) — a half-functional elder will pass docker health (claude alive) but never act on commands.

**L11 — `apps/server/convex/commandBus.ts:181 retryCount` increments inside `failCommand` AND `sweepStaleDelivered`.** If the supervisor `failCommand`s right as the sweeper grabs the same row, the row's retry can double-increment (sweeper runs first → status=queued, retryCount=1; supervisor's lease-expired check rejects, no harm done because failCommand throws). Verified safe but worth a test.

**L12 — `apps/web/vercel.json:3-6` `permanent: true`** for `/cockpit` → `/`. Once shipped, this is cached by browsers / CDN; reverting the rename later requires a cache-bust dance. Consider `permanent: false` (HTTP 302) until the rename has bedded in for a few weeks.

## Cross-cutting observations

**C1 — The cross-bundle deploy ordering is correct (convex → heartbeat → elders) but undocumented as a hard ordering.** Compose `depends_on: convex-backend: condition: service_healthy` enforces it at start. But operators reading `docs/runbooks/self-hosted-convex.md` will think "deploy is done" after step 3 and not realize they still need to (a) bootstrap bus secrets (H1), (b) set bus env on Convex, (c) bring up elders. Add an end-to-end "first stack-up" runbook that walks from clean checkout to "4 elders dispatching commands".

**C2 — SettleLatch removal is correctly localized.** `packages/runner/src/heartbeatScheduler.ts`, `tickLoop.ts`, `heartbeatLoopMain.ts`, `main.ts`, `types.ts` all dropped the latch and its tests. The standalone heartbeat container relies on Convex `nextHeartbeatAtTs` + the success-file healthcheck. Clean revert; this is the right outcome of the #517 thread.

**C3 — `lastTickProcessed` semantics drift (H4) is exactly the kind of cross-PR seam bug the brief warns about** — Bundle 2 named the field, Bundle 3's schema took it at face value, no one noticed the counter increments on `freeze` events. A combined-state test that enqueues a `freeze` and asserts `lastTickProcessed` is unchanged would have caught it.

**C4 — `agents/elder` stub + APPENDED_SYSTEM_PROMPT contradiction (M2) is also a cross-bundle seam:** Bundle 2 ships the system prompt assuming the CLI works; the CLI implementation was scoped to a different (unspecified) future issue. The elder Claude will discover the gap at runtime, not at deploy.

**C5 — The `secret` arg pattern in commandBus mutations (M4) is a re-introduction of a known anti-pattern.** Move to a header-based auth as part of #330; the current shape locks every operator with dashboard access into the bus's auth surface.

**C6 — Container architecture is sound for the v1 scope.** Dockerfile, entrypoint, firewall, tmux supervisor pattern, atomic singleton lock (with TOCTOU split), bracketed-paste protocol with line-anchored nonce, sweepStaleDelivered with retryCount cap — all of these are well-designed for hackathon-grade reliability. The actual code quality is good; the issues above are integration / operational gaps the per-issue swarms couldn't see in isolation.
