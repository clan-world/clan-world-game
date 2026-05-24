# Phase Super-Swarm Synthesis — PR #560 (head 09f78c8)

**Models run:** Codex 5.3 ✓ | Codex 5.4 ✓ | Codex 5.5 ✓ | Opus 4.6 ✓ | Opus 4.7 ✓ | Gemini 3.1 Pro ✓

**NOTE on Opus 4.6:** Marked "CLEAN" but with 5 MEDIUMs (no HIGHs). It did NOT detect the merge-order bug — it described Bundle 3 components (Makefile bootstrap, Caddy snippet) as if present. Per memory `feedback_super_swarm_cross_model_disagreement_resolution`: verify against actual code. The merge-order bug is verified real via `git log origin/dev..origin/dev-containerize-agents` (11 commits stranded). Opus 4.6's MED-level findings are still useful additions.
**Phase:** dev → main (v2.14.0 release combining Bundles 1+2+3)
**Diff size:** 7716+/389- across 103 files (9771 diff lines)

## Summary

**NEEDS_FIXES — BLOCKING merge-order bug.**

The super-swarm caught a critical issue: **PR #560's diff is incomplete**. Bundle 3's work (Makefile operator entrypoint, dockerized Caddy v3, command-bus runbook, Bundle 3 cloud-review fixes) is stranded on `origin/dev-containerize-agents` and was never merged into `origin/dev`. PR #560 (`dev → main`) therefore ships an incoherent state where the elder-supervisor + command-bus auth gates are present but the operator workflow + reverse-proxy + dockerized Caddy that make them executable are missing.

**Three codex reviewers (5.3, 5.4, 5.5) all independently surfaced symptoms of this same root cause:**

- Docs reference `make up`, `make status`, `make reset-elder-N`, `make bootstrap-bus-secrets` — none of these targets exist in dev's `Makefile`. They exist in `agents/Makefile` on `dev-containerize-agents`.
- Compose declares per-elder `bus-elder-N` and `bus-operator` secret mounts — but the bootstrap path to generate those secret files and push the matching env vars into the self-hosted Convex deployment is absent from dev.
- The release brief claims dockerized Caddy v3 routing — no Caddy service exists in `docker-compose.yml` on dev. Caddy file `agents/shared/caddy.conf` exists only on `dev-containerize-agents`.

## Root cause (verified via git)

The merge timeline:
- **15:23:05 UTC** — PR #532 (`dev-containerize-services` → `dev`) merges Bundle 1
- **15:23:29 UTC** — PR #552 (`dev-containerize-agents` → `dev`) merges Bundle 2
- **15:23:45 UTC** — PR #553 (`dev-phase-3-final-polish` → `dev-containerize-agents`) merges Bundle 3 — but PR #552 has **already** merged a few seconds earlier, so Bundle 3 lands in `dev-containerize-agents` after that branch had already been integrated to dev.

Net effect: 11 commits are stranded on `dev-containerize-agents` beyond the SHA that became dev. Verified via `git log --oneline origin/dev..origin/dev-containerize-agents`.

The stranded commits include:
- `2de51e1` (Bundle 3 release merge)
- `bf9b809` + `34e8107` + `f21112f` + `e85a732` + `72bc366` (PR #554 dockerized Caddy v3 + cloud-review + R1/R2 fix-rounds)
- `ddbb7fe` + `26035e8` (PR #557 Bundle 3 cloud-review fixes)
- `275cc93` (PR #551 settings deny entries)
- `9eb16f3` (PR #549 command-bus survivors)
- `beb17c3` (PR #548 Makefile scaffolding)
- `5eee668` (PR #547 migration runbook)

26 files / +2061 LOC / -291 LOC total stranded.

## Recommended fix path (per ADR 0018)

1. **Open a new release PR** `dev-containerize-agents → dev` for the 11 stranded commits.
2. **Liam merges that PR** (Liam-only on dev per ADR 0018).
3. **Re-cycle PR #560** so the dev→main diff now includes the complete Bundle 1+2+3.
4. **Re-run super-swarm** on the updated PR #560 to verify no NEW integration seam bugs surface after the merge.

Alternative paths (NOT recommended):
- ❌ Cherry-pick Bundle 3 commits onto dev directly — breaks gitflow + loses merge audit trail.
- ❌ Close #560 + open new PR `dev-containerize-agents → main` — skips dev as the integration branch (violates ADR 0018).

## Codex synthesis (root-cause symptoms)

Once the merge-order is fixed, these specific findings need verification against the updated diff:

### Symptoms tied to "missing Bundle 3" (resolve when bundle 3 lands in dev)

| Severity | Models | Surface | Symptom |
|---|---|---|---|
| HIGH | 5.4, 5.5 | `docker-compose.yml` (compose) | No `caddy` service, no `agents/shared/caddy.conf`. Cockpit + per-elder ttyd routes unreachable. |
| HIGH | 5.4, 5.5 | `agents/README.md`, `Makefile`, `.env.template` | Docs reference `make up`/`status`/`logs`/`pause-elder-N`/`reset-elder-N`/`wipe-elder-N`/`bootstrap-bus-secrets`/`oauth-bootstrap` — none exist in dev. (All present in dev-containerize-agents' `agents/Makefile`.) |
| HIGH | 5.4, 5.5 | `apps/server/convex/commandBus.ts` (auth gate) | `BUS_OPERATOR_SECRET` + `BUS_ELDER_SECRET_N` env vars are validated against `process.env` on every call but there's no bootstrap step setting them on the self-hosted Convex backend. Bundle 3's `bootstrap-bus-secrets` Makefile target generates secret files + pushes them via `convex env set` — currently absent from dev. |

### Opus 4.7 NEW HIGHs (apply independent of merge-order fix — present in BOTH dev and dev-containerize-agents)

| Severity | Models | Surface | Finding |
|---|---|---|---|
| HIGH | 4.7 | `agents/entrypoint.sh:43` + `agents/init-firewall.sh:50-55` + `docker-compose.yml:30-31` | **ttyd `--writable` + bridge-network ACCEPT = cross-elder paste vulnerability.** ttyd runs writable with no auth; firewall permits INPUT from the entire bridge subnet; all four elders share `clan-world-internal`. So `elder-2` can `curl elder-1:7681/ws/...` and inject keystrokes into elder-1's claude pane. The bracketed-paste nonce protocol doesn't help — anyone on the bridge can speak ttyd directly. Caddy is north-south only; doesn't isolate east-west. Fix: `ttyd --interface 127.0.0.1` (docker-exec only) OR `ttyd --credential <user>:<bcrypt>` from a secret, OR iptables OUTPUT rules blocking peer ttyd ports. |
| HIGH | 4.7 | `packages/elder-runtime/src/freezeGate.ts` + `agents/entrypoint.sh:82-84` + `docker-compose.yml:36` | **Freeze gate is in-memory, silently lost on supervisor restart.** `restart: unless-stopped` brings the elder back unfrozen on any crash / OOM / `docker restart` — no operator signal that the kill-switch was bypassed. Fix: persist gate to `${stateDir}/freeze.flag` on every transition; read it on supervisor boot before starting the poll loop. |
| HIGH | 4.7 | `packages/elder-runtime/src/main.ts:132` + `packages/sdk/convex/schema.ts:8881` + `agents/heartbeat/README.md:33` | **`lastTickProcessed` increments per command, not per game tick.** Counter advances on every dispatched command (user_message, freeze, snapshot_request, reset, etc.), but schema field name + runbook framing imply game-tick progress. Observability dashboards alarming on tick stalls will be falsely green (operator sent pings) or falsely red (no ops events but elder doing tick work). Cross-PR seam bug — Bundle 2 named the field, Bundle 3's schema took it verbatim. Fix: rename to `commandsProcessed` everywhere OR wire `lastTickProcessed` to actual chain tick progress. |

### Opus 4.7 NEW MEDIUMs (apply post-merge-order-fix)

| Severity | Models | Surface | Finding |
|---|---|---|---|
| MED | 4.7 | `agents/elder:14-19` + `agents/shared/APPENDED_SYSTEM_PROMPT.md:30-37` | **`agents/elder` is a stub that prints "not implemented" and exits 0.** APPENDED_SYSTEM_PROMPT tells the Elder its only game interface is `elder world snapshot`, `elder clan view`, etc. Every Elder will boot, try `elder world snapshot`, see the stub, and have no way to act. Fix: stub should `exit 1`; system prompt must disclose stub state. |
| MED | 4.7 | `packages/elder-runtime/src/commandHandlers/reset.ts:11-17` + `agents/shared/run.sh:122-125` | **`reset` doesn't reset — it respawns the same conversation.** Reset calls `tmux.respawnPane()` which re-execs `run.sh`; run.sh always `claude --continue` when prior session JSONLs exist; `runtime/elder-N/.claude/` is a persistent volume. Operator expecting clear loses confidence. Fix: rename to `restart` OR implement real clear (remove session JSONLs). |
| MED | 4.7 | `apps/server/convex/commandBus.ts` (all mutations) | **Convex `secret` args are visible in dashboard log payload.** Every bus call passes `secret: v.string()` as arg; Convex dashboard logs args object on each invocation. Any operator with dashboard auth can read every bus secret out of historical logs. Fix: pass via `ctx.request.headers` OR ConvexAuth identity. |
| MED | 4.7 | `agents/init-firewall.sh:73-87` | **Anthropic IPs resolved once at container start, no refresh.** `getent ahostsv4 api.anthropic.com` → pinned via iptables. Anthropic uses CDN; IPs rotate. When a cached IP drops from rotation, elder loses Claude API connectivity until `docker restart`. For multi-day live demos = silent multi-hour outage. Fix: cron inside container re-running allow-host stanza every ~10 min, OR `ipset` tracking live A-records. |
| MED | 4.7 | `.env.template:277-280` + `agents/elder-1/.env.template:23-26` + `agents/shared/run.sh:34-44` | **Two parallel mechanisms for `CLAUDE_CODE_OAUTH_TOKEN` with undocumented precedence.** Per-elder env_file vs top-level overrides. If both set with different values, behavior depends on docker-compose merge order — easy to leak/misroute tokens. Pick one source of truth. |
| MED | 4.7 | `packages/elder-runtime/src/tmuxSink.ts:35-39` + `userMessage.ts:53-55` | **Bracketed-paste assumption on claude-code TUI version.** `\e[200~...\e[201~` framing only works if claude-code TUI is in bracketed-paste-aware mode. Respawn during a non-TUI prompt = framing bytes appear as literal text + NONCE marker breaks line-anchored regex. Fix: pin claude-code version + add integration test asserting marker matches against real output. |
| MED | 4.7 | `apps/server/convex/commandBus.ts:23-67` | **`enqueueCommand` has no rate-limiting.** Leaked operator secret = unbounded bus floods exhausting elder claude budget. Pair with M4 (secrets in dashboard logs) → real blast radius. Fix: per-source-window cap (10/min/source) + max payload size. |

### Gemini 3.1 Pro NEW HIGHs (apply independent of merge-order fix — present in dev AND dev-containerize-agents — VERIFIED against actual code)

| Severity | Models | Surface | Finding |
|---|---|---|---|
| HIGH | gemini-3-1-pro | `packages/elder-runtime/src/tmuxSink.ts:35` + `commandHandlers/userMessage.ts:30-36` | **Bracketed-paste prompt injection vulnerability.** `payload.text` (untrusted operator content) is concatenated with the nonce instruction + passed to `loadBuffer` + `pasteBuffer({ bracketed: true })`. If `text` contains the bytes `\x1b[201~` (end-bracketed-paste sequence), the paste terminates early + remaining content executes as raw keystrokes in the claude-code tty. **Verified real:** zero sanitization or escape applied to `payload.text` before paste. Fix: strip/escape `\x1b[201~` (and adjacent escape sequences) from text before loadBuffer; OR pass `payload.text` to claude via stdin to a `claude --print` invocation rather than tmux paste; OR add an integration test asserting paste-injection cannot break out of bracketed mode. |
| HIGH | gemini-3-1-pro | `packages/elder-runtime/src/main.ts:28-64` | **TOCTOU race in supervisor.lock between openSync and writeSync.** Process A: `openSync(lockPath, "wx")` succeeds, hasn't written PID yet. Process B: `openSync` throws EEXIST, reads empty lockfile, `parseInt("", 10) = NaN`, `Number.isFinite(NaN) = false`, skips pid-check block, falls through to `unlinkSync(lockPath)` + `openSync(lockPath, "wx")` + writes its own PID. Both processes now think they hold the lock. **Verified real:** the `if (Number.isFinite(stalePid))` branch on line 35 is the only gate before the unlink. Practical risk narrow (supervisor.lock acquired once per container boot, normal compose flow is single-supervisor-per-container) but the bug is on the singleton-lock-correctness path the previous super-swarm rounds invested in hardening. Fix: write-then-rename (atomic), OR add a lockfile-content-validity check (must contain a valid integer) before treating as stale, OR use `flock(2)` instead of file-based PID locking. |

### Gemini 3.1 Pro NEW MEDIUMs (post-merge-order-fix)

| Severity | Models | Surface | Finding |
|---|---|---|---|
| MED | gemini-3-1-pro | `docs/plans/dockerize-elder-infra-v1.md:5246` | Phase 2 cutover brings up compose (incl `heartbeat` container) while legacy systemd units still running for ~30-min window. Violates "ONLY one active heartbeat caller" invariant. Fix: documented sequencing — stop systemd-heartbeat BEFORE compose-heartbeat starts, OR add an explicit lockfile both honor. |
| MED | gemini-3-1-pro | `docker-compose.yml` (Caddy/dashboard auth — only relevant once Bundle 3 merges in) | Caddy basicauth doesn't natively support `_FILE` env var pattern. Mounting `/run/secrets/dashboard-basicauth` as `CONVEX_DASHBOARD_BASIC_AUTH_HASH_FILE` will leave dashboard unauthenticated or broken. Fix: render the auth hash into Caddyfile at boot via templating OR switch to a different auth scheme. (Applies post merge-order-fix.) |
| LOW | gemini-3-1-pro | `apps/server/convex/crons.ts:45` + `apps/server/convex/commandBus.ts:223-253` | Cron + function named `sweepStaleDelivered` but no `delivered` status exists in schema — function actually sweeps `leased`/`acked` expired-lease rows. Naming legacy from earlier design. Either rename function to `sweepExpiredLeases` (or similar) OR document the legacy name. |

### Opus 4.6 NEW MEDIUMs (apply post-merge-order-fix)

| Severity | Models | Surface | Finding |
|---|---|---|---|
| MED | 4.6 | `apps/server/convex/commandBus.ts:8,17` + `apps/server/convex/heartbeat.ts:127` | **Non-constant-time auth comparison** (pre-existing debt, flagged in PR #532 + unfixed). `checkOperatorAuth` and `checkElderAuth` use `!==` for secret comparison; webhook auth same. Timing side-channel leaks prefix/length. Low practical risk with high-entropy secrets, but pattern shipping to main for third PR in a row. Fix: `crypto.timingSafeEqual` after length-normalizing buffers, or HMAC compare. |
| MED | 4.6, 4.7 (overlap) | `apps/server/convex/commandBus.ts:32` | **`enqueueCommand` payload is `v.any()` with no size guard.** Operator-secret holder (or compromised orchestrator) can insert multi-MB payloads bloating `agentCommands` table. Fix: structured union OR explicit `JSON.stringify(payload).length` byte-length check. (Opus 4.7's M8 covers the rate-limiting angle of the same surface.) |
| MED | 4.6 | `agents/shared/home-claude/settings.json:15-21` | **CC permission deny-list has env-var exfiltration gaps.** Deny rules block `env`, `printenv`, `cat /proc/*/environ` but DON'T cover `set`, `declare -p`, `echo $VAR`, `compgen -v`. If CC's default in headless mode auto-allows unmatched Bash commands, the deny-list alone is insufficient to prevent `BUS_ELDER_SECRET_*` exfiltration via shell variable expansion. Fix: verify CC headless permission default OR add explicit `Bash(echo *)`, `Bash(set)`, `Bash(declare *)`, `Bash(compgen *)` deny rules. |
| MED | 4.6 | `packages/elder-runtime/src/convexClient.ts` | **ConvexHttpClient has no retry/backoff.** 15s timeout wrapper but zero retry. Transient Convex outage = current command fails immediately + `consecutiveErrors` ticks. Lease-expiry sweep (60s cron) eventually re-queues but elder loses 5+ minutes. Fix: 1-2 retries with jitter for transient HTTP errors (5xx, ECONNREFUSED, timeout). |

### Opus 4.6 NEW LOWs

| Severity | Models | Surface | Finding |
|---|---|---|---|
| LOW | 4.6 | `docs/plans/dockerize-v1-revision-notes.md` vs `commandBus.ts:117` | Plan doc says `acked` status REMOVED, implementation retains it (correctly — load-bearing for freeze-before-ack gate + lease-expiry sweep). Doc is stale. Update revision notes. |
| LOW | 4.6 | `packages/elder-runtime/src/commandHandlers/userMessage.ts:36` | `pasteBuffer` target is `config.elderId` while `sendKeys` uses `this.session`. Asymmetry is fragile (today equal via `SESSION_NAME=${ELDER_ID}`). Normalize to single source. |
| LOW | 4.6 | `apps/server/convex/commandBus.ts:74` | `broadcastSequence` undefined field on non-broadcast inserts pollutes `by_broadcast_sequence` index. Omit field entirely on non-broadcast. |

### Codex MEDIUMs + LOWs (apply post-merge-order-fix)

| Severity | Models | Surface | Finding |
|---|---|---|---|
| MED | 5.3, 5.4, 5.5 | `agents/shared/run.sh:47`, `packages/elder-runtime/src/config.ts:25`, elder-N templates | Stale `BUS_ELDER_SECRET` env-var path. Docs + warning still tell operators to set this env var, but the runtime now reads `BUS_ELDER_SECRET_FILE` from the Docker secret mount. Warning is false-positive misleading. Fix: remove the env-var path from templates + run.sh warning. |
| MED | 5.3 | `apps/server/convex/commandBus.ts:44`, `packages/sdk/convex/schema.ts:446` | Broadcast sequence relies on optional-key ordering of the `by_broadcast_sequence` index. If undefined-key rows compete in ordering, batches can reuse sequence ids. Suggested fix: dedicated singleton counter table. |
| MED | 5.4 | `agents/shared/run.sh:22-25` | Elder session continuity uses path-encoding heuristic + `claude --continue`. Documents that path-encoding drift causes silent fallback to fresh session. Fix: persist explicit session-id + use `claude --resume <id>`. |
| MED | 5.5 | `docs/runbooks/self-hosted-convex.md:49` | Post-deploy env block uses bare `convex env set`, bypassing pinned `CONVEX_CLI_PINNED_VERSION` enforced by `bin/deploy-convex.sh`. Fix: use `npx -y convex@${CONVEX_CLI_PINNED_VERSION}` wrapper. |
| LOW | 5.3 | `apps/server/convex/commandBus.ts:210` | Numbering comments skip `7` → `8` → `9` → `10`. Renumber. |
| LOW | 5.5 | `packages/elder-runtime/src/main.ts:75` | Readiness file written before bus/tmux operations succeed. Move marker to after first successful heartbeat or `tmux has-session`. |
| LOW | 4.7 | `packages/elder-runtime/src/config.ts:8-14` | `parsePositiveInt` accepts trailing junk (`parseInt("5min",10)` → `5`). Use regex or `Number.isInteger`. |
| LOW | 4.7 | `packages/elder-runtime/src/main.ts:148` | Singleton lock cleanup not signal-driven. Add `process.on("exit", cleanupLock)`. |
| LOW | 4.7 | `packages/elder-runtime/src/commandHandlers/{userMessage,systemMessage}.ts` | Near-duplicate handlers. Extract shared `dispatchWithNonce` helper. |
| LOW | 4.7 | `agents/heartbeat/Dockerfile` | `COPY . .` builds whole monorepo. ~2GB image. File for cleanup post-hackathon. |
| LOW | 4.7 | `docker-compose.yml` elder healthchecks | Loose `pgrep -f 'tsx.*main.ts'` pattern; tighten to anchored regex. |
| LOW | 4.7 | `apps/web/vercel.json:3-6` | `permanent: true` on `/cockpit` → `/`. Once shipped, browser/CDN caches the 301. Consider 302 until bedded in. |
| LOW | 4.7 | `entrypoint.sh:67-69` | Warns + continues when tsx/elder-runtime missing. Half-functional elder passes docker health (claude alive) but never acts on commands. Fail-closed. |

## Cross-cutting observations

- The biggest phase-level issue is not inside an individual bundle; it is the seam between them — and the merge ordering meant that seam isn't actually wired up in the dev branch.
- Test coverage is unit-level at the edges. No integration test exercises the load-bearing chain `enqueueCommand → claimNext → ack/fail/complete → tmux dispatch → nonce detection`.
- Codex CLI sandbox is read-only → all three codex reviews were emitted to stdout, NOT written directly to `docs/reviews/`. Captured manually from logs.
- Opus 4.6 + 4.7 + Gemini 3.1 Pro reviews pending (background jobs still in flight at synthesis time).

## Recommended next action

**STOP — do not merge PR #560 as-is.** Liam (or orchestrator on Liam's behalf) opens `dev-containerize-agents → dev` release PR for the 11 stranded commits. Once merged, recycle PR #560 + re-run super-swarm.

Once dev contains Bundle 1+2+3:
- Re-verify codex's HIGH-2 (`make` targets) is resolved
- Re-verify codex's HIGH-3 (Convex env passthrough for bus secrets) by tracing `agents/Makefile bootstrap-bus-secrets` execution
- Apply codex's stale `BUS_ELDER_SECRET` env-var path cleanup (M-1 above) as a follow-up fix-round
- Defer the broadcast-sequence + session-id + Convex CLI pinning findings to backlog issues

---

_Synthesis written 2026-05-23 by orchestrator. Opus + Gemini reviews pending — will be re-folded into this doc when complete._
