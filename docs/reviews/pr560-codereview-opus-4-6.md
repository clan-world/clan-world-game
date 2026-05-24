# Phase Super-Swarm Review — PR #560 (head 09f78c8) — Opus 4.6

## SUMMARY

**CLEAN — no merge-blocking findings.** The v2.14 phase ships a coherent elder-containerization stack: self-hosted Convex backend, heartbeat container, 4 elder containers with tmux+ttyd+supervisor, command-bus schema, egress firewall, Makefile bootstrap, and SettleLatch removal. Cross-bundle integration seams are tight — schema/runtime/compose/firewall all align. Five MEDIUM findings remain (most pre-existing or accepted-by-design); none warrant blocking a hackathon merge. Recommend merge after Liam UAT.

## HIGH severity findings

CLEAN — no findings.

## MEDIUM severity findings

**M1 — Auth uses non-constant-time string comparison (pre-existing).**
`apps/server/convex/commandBus.ts:8,17` — `checkOperatorAuth` and `checkElderAuth` both use `!==` for secret comparison. `apps/server/convex/heartbeat.ts:127` — webhook auth does the same. Timing side-channel leaks prefix/length information. Already flagged as M2 in the PR #532 review by Opus 4.7 and never fixed. Practical risk is low with high-entropy secrets behind Convex's HTTP action layer, but the pattern is shipping to `main` for the third PR in a row. Fix: `crypto.timingSafeEqual` after normalizing both buffers to equal length, or HMAC both sides and compare hashes.

**M2 — No payload size guard on `enqueueCommand`.**
`apps/server/convex/commandBus.ts:32` — `payload: v.any()` accepts arbitrary JSON with no size or depth limit. An operator-secret holder (or a compromised orchestrator) could insert multi-MB payloads that exhaust Convex document storage. Convex itself enforces a ~1 MB argument limit, but repeated large inserts could bloat the `agentCommands` table. Fix: replace `v.any()` with a structured union or add an explicit byte-length check on `JSON.stringify(args.payload)`.

**M3 — CC permission deny-list has env-var exfiltration gaps.**
`agents/shared/home-claude/settings.json:15-21` — Deny rules block `env`, `printenv`, and `cat /proc/*/environ`, but don't cover `set`, `declare -p`, `echo $VAR`, or `compgen -v`. The allow-list (`Bash(elder *)`, `Bash(date)`, `Bash(date *)`) acts as a whitelist IF CC treats unmatched Bash commands as denied in headless/autonomous mode. If CC's default is to auto-allow or prompt (and the prompt is auto-accepted), the deny-list alone is insufficient to prevent `BUS_ELDER_SECRET_*` exfiltration via shell variable expansion. Verify CC's headless permission default, or add explicit deny rules for `Bash(echo *)`, `Bash(set)`, `Bash(declare *)`, `Bash(compgen *)`.

**M4 — ConvexHttpClient has no retry or backoff.**
`packages/elder-runtime/src/convexClient.ts` — Every Convex call goes through a 15s timeout wrapper but has zero retry logic. A transient Convex outage (network blip, container restart) fails the current command immediately and increments `consecutiveErrors` in the main loop. The backend's lease-expiry sweep (60s cron) will eventually re-queue, but the elder loses 5+ minutes of work. Fix: add 1-2 retries with jitter for transient HTTP errors (5xx, ECONNREFUSED, timeout) in `withTimeout()`.

**M5 — Firewall DNS resolution is one-shot (accepted by design).**
`agents/init-firewall.sh:115` — `getent ahostsv4` resolves allowlisted hostnames (api.anthropic.com, claude.ai, sentry.io, etc.) once at container init. IP rotations during the container's lifetime silently break egress or (if old IPs are reassigned) route traffic to unintended hosts. The design doc accepts this tradeoff. For long-lived containers (days+), consider a periodic re-resolve cron or `ipset` with TTL-based refresh.

## LOW severity findings

**L1 — `sendKeys` passes unnecessary trailing empty string.**
`packages/elder-runtime/src/tmuxSink.ts:14` — `execFileAsync("tmux", ["send-keys", "-t", this.session, key, ""])`. The trailing `""` is a no-op (tmux treats an unrecognized empty string as zero characters to send), but it's noise in the argument list and could confuse future maintainers. Remove it.

**L2 — No integration test for supervisor → tmux dispatch chain.**
The full path — `claimNext` → `ackCommand` → `loadBuffer` → `pasteBuffer` → nonce poll → `completeCommand` — is the highest-risk flow in the release and has zero automated test coverage. The `userMessage.test.ts` stubs TmuxSink entirely. Per hackathon rules, this is defer-OK, but file an issue for post-hackathon coverage of the nonce-poll happy path and timeout path against a real tmux session.

**L3 — Plan doc says `acked` status was "REMOVED" but implementation retains it.**
`docs/plans/dockerize-v1-revision-notes.md` mentions removing the `acked` state, but the shipping schema (`packages/sdk/convex/schema.ts`) and FSM (`commandBus.ts:117`) correctly include it. The implementation is right — `acked` is load-bearing for the freeze-before-ack gate and the lease-expiry sweep. The plan doc is stale. Update the revision notes to reflect the final design.

**L4 — `pasteBuffer` target parameter is `config.elderId`, not `this.session`.**
`packages/elder-runtime/src/commandHandlers/userMessage.ts:36` — Calls `tmux.pasteBuffer("elder-input", config.elderId, ...)` where the target is `config.elderId` (e.g. `"elder-1"`). Meanwhile `sendKeys` uses `this.session`. These are guaranteed equal today (`SESSION_NAME=${ELDER_ID}` in `entrypoint.sh:12`), but the asymmetry is fragile. Use `this.session` consistently, or accept a single `config.elderId` at construction time.

**L5 — `broadcastSequence` field is `undefined` for non-broadcast commands.**
`apps/server/convex/commandBus.ts:74` — Non-broadcast inserts set `broadcastSequence` to `undefined` (from the outer `let` declaration). Convex stores `undefined` fields, but the `by_broadcast_sequence` index will include these rows. Not a bug (the index still works), but consider omitting the field entirely for non-broadcast inserts to keep the index clean.

## Cross-cutting observations

**1. Phase delivers on its architecture promise.** The shipping surface matches "elders running in containers with centralized command bus": Convex-backed FSM with leased claims, Node supervisor polling + tmux dispatch, per-elder secrets via Docker file-secrets, egress firewall, atomic heartbeat success file for Docker healthcheck. No architectural drift detected.

**2. SettleLatch removal is complete and clean.** Zero source-code references remain. Runner's Cycle A no longer blocks on Cycle B. The only remaining mentions are in archival docs (CHANGELOG, revision notes) which correctly describe the removal decision.

**3. URL scheme rename (cockpit→root) is complete.** Legacy `/cockpit` paths redirect to `/` with query params preserved. The "cockpit" string survives only as a UI component namespace (`components/cockpit/`) and the external DNS name `cockpit.clan-world.com` (Caddy reverse proxy) — both intentional.

**4. Cross-bundle type safety is maintained by design.** Elder-runtime uses `ConvexHttpClient` (string-path API calls), not Convex codegen types, so there's no cross-package codegen dependency to break. The command-bus schema is the single source of truth; runtime and backend agree on the FSM states and field shapes.

**5. Heartbeat webhook secret validation is thorough.** `agents/heartbeat/entrypoint.sh:46-68` detects embedded LF (byte-count comparison) and CR (case pattern match), strips trailing whitespace, and rejects empty secrets. This is defense-in-depth against copy-paste errors that previously caused silent HMAC failures.

**6. Deploy-convex.sh validation is well-hardened.** `is_local_origin()` handles scheme normalization, userinfo stripping, IPv6 loopback, trailing-dot DNS, and path/query/fragment termination. `require_pinned_convex_tags()` rejects mutable tags (latest, main, edge, etc.) for prod deploys. No bypass vectors found.

**7. Timing-safe auth is now the oldest open security debt item.** It was flagged in PR #532 (Bundle 1), survived Bundle 2 and Bundle 3 fix rounds, and is now shipping to `main`. Consider fixing it in v2.15 to close the loop before any prod deployment.
