# DA review: dockerize-elder-infra-v1.md (codex)

WIP — filling in as I read.

## Section: Phase 0 — Convex bandwidth + storage

### Finding 1: Phase 0 gate contradicts the fallback sentence
**Severity:** MEDIUM
**Location:** `Phase 0 — Convex bandwidth + storage`, lines 65-84
**Issue:** The section says "Do NOT start Phase 1.4" until Phase 0 lands, then says "If Phase 0 stalls, Phase 1 still proceeds" and self-hosts the unoptimized I/O pattern.
**Why it matters:** Implementers can choose either interpretation. That creates a likely overnight split where Convex self-hosting work proceeds without the bandwidth baseline the rest of the plan assumes, and the smoke tests may pass while the VPS disk/egress profile is still bad.
**Suggested fix:** Make the gate explicit: either Phase 1.4 is blocked on all Phase 0 children, or it is allowed with a separate acceptance threshold for self-hosted disk growth and query egress. Put the chosen rule in the dependency graph and Wave 2 ordering.

### Finding 2: Bandwidth acceptance depends on dashboard metrics that may not exist after self-hosting
**Severity:** MEDIUM
**Location:** `Phase 0 — Convex bandwidth + storage`, lines 79-82
**Issue:** Close-out requires "per-function bandwidth metrics from Convex dashboard" and sustained egress evidence, but Phase 1 moves to self-hosted Convex where hosted dashboard metrics may not match or may not be available with the same fidelity.
**Why it matters:** The team can lose the only stated proof that Phase 0 worked before cutover, especially if the final verification happens against self-hosted Convex.
**Suggested fix:** Require a repo-local measurement script or log-based counter that works against both hosted and self-hosted Convex, and specify whether the 60-minute load window is measured before or after migration.

## Section: Phase 1 — Locked decisions

### Finding 3: "Big-bang migration" conflicts with disabling legacy only after smoke-tested
**Severity:** HIGH
**Location:** `Locked decisions`, line 91; `Phase 2 — Migration + smoke test`, lines 551-576
**Issue:** The locked decision says cut Caddy over once smoke-tested and decommission legacy after one full tick cycle. The Phase 2 checklist stops and disables legacy runner/ttyd before the compose bring-up instructions and before the smoke acceptance list.
**Why it matters:** If elders fail to start in containers after legacy services are disabled, the operator has no exact recovery path to restore active gameplay quickly.
**Suggested fix:** Reorder the runbook so compose stack and internal smoke happen first, then Caddy cutover, then one full tick cycle, then legacy disable/archive. Add exact rollback commands for re-enabling `clanworld-runner.service`, old ttyd units, old Caddy blocks, and old cloudflared routes.

### Finding 4: Network egress lockdown under-specifies Convex and RPC allowlisting
**Severity:** HIGH
**Location:** `Locked decisions`, line 100; `Phase 1.2`, lines 188-207
**Issue:** The plan says no egress except Claude API, then Phase 1.2 allows DNS plus internal Docker network. It does not define how the firewall distinguishes internal bridge traffic from external traffic, nor how it handles Docker DNS at `127.0.0.11`, HTTPS to `claude.ai`, npm installs, GitHub, or future Codex API.
**Why it matters:** A too-tight rule bricks Convex/RPC access or DNS; a too-loose rule silently allows arbitrary internet egress. Both failure modes can pass shallow curl tests.
**Suggested fix:** Specify the exact iptables policy, allowed CIDRs/interfaces, Docker DNS rule, and test matrix: Convex backend allowed, anvil allowed, dashboard denied from elders unless intended, Claude allowed, Google denied, GitHub/npm denied at runtime, and behavior after container restart.

### Finding 5: `run.sh` session detection assumes Claude project path encoding is stable
**Severity:** MEDIUM
**Location:** `Locked decisions`, line 101; `Phase 1.7`, lines 309-374
**Issue:** The plan relies on `compgen -G '$HOME/.claude/projects/<encoded-cwd>/sessions/*.jsonl'` and `claude --continue`, but does not define the `<encoded-cwd>` algorithm or verify that changing `HOME` and CWD inside a container preserves the same project identity.
**Why it matters:** Elders may start fresh sessions after every wipe/restart, or worse continue the wrong transcript if multiple workspaces encode similarly.
**Suggested fix:** Add an acceptance test that starts Claude once in `/workspace`, writes a marker, restarts the container, and proves `--continue` resumes the same session. Document the actual encoded path discovered in the container.

### Finding 6: `unfreeze` is required by runtime but absent from command schema
**Severity:** HIGH
**Location:** `Locked decisions`, line 97; `Phase 1.8`, lines 374-414; `Phase 1.9`, lines 415-451
**Issue:** The locked command verbs are `user_message`, `system_message`, `snapshot_request`, `reset`, `freeze`. Phase 1.9 says `freeze` stops processing until `kind=unfreeze` or runner restart, but `unfreeze` is not in the typed verb list or schema tests.
**Why it matters:** A frozen elder can become permanently unreachable through the command bus, and the only escape is an out-of-band restart that defeats the purpose of the bus.
**Suggested fix:** Add `unfreeze` as a first-class typed verb with tests, or define freeze as time-bounded with an explicit `frozenUntil` and a documented operator command to clear it.

## Section: Open items — A. Skills dir conflict

### Finding 7: Init-time `cp -rn` will never propagate fixed shared skills
**Severity:** MEDIUM
**Location:** `Open items — A`, lines 111-117; `Phase 1.6`, lines 255-308
**Issue:** Shared skills are copied with `cp -rn`, preserving existing files forever. The plan notes updates only propagate on restart, but `-n` means even restart does not update files that already exist.
**Why it matters:** A bad shared skill or permission policy can be fixed in git and still not reach any elder that already seeded its volume, producing divergent behavior between fresh and existing elders.
**Suggested fix:** Use a versioned seed manifest and copy/update only files still matching the previous shared hash, or provide a `make refresh-shared-base ELDER=N` target with backup and clear acceptance criteria.

## Section: Open items — B. Anvil-fork

### Finding 8: Persistent fork state plus pinned fork block creates drift between sessions
**Severity:** MEDIUM
**Location:** `Open items — B`, lines 119-124; `Phase 1.3`, lines 188-208
**Issue:** The anvil service persists state and resumes without re-forking, while the plan also treats the fork block as a stable Base Sepolia baseline. There is no rule for when to reset the fork or how to record which fork state a test used.
**Why it matters:** Dev sessions can accumulate local-only diamond cuts, heartbeats, balances, and events. A passing smoke test may depend on state that cannot exist on real Base Sepolia.
**Suggested fix:** Require the fork block, state file hash, and contract address to be printed in `make status`; add a reset-before-smoke step for release validation; document when persistent fork state is allowed.

### Finding 9: Heartbeat/keeper target can silently switch between fork and real chain
**Severity:** HIGH
**Location:** `Open items — B`, lines 119-124; `Phase 1.10`, lines 452-473; Appendix A lines 771-779
**Issue:** The heartbeat service uses `RPC_URL_PRIMARY=${RPC_URL_DEV:-http://anvil-fork:8545}` in dev and `${RPC_URL_DEV:-${RPC_URL_PRIMARY}}` in the sample compose. If `RPC_URL_DEV` is accidentally set in prod or absent in dev, the heartbeat can hit the wrong chain.
**Why it matters:** A prod heartbeat could advance the real diamond during a dev test, or a prod smoke could pass against anvil while the real chain is idle.
**Suggested fix:** Split variables by profile with no fallback across environments, e.g. `DEV_RPC_URL` required only under dev and `PROD_RPC_URL` required only under prod. At startup, log and assert chain ID, fork mode, contract address, and expected profile before sending any transaction.

## Section: Phase 1.4 — self-hosted Convex backend + dashboard

### Finding 10: Admin key persistence is named but not bootstrapped or rotated
**Severity:** HIGH
**Location:** `Phase 1.4`, lines 209-231; Appendix A lines 744-752
**Issue:** The plan says the admin key is persisted via env var and not auto-generated, but does not define how it is created, stored on the VPS, backed up, rotated, or recovered if `.env` is lost.
**Why it matters:** A missing or changed admin key can lock operators out of deploy/import/dashboard flows, and putting it in a copied `.env` creates a quiet secret-handling footgun.
**Suggested fix:** Add a one-time `make init-convex-admin-key` or runbook step that writes to the approved secret location, records backup instructions, and verifies restart with the same key. Include rotation and "lost key" behavior.

### Finding 11: Hosted-to-self-hosted data compatibility is assumed
**Severity:** HIGH
**Location:** `Phase 1.4`, lines 209-231; `Phase 1.13`, lines 531-548
**Issue:** The plan assumes `npx convex export` from hosted and `npx convex import --self-hosted` into the pinned backend will work, but does not pin the CLI version, backend commit compatibility, schema version, or import destructiveness.
**Why it matters:** The migration can fail after the legacy stack is touched, or worse import data into a schema that deploys but breaks queries at runtime.
**Suggested fix:** Add a rehearsal requirement against a throwaway self-hosted instance using the exact pinned backend/dashboard/CLI versions, with schema deploy before and after import and a documented destructive-import warning.

## Section: Phase 1.5 — Caddy container with subroute config

### Finding 12: WebSocket upgrade behavior for ttyd is not accepted
**Severity:** HIGH
**Location:** `Phase 1.5`, lines 232-254; `Phase 2 smoke`, lines 601-617
**Issue:** The Caddy acceptance only curls `/elder-1` and later says ttyd "loads". It does not verify WebSocket upgrade through cloudflared -> host Caddy TLS -> docker Caddy HTTP -> ttyd.
**Why it matters:** ttyd can return HTML while the terminal remains dead because WS upgrade headers, path stripping, or idle timeouts are wrong.
**Suggested fix:** Add a WebSocket smoke using `websocat` or Playwright that opens `/elder-1`, waits for terminal output, sends input, and observes tmux scrollback. Include host Caddy and docker Caddy timeout settings for long-running ttyd sessions.

### Finding 13: Container Caddy path stripping is undefined for `/elder-N`
**Severity:** MEDIUM
**Location:** `Phase 1.5`, lines 232-254
**Issue:** The plan says `/elder-N` routes to `elder-N:7681`, but does not state whether Caddy strips `/elder-N` before proxying or whether ttyd is configured to serve from that base path.
**Why it matters:** ttyd often expects assets and websocket endpoints at paths relative to its configured base. A plain reverse proxy can load the shell HTML and fail static assets or WS URLs.
**Suggested fix:** Specify either ttyd's base path option or Caddy `handle_path` behavior, then test `/elder-N`, `/elder-N/`, static assets, and the websocket URL.

### Finding 14: Basic auth for `/convex-admin` has no credential lifecycle
**Severity:** MEDIUM
**Location:** `Phase 1.5`, lines 232-254
**Issue:** The plan requires basic-auth on the Convex dashboard, but does not define where hashed credentials live, how they are generated, or whether they are in `.env`, a mounted secret file, or committed Caddyfile.
**Why it matters:** Teams commonly commit placeholder hashes, reuse weak credentials, or deploy a dashboard route without auth while wiring the path.
**Suggested fix:** Add `CONVEX_DASHBOARD_BASIC_AUTH_HASH` or a mounted Caddy secret file, generated by a documented command, and make Caddy fail closed if the value is missing.

### Finding 15: Host route uses only app subdomain despite decision wording saying root domain
**Severity:** LOW
**Location:** `Open items — D`, lines 126-132; `Phase 1.5`, lines 232-254
**Issue:** The decision says route only `${CLAN_WORLD_DOMAIN}` "i.e. clan-world.com", but the snippet routes `${TLD_APP_SUBDOMAIN}.${CLAN_WORLD_DOMAIN}` / `app.clan-world.com`.
**Why it matters:** It is easy to edit the wrong host Caddy server block during cutover, especially with root and app hostnames both present in this repo.
**Suggested fix:** Normalize the wording to "route only `app.${CLAN_WORLD_DOMAIN}`" unless the root domain is also intended.

## Section: Phase 1.6 — elder-N service template + per-elder volume mounts

### Finding 16: R/O file bind mounts into a named volume can fail if target parent is uninitialized
**Severity:** MEDIUM
**Location:** `Phase 1.6`, lines 255-308
**Issue:** The service mounts the entire named volume at `/home/elder/.claude` and then individual R/O files under the same path. The plan does not ensure `/home/elder/.claude` exists before Docker tries to mount files, nor does it address mount ordering and file-vs-directory creation behavior.
**Why it matters:** Docker can create missing bind source/target paths as directories or fail container start, especially on first boot when the named volume is empty.
**Suggested fix:** Prefer mounting shared files outside the volume and symlinking/copying them during entrypoint, or add an image-layer skeleton for `/home/elder/.claude` plus an explicit first-boot test from empty volumes.

### Finding 17: `settings.json` R/O overlay does not stop writes to sibling policy files
**Severity:** MEDIUM
**Location:** `Open items — E`, lines 133-134; `Phase 1.6`, lines 255-308
**Issue:** The plan prevents writes to `~/.claude/settings.json` but leaves the rest of `~/.claude` writable, including credentials, project sessions, plugins, MCP configs, and any new config files Claude Code may start honoring.
**Why it matters:** The stated goal is preventing Elders from self-modifying permission boundaries. A future or alternate local config file could bypass that guarantee while the acceptance still passes.
**Suggested fix:** Define an allowlist of writable paths under `~/.claude` and add a startup audit that fails if unexpected config files exist. Include a test where an elder attempts to create `settings.local.json` or MCP config and restart does not honor it.

### Finding 18: Committed generated compose file invites drift from template
**Severity:** LOW
**Location:** `Phase 1.6`, lines 286-295; `Phase 1.7`, lines 318-323
**Issue:** The plan commits both `docker-compose.elders.yml` and the generator/template, but acceptance only checks deterministic generation, not that the committed output is current.
**Why it matters:** Operators can run stale committed compose blocks that do not match the reviewed template.
**Suggested fix:** Add a CI check that runs `gen-compose.sh` and fails on `git diff --exit-code docker-compose.elders.yml`.

## Section: Phase 1.8 — Convex command-bus schema + tables

### Finding 19: Status model is inconsistent between schema and runtime
**Severity:** HIGH
**Location:** `Phase 1.8`, lines 374-414; `Phase 1.9`, lines 415-451
**Issue:** Phase 1.8 names `ackCommand`, `completeCommand`, and `failCommand`, but Phase 1.9 introduces `delivered` and a later heuristic `acked`. The lifecycle and legal transitions are not specified.
**Why it matters:** A command can be sent to tmux, marked delivered, never actually acted on, and sit forever if no transition timeout exists for delivered/acked states.
**Suggested fix:** Define the finite state machine (`queued -> leased -> delivered -> completed/failed`, or similar), transition owners, deadlines, retry behavior for each nonterminal state, and indexes supporting sweeps.

### Finding 20: Acked-but-not-completed can persist indefinitely
**Severity:** HIGH
**Location:** `Phase 1.8`, lines 374-414; `Phase 1.9`, lines 415-451
**Issue:** The sweeper only returns expired leases to queue. There is no sweep for commands that were delivered or acked but never completed because the Elder printed the marker then failed to submit an order/result.
**Why it matters:** Operators can see green delivery while the actual game action never happens; retries will not fire because the lease was already acknowledged.
**Suggested fix:** Add per-kind completion deadlines and sweep rules for `delivered`/`acked` states. For tick/order commands, require completion to include observed order submission or an explicit no-op decision.

### Finding 21: Broadcast fan-out lacks ordering and snapshot semantics
**Severity:** MEDIUM
**Location:** `Phase 1.8`, lines 374-414
**Issue:** Broadcast to `"*"` fans out to all known elders, but "known elders" is not defined: current heartbeat table, static config, or clan mapping. There is also no ordering rule relative to targeted commands already queued for an elder.
**Why it matters:** Cross-clan commands like freeze/reset/system prompts can arrive in different positions per elder, causing inconsistent world state or partial execution.
**Suggested fix:** Define broadcast expansion against a static configured elder list for v1, assign a shared `broadcastGroupId`, and include per-elder sequence numbers so broadcasts are ordered relative to existing queues.

### Finding 22: Public enqueue and heartbeat mutations are an auth boundary but auth is not specified
**Severity:** HIGH
**Location:** `Phase 1.8`, lines 374-414
**Issue:** `enqueueCommand` and `recordHeartbeat` are public mutations. The plan does not state how callers authenticate, authorize `targetAgentId`, or prevent an elder from enqueueing commands for a peer.
**Why it matters:** Any client with deployment access, or any compromised elder, can inject commands, forge liveness, or freeze/reset other elders.
**Suggested fix:** Add a command-bus auth model in v1: operator/admin secret or Convex auth for enqueue, per-elder shared secret for heartbeat/claim, and server-side validation that caller identity matches `elderId`.

### Finding 23: Retention can delete commands before late results are correlated
**Severity:** MEDIUM
**Location:** `Phase 1.8`, lines 374-414
**Issue:** Commands and results older than 7 days are deleted, but the plan does not define correlation constraints or whether incomplete commands are exempt.
**Why it matters:** A stuck or delayed command can lose the command row while a result remains or vice versa, making audit and recovery impossible.
**Suggested fix:** Retain incomplete commands until terminal state plus grace period, delete results only after their command is terminal, and add a dashboard/query for stuck nonterminal commands.

## Section: Phase 1.9 — elder-runtime supervisor

### Finding 24: Runner companion service may not share the tmux namespace
**Severity:** HIGH
**Location:** `Phase 1.6`, lines 255-308; `Phase 1.9`, lines 415-451
**Issue:** The plan runs ttyd/tmux in `elder-N` and the supervisor in a separate `runner-elder-N` companion service, then expects the runner to `tmux send-keys` into the elder container's tmux session. Separate containers do not share process namespaces or tmux sockets by default.
**Why it matters:** The runtime cannot actually send commands to the Elder unless the tmux socket is shared via a volume with compatible UID/GID and socket path, or the runner execs into the elder container.
**Suggested fix:** Either run the supervisor in the same container as tmux, share a dedicated tmux socket volume and set `TMUX_TMPDIR`, or use `docker exec` from a privileged host-side controller. Add an integration test proving the companion service can list and send to the target tmux session.

### Finding 25: `getQueuedFor` subscription plus `claimNext` can cause head-of-line blocking
**Severity:** MEDIUM
**Location:** `Phase 1.8`, lines 374-414; `Phase 1.9`, lines 415-451
**Issue:** The runtime subscribes to `getQueuedFor(elderId)` but claims "next" command separately. The plan does not define ordering, priority, or whether unclaimable/frozen commands block later urgent commands.
**Why it matters:** A stuck command can prevent reset/freeze from being processed, exactly when the operator needs recovery.
**Suggested fix:** Define query ordering and priority classes. Let operator control commands (`reset`, `freeze`, `unfreeze`) bypass normal FIFO or explicitly document FIFO with emergency out-of-band recovery.

### Finding 26: Marker-based ack heuristic is brittle and gameable
**Severity:** MEDIUM
**Location:** `Phase 1.9`, lines 415-451
**Issue:** Ack is detected by finding a marker line in tmux scrollback that "we ask the Elder to print". There is no unique nonce, scrollback retention setting, or protection against stale marker reuse.
**Why it matters:** The runner can mark the wrong command acked if an old marker remains in scrollback, or fail to ack if scrollback truncates.
**Suggested fix:** Inject a per-command nonce, require the exact nonce in the ack marker, set tmux history limits, and persist last consumed scrollback offset per elder.

### Finding 27: Heartbeat health is always green by construction
**Severity:** MEDIUM
**Location:** `Phase 1.9`, lines 415-451
**Issue:** The supervisor records `health=green` every 30s with `lastTickProcessed` from `tickClock`, but the plan does not require proving the Elder processed that tick or submitted orders.
**Why it matters:** The dashboard can show healthy runners while Elders are idle, unauthenticated, or failing Claude calls.
**Suggested fix:** Derive health from observable conditions: tmux session alive, last command completed within SLA, last tick ack/order result, Claude auth status, and Convex connectivity.

## Section: Phase 1.10 — heartbeat container + webhook turn-on

### Finding 28: Webhook payload contradicts the architecture decision in AGENTS.md
**Severity:** HIGH
**Location:** `Phase 1.10`, lines 452-473
**Issue:** The plan posts `{tick, txHash, blockNumber}` to the heartbeat webhook. The repo instructions say the validated webhook payload is minimal `{chain, engineAddress, txHash, firedAtTs, source}` with no `currentTick` because Convex re-derives from chain.
**Why it matters:** Implementing the plan as written can reintroduce the race the architecture decision avoided, and may conflict with the existing webhook contract.
**Suggested fix:** Align Phase 1.10 with the validated payload: include chain, engine address, tx hash, fired timestamp, and source; remove tick from the heartbeat caller payload unless the webhook contract has been intentionally changed.

### Finding 29: Heartbeat duplicate prevention is absent
**Severity:** HIGH
**Location:** `Phase 1.10`, lines 452-473; `Phase 2 cleanup`, lines 551-576
**Issue:** The plan removes legacy heartbeat cron in Phase 2, but does not require proving only one heartbeat caller is active before enabling the new heartbeat container.
**Why it matters:** Multiple heartbeat callers are described as safe elsewhere only if the contract enforces cadence, but operationally they can waste funds, produce confusing webhook races, and make tick timing nondeterministic.
**Suggested fix:** Add a preflight that lists legacy cron/systemd/process heartbeat callers, confirms `HEARTBEAT_CALLER_ENABLED` state, and verifies the new container is the only active caller for the selected chain/profile.

### Finding 30: HMAC validation is required but signing details are missing
**Severity:** MEDIUM
**Location:** `Phase 1.10`, lines 452-473
**Issue:** Acceptance says webhook signature validation works, but the scope only mentions posting with `WEBHOOK_SHARED_SECRET`; it does not specify header names, canonical body, timestamp/replay handling, or whether current webhook code expects HMAC vs shared-secret header.
**Why it matters:** The heartbeat container and Convex webhook can both be "implemented" but disagree on signature format, or accept replayed webhook calls.
**Suggested fix:** Specify the exact signing scheme and add a negative test for wrong secret, modified body, and stale timestamp.

## Section: Phase 1.11 — URL scheme renames + Android MAP_URL update

### Finding 31: Root-route swap can break existing deep links and landing links without redirects
**Severity:** MEDIUM
**Location:** `Phase 1.11`, lines 474-505
**Issue:** `/` changes from public map to cockpit and `/cockpit` disappears, but the plan only updates internal references. It does not add redirects or compatibility behavior.
**Why it matters:** Existing Android builds, saved browser links, landing links, and operator muscle memory can land on the wrong surface immediately after cutover.
**Suggested fix:** Add temporary redirects: `/cockpit -> /` and optionally a query/banner-free redirect from old map root if the public map had external users. At minimum, include a runbook step to update all public links before Caddy cutover.

### Finding 32: Android app path may not exist in active v3 workspace
**Severity:** MEDIUM
**Location:** `Phase 1.11`, lines 474-505
**Issue:** The plan touches `apps/clan-world-mobile/...`, but the top-level repo instructions list eight active workspace packages and say historical mobile-app hackathon material is archived, not active.
**Why it matters:** A PR can block on a missing or archived mobile path, or waste time updating code that is not in the active build.
**Suggested fix:** Verify whether the Android app is active in this repo before filing the issue. If archived, move Android updates to a follow-up or archive-only doc update and remove it from blocking acceptance.

## Section: Phase 1.12 — Makefile + .docker-mounts + dev/prod compose profiles

### Finding 33: `make up` uses dev profile by default, dangerous on the VPS
**Severity:** HIGH
**Location:** `Phase 1.12`, lines 506-530; Appendix B lines 816-833
**Issue:** The Makefile skeleton runs `docker compose --profile dev up -d` for `make up`. Phase 2 tells the operator to run `make up` on the VPS with real secrets.
**Why it matters:** The production-adjacent VPS can accidentally start an anvil fork and wire services to dev RPC while the operator believes they are cutting over production.
**Suggested fix:** Require `PROFILE=dev|prod` explicitly, or default to `prod` on the VPS with a loud confirmation for dev. Print selected profile, RPC URL, chain ID, contract address, and Convex URL before starting heartbeat.

### Finding 34: `.docker-mounts` symlink approach may expose Docker volume internals without permissions
**Severity:** LOW
**Location:** `Phase 1.12`, lines 506-530; Appendix B lines 829-833
**Issue:** `link-mounts` symlinks directly to Docker volume mountpoints. On many Docker installs those paths are root-owned under `/var/lib/docker`, unreadable to the normal user.
**Why it matters:** The inspectability feature can fail silently or encourage running file operations with sudo against Docker internals.
**Suggested fix:** Prefer `docker compose exec`/`docker cp` helpers or mount named volumes through a temporary helper container with the correct UID.

### Finding 35: Wipe target does not wipe all Claude state
**Severity:** MEDIUM
**Location:** `Phase 1.12`, lines 506-530; Appendix B lines 827-831
**Issue:** `wipe-%` removes `/home/elder/.claude/projects` and `/workspace/*`, but leaves credentials, skills, plugins, settings side files, logs, and possible command-bus cursors.
**Why it matters:** A "fresh CC harness state" acceptance can pass while stale auth/session/plugin state changes the Elder's behavior.
**Suggested fix:** Define wipe levels: soft workspace wipe, session wipe, and full volume reset. For "fresh harness state", recreate the `elder-N-home` and `elder-N-workspace` volumes from seed.

## Section: Phase 1.13 — Migration runbook

### Finding 36: Runbook acceptance is too subjective for a production-adjacent cutover
**Severity:** MEDIUM
**Location:** `Phase 1.13`, lines 531-548
**Issue:** Acceptance says "operator-friendly" and every step has indicators, but does not require a dry run, rollback drill, or command transcript.
**Why it matters:** The runbook can look complete in review and still fail when applied to the real VPS state.
**Suggested fix:** Require a recorded dry run on a throwaway path/ports, with exact command output snippets for success/failure and a rollback drill before Phase 2 approval.

## Section: Phase 2 — Migration + smoke test

### Finding 37: Cleanup runs before compose stack bring-up
**Severity:** HIGH
**Location:** `Phase 2 — Migration + smoke test`, lines 551-599
**Issue:** The first Phase 2 subsection stops/disables/removes legacy services and archives state. Only after that does the plan bring up compose.
**Why it matters:** This is the opposite of the locked parallel cutover strategy and creates avoidable downtime if compose build, secrets, Convex import, OAuth, Caddy, or heartbeat fails.
**Suggested fix:** Move cleanup to a final "decommission after green" section. Initial Phase 2 should bring up compose on alternate ports, import Convex, run internal smoke, switch Caddy, run external smoke, then disable legacy.

### Finding 38: Rollback after archiving legacy state is not exact
**Severity:** HIGH
**Location:** `Phase 2 cleanup`, lines 551-587; `Risks + rollback`, lines 662-713
**Issue:** The checklist moves `~/agents/elders` and `~/clan-world/elder-*`, removes the runner unit, disables ttyd units, edits Caddy, and changes tunnel routes. Rollback says "fall back via archive" or revert Caddy, but does not give commands to restore moved paths, systemd unit files, cron entries, ttyd units, or tunnel DNS.
**Why it matters:** If containers fail after partial cleanup, the operator must reconstruct legacy service state under pressure.
**Suggested fix:** Add an exact rollback block after every destructive step, including restore commands, `systemctl --user daemon-reload`, service starts, Caddy reload, and cloudflared route restoration.

### Finding 39: Smoke test does not prove Elders submit valid game orders
**Severity:** HIGH
**Location:** `Smoke test acceptance`, lines 601-617
**Issue:** Acceptance checks containers, heartbeat, command delivery, map, ttyd, egress, and scrollback "responding to ticks", but does not verify that each Elder submitted a valid order accepted by the chain/backend.
**Why it matters:** The demo can look alive while the core game loop is broken.
**Suggested fix:** Add acceptance that each Elder processes a tick, produces an order, the order is accepted by the relevant adapter/contract/backend, and the next world snapshot reflects the action or an explicit no-op.

### Finding 40: Pause/resume acceptance ignores lease expiry side effects
**Severity:** MEDIUM
**Location:** `Smoke test acceptance`, lines 601-617
**Issue:** The smoke pauses all runners for 60 seconds while the sweeper expires leases every 30 seconds. The plan does not specify expected command statuses after unpause.
**Why it matters:** Pause/resume can trigger duplicate delivery or retries for commands that were in-flight when paused.
**Suggested fix:** During pause/resume smoke, enqueue a command before pause and assert it is not double-delivered after unpause. Define whether pausing runners should also pause the sweeper or extend leases.

### Finding 41: `curl api.anthropic.com` success is not a valid Claude auth check
**Severity:** LOW
**Location:** `Phase 1.2 acceptance`, lines 188-207; `Smoke test acceptance`, lines 601-617
**Issue:** Curling `https://api.anthropic.com` may return a reachable HTTP response without proving Claude Code OAuth works or model requests can complete.
**Why it matters:** Network smoke can pass while every Elder fails at the first actual Claude call.
**Suggested fix:** Add a minimal non-game Claude Code prompt smoke per elder, or a CLI auth/status command if available, before declaring OAuth/network green.

## Section: Dependency + implementation order

### Finding 42: Wave ordering lets Caddy land before frontend service exists
**Severity:** MEDIUM
**Location:** `Dependency + implementation order`, lines 618-660; `Phase 1.5`, lines 232-254
**Issue:** Caddy is Wave 2 and may be accepted with 502 for frontend/elder routes. URL changes are also Wave 2, while elder services are Wave 3.
**Why it matters:** Multiple PRs can merge with known-broken routes, leaving the phase branch in a state where route failures are expected but indistinguishable from regressions.
**Suggested fix:** Gate Caddy acceptance on a stub frontend/upstream service or move route-level acceptance to the first wave where all upstreams exist. Track temporary 502s as explicit TODOs that must be closed before phase merge.

## Section: Risks + rollback

### Finding 43: Convex large-arg mitigation only covers command enqueue
**Severity:** MEDIUM
**Location:** `Risks + rollback`, lines 662-695
**Issue:** R1 guards `agentCommands.enqueueCommand` payloads over 100 KB, but the runtime also writes `snapshot_request` results containing `/workspace/ANCIENT_WISDOM.md` and tmux scrollback.
**Why it matters:** The same self-hosted Convex crash risk can be triggered by result writes, not just command args.
**Suggested fix:** Add size guards and truncation for `commandResults.resultPayload`, snapshot scrollback, ancient wisdom reads, and any existing mutation with large payload potential.

### Finding 44: OAuth bootstrap target is mentioned only in risk mitigation
**Severity:** HIGH
**Location:** `Risks + rollback`, lines 674-681
**Issue:** R2 depends on `make oauth-bootstrap-elder-N`, but Phase 1.12 does not include that target and Phase 1.6 only commits `.env.example` files.
**Why it matters:** The most likely high-impact auth risk has no implementation issue or acceptance criteria, so containers may start without usable credentials.
**Suggested fix:** Add OAuth bootstrap to Phase 1.12 scope and acceptance, including per-elder credential file creation, permissions, restart persistence, and a Claude auth smoke.

### Finding 45: Caddy rollback command is unsafe for `/etc/caddy/Caddyfile`
**Severity:** MEDIUM
**Location:** `Risks + rollback`, lines 682-688
**Issue:** Rollback says `git checkout HEAD~1 -- /etc/caddy/Caddyfile`, but `/etc/caddy/Caddyfile` is unlikely to be inside this repo's git history and may contain unrelated host changes.
**Why it matters:** The rollback command may fail or revert unrelated host config.
**Suggested fix:** Before editing host Caddy, copy a timestamped backup and validate it with `caddy validate`. Rollback should restore that exact backup and reload.

### Finding 46: Abort-mid-flight rollback ignores partial VPS changes
**Severity:** MEDIUM
**Location:** `Abort-mid-flight rollback`, lines 702-713
**Issue:** The section claims no VPS state changes in v1, but Phase 1 includes host Caddy snippets, cloudflared setup scripts, local Docker volumes, `.env` secrets, and possibly self-hosted Convex imports during rehearsal.
**Why it matters:** A mid-flight abort can leave exposed ports, stale tunnel routes, secret files, or Docker services running even if git branch rollback is clean.
**Suggested fix:** Add a cleanup checklist for Docker containers/volumes, Caddy snippets, tunnel routes, generated secrets, and Vercel/env changes.

## Section: Appendix A — sample docker-compose topology

### Finding 47: Compose sample lacks healthchecks despite health-based acceptance
**Severity:** MEDIUM
**Location:** Appendix A, lines 725-814; `Smoke test acceptance`, lines 601-617
**Issue:** Services use `restart: unless-stopped` and `depends_on`, but no healthchecks are shown for Convex, Caddy, heartbeat, elders, or runners. Acceptance expects containers in "healthy state".
**Why it matters:** `docker compose ps` can show running containers that are not ready or functional, and `depends_on` does not wait for application readiness without health conditions.
**Suggested fix:** Add healthchecks for backend, dashboard, Caddy, heartbeat last-success, ttyd, and runner heartbeat. Use `depends_on.condition: service_healthy` where startup order matters.

### Finding 48: Compose variable fallback syntax may not behave as intended
**Severity:** LOW
**Location:** Appendix A, lines 771-779
**Issue:** `RPC_URL_PRIMARY: ${RPC_URL_DEV:-${RPC_URL_PRIMARY}}` nests variable expansion inside a default. Compose interpolation support for nested expressions is easy to misread and can vary by implementation/version.
**Why it matters:** The heartbeat can receive a literal or empty value and fail only at runtime.
**Suggested fix:** Avoid nested interpolation. Compute profile-specific env in separate compose overlays or require a single explicit `HEARTBEAT_RPC_URL`.

## Overall verdict
NEEDS_REWRITE

The plan has several production-breaking gaps: the runner cannot reach tmux across containers as specified, Phase 2 disables legacy before proving containers work, heartbeat can hit the wrong chain, and the command bus lacks a complete state/auth/retry model. Do not merge this plan as an execution blueprint; rewrite the cutover order, command-bus semantics, auth/bootstrap, and Caddy/ttyd/heartbeat acceptance before dispatching implementation agents.
