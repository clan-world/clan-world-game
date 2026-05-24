# Phase Super-Swarm Review — PR #561 (head 2de51e1) — opus-4-7

## SUMMARY

**NEEDS_FIXES (minor)** — the bundle is operationally coherent and a clear ship for the hackathon track. The Caddy + command-bus + Makefile pieces wire together correctly with the Bundle 2 base that's already on `dev`. Three real issues to fix before / shortly after merge: (1) `agents/Makefile bootstrap-bus-secrets` defaults to a Convex URL that is unreachable under `PROFILE=prod` (host port not published for the backend service), (2) `ackCommand` and `failCommand` were not updated to honour the new `COMPLETION_GRACE_MS` window — they reject 1 ms past the lease while the sweeper waits 30 s, opening a 30 s "command stranded" gap, (3) a couple of dead/misleading operator artefacts (`bootstrap-convex-dashboard-auth`, the post-`wipe LEVEL=full` follow-up message). Two genuine wins to acknowledge: `--writable` removed from ttyd (addresses the PR #560 cross-elder paste concern) and the broader settings.json deny-list.

## HIGH severity findings

**CLEAN — no findings.**

(Strictly speaking the items below could be argued up to HIGH, but none of them corrupt data, break an invariant, or prevent the prod cutover from succeeding when the runbook is followed step-by-step. They land in MEDIUM.)

## MEDIUM severity findings

### M1 — `ackCommand`/`failCommand` ignore the new `COMPLETION_GRACE_MS` window — strands commands for 30 s

`apps/server/convex/commandBus.ts:110-115` (ackCommand) and `:165-167` (failCommand) still reject as soon as `leaseExpiresAt <= now`. Only `completeCommand` (`:151-152`) and `sweepStaleDelivered` (`:248-249, 253-254`) honour the new `COMPLETION_GRACE_MS = 30_000`. Concrete failure mode:

1. Supervisor claims at T=0, lease ends T=360 s.
2. At T=361 s the supervisor's `completeCommand` would succeed (within 30 s grace).
3. But if the supervisor instead calls `ackCommand` (re-ack after reconnect) or `failCommand` (gives up due to timeout) at T=361 s, both throw `Lease expired`.
4. Sweeper at T=361 s does NOT re-queue (still within 30 s grace).
5. Command sits in `leased`/`acked` with no actor able to touch it until T=391 s, then sweeper requeues with `retryCount + 1`.

The 30 s grace was added precisely to absorb supervisor↔Convex round-trip variance — that benefit is half-applied. Fix: apply the same `+ COMPLETION_GRACE_MS` to both `ackCommand` and `failCommand`. The test suite at `apps/server/convex/commandBus.test.ts` has no coverage of `failCommand` near the lease boundary either — add tests that exercise both inside and outside the 30 s grace window.

### M2 — `agents/Makefile:380-382` `bootstrap-bus-secrets` defaults to an unreachable Convex URL for `PROFILE=prod`

```make
export CONVEX_SELF_HOSTED_URL="$${CONVEX_SELF_HOSTED_URL:-http://127.0.0.1:$${CONVEX_BACKEND_HOST_PORT:-3210}}";
```

In `dev` profile, `convex-backend-dev-port` publishes the loopback port, so this default works. In `prod` profile, `convex-backend` has no host-side port (per the compose declarations carried in from Bundle 1) — the URL resolves to `http://127.0.0.1:3210` with nothing listening, so the `npx convex env set` calls silently fail to connect. The runbook (`docs/runbooks/dockerize-migration-v1.md` Step 5) DOES set `CONVEX_SELF_HOSTED_URL` first, so the documented path is safe — but the help text in `agents/Makefile:194-198` does not warn, and a user who runs `make -C agents setup PROFILE=prod` outside the runbook will get a confusing failure. Fix: in `bootstrap-bus-secrets`, add a `check-profile`-style guard that fails loud when `PROFILE=prod` and `CONVEX_SELF_HOSTED_URL` is unset, OR add a `prod-warning` blurb in the help block.

### M3 — `agents/shared/caddy.conf` has no auth on `/elder-N/` routes — fully reliant on Cloudflare Access

The 4 ttyd reverse-proxies (`agents/shared/caddy.conf:30-58`) have no basicauth, no JWT check, no IP allowlist. `--writable` is gone (good, `agents/entrypoint.sh:42-43`), so terminals are read-only, but anything that reaches `127.0.0.1:58731` sees all 4 elders' scrollback. Production safety hinges entirely on `app.clan-world.com` being behind Cloudflare Access, which is off-band config not enforced by this PR. If a future operator adds a second cloudflared ingress that bypasses Access, or if Access is misconfigured, the terminals are world-readable.

`agents/shared/README-caddy.md:14-17` documents the Cloudflare Access dependency, which is the right call for hackathon scope, but a defense-in-depth layer (a single Caddy basicauth on `@elder` paths, hash file mounted from `agents/secrets/`) would survive cloudflared misconfig. File a follow-up issue rather than block.

### M4 — `agents/Makefile:401-428` `bootstrap-convex-dashboard-auth` is dead code that ships in the help menu

The target's own comment at `:401-403` admits "No current compose/Caddy consumer reads this JSON." There is no `/convex-admin/` route in `agents/shared/caddy.conf`, and the dashboard service is internal-only on `prod` profile. The target prompts an operator for username + password, writes `agents/secrets/convex-dashboard-auth.json`, and that file is never consumed. It also computes a sha512crypt hash that Caddy basicauth would reject (Caddy wants bcrypt) — comment acknowledges this. Either wire the dashboard route up or delete the target and the help line at `:197`.

### M5 — `agents/Makefile:317-323` `wipe LEVEL=full` followup instruction is misleading

After full wipe, the recipe prints `[wipe] NEXT: run make oauth-bootstrap-$* BEFORE make up`. But `oauth-bootstrap-%` at `:433-457` skips when `agents/$*/.env` already exists (the host file, untouched by volume wipe) unless `FORCE=1` is passed. So the follow-up command as printed is a no-op. Either print `make oauth-bootstrap-elder-N FORCE=1`, OR clarify that the existing host-side OAuth token is still valid and oauth-bootstrap is only needed if the token has been rotated.

### M6 — `docker-compose.rehearsal.yml:18, 41` defaults to `:latest` tag while root compose pins SHA

`ghcr.io/get-convex/convex-backend:${CONVEX_BACKEND_TAG:-latest}` and `convex-dashboard:${CONVEX_DASHBOARD_TAG:-latest}`. The whole point of the rehearsal stack is to validate the cutover against the same Convex image that lands in prod. Defaulting to `:latest` means a rehearsal could pass on yesterday's image and prod could land on today's. Change the defaults to match the root compose's SHA pin, or require the env vars at `up` time (`${CONVEX_BACKEND_TAG:?set this to match prod compose pin}`).

### M7 — `agents/shared/home-claude/settings.json` deny-list still misses `compgen`

Per the brief's cross-cutting heads-up, verify `echo $VAR`, `set`, `declare -p`, `compgen -v`:

- `Bash(set)` + `Bash(set *)` — covered (`:27-28`) ✓
- `Bash(declare *)` — covered (`:29`) ✓
- `Bash(export)` + `Bash(export *)` — covered (`:30-31`) ✓
- `Bash(printenv)` — covered (pre-existing `:17-18`) ✓
- `echo $VAR` — not denied, but elder allowlist only permits `elder *` + `date` so `echo` would prompt; only matters if permission mode is `bypassPermissions`. Defense-in-depth nit.
- `Bash(compgen)` / `Bash(compgen *)` — **NOT covered**. `compgen -v` is a bash builtin that lists all variable names (including env). Add as defense-in-depth.

Also worth adding for the same family: `Bash(typeset *)` (synonym for declare), `Bash(getopts *)` if used in scripts that echo env.

## LOW severity findings

### L1 — `agents/shared/caddy.conf` omits explicit `@ws` matchers from the original plan

`docs/plans/dockerize-elder-infra-v1.md:299+` originally specified an `@ws_elder { header Connection *Upgrade* ... }` matcher. The implementation relies on Caddy 2's reverse_proxy being WebSocket-transparent by default, which works — but the plan/runbook divergence is worth a one-line note in `agents/shared/README-caddy.md`. Functionally equivalent.

### L2 — `agents/Makefile:298-301` `pause-elder-%` runs without `check-profile`

`docker compose exec` doesn't require `--profile`, so it works without PROFILE. But the help text at `:179-181` doesn't document this asymmetry vs. `up`/`setup`/`status`. Minor consistency nit.

### L3 — `agents/Makefile:271-285` pause uses `pgrep -f 'tsx.*elder-runtime/src/main.ts'`

The grep pattern depends on the supervisor being launched via `tsx`. If Phase 1 ever bundles to a compiled `main.js`, pause/unpause silently no-op. Document the pattern in a comment or move to a stable pidfile.

### L4 — `agents/Makefile:299, 302` `reset-%` and `restart-%` are pattern rules with no profile filter

`reset-anvil` is correctly carved out into its own non-pattern rule (`:328-336`) with profile guard. But `reset-foobar` would silently invoke `$(DC) up -d --force-recreate foobar`. Probably fine — `docker compose` would error on unknown service. Belt-and-suspenders: filter the pattern to known elder names.

### L5 — `docker-compose.rehearsal.yml` ports 38050-38052 not in `.world/ports.yml`

These are loopback-only and rehearsal-scoped; arguably out of band for the canonical port registry. Document the choice in `agents/Makefile` or `.world/ports.yml` comment so a future operator who collides won't be confused.

### L6 — Plan doc `docs/plans/dockerize-elder-infra-v1.md:1284-1295` shows partial Caddy snippet that no longer reflects implementation

The example `caddy:` service block in the plan still shows `volumes: [./agents/shared/caddy/Caddyfile, ...]` (wrong path) and `CONVEX_DASHBOARD_BASIC_AUTH_HASH_FILE` env (no longer wired). Plan/impl drift; file follow-up to align the plan with the shipped `agents/shared/caddy.conf` + compose service.

### L7 — Runbook step 8 + 9 `VITE_CONVEX_URL` cutover lacks a verification beyond browser-network inspection

`docs/runbooks/dockerize-migration-v1.md:2298-2308` says "open the live app, check browser network traffic." A scripted check (curl-based or playwright) would be a stronger gate. Nit for the hackathon scope.

### L8 — `docker-compose.rehearsal.yml:13` `INSTANCE_SECRET` fallback string is literal in compose

The fallback `clan-world-rehearsal-local-only-change-before-use` is committed and clearly marked, but operators sometimes pattern-copy. The rehearsal transcript template at `:8` does check the box for "fresh instance secret" — good. Consider making the fallback `${CONVEX_REHEARSAL_INSTANCE_SECRET:?run: export CONVEX_REHEARSAL_INSTANCE_SECRET=$(openssl rand -hex 32)}` so `docker compose up` fails loud instead of using the literal.

## Cross-cutting observations

### CC1 — Real security FIX: `--writable` removed from ttyd

`agents/entrypoint.sh:42-43` drops `--writable` from the ttyd command. This directly addresses the PR #560 super-swarm "ttyd --writable + bridge-network ACCEPT = cross-elder paste" finding. The comment correctly notes operators now drive elders via the Convex command bus instead of browser keystrokes. ✓

### CC2 — Pre-existing items from PR #560 super-swarm — unchanged by this PR's delta

The following are untouched in this diff and remain DEFER-FOR-FOLLOWUP:

- Bracketed-paste prompt injection in `packages/elder-runtime/src/tmuxSink.ts` — unchanged.
- TOCTOU race in `packages/elder-runtime/src/main.ts` supervisor.lock — unchanged.
- Freeze gate in-memory only (restart silently unfreezes) — unchanged.
- `lastTickProcessed` counts commands not ticks — unchanged (`apps/server/convex/commandBus.ts` heartbeat handler `:265-275`).
- Non-constant-time auth comparison in `apps/server/convex/commandBus.ts:8-10, 13-20` — `secret !== process.env.X`, still timing-sensitive. The LEASE_MS bump 5→6 min doesn't touch this.

### CC3 — Control-verb priority logic is correct but blocking-class semantics deserve a runbook line

`apps/server/convex/commandBus.ts:84-103` correctly prioritises `reset`/`freeze`/`unfreeze` over `user_message`/`system_message`/`snapshot_request`, AND correctly preserves FIFO within the control class (test at `commandBus.test.ts:332-372` confirms). One implication worth noting in the agents/README or runbook: if an operator enqueues a `freeze` command and the supervisor is paused (SIGSTOP), no subsequent `user_message` ever gets claimed until `unfreeze` lands and is processed. This is the desired behaviour, but not documented.

### CC4 — Caddy + cloudflared integration is end-to-end coherent

The `caddy.conf` `:80` listener + `127.0.0.1:${CADDY_HOST_PORT:-58731}:80` publish + `extra_hosts: host.docker.internal:host-gateway` + cloudflared ingress entry documented in both `agents/shared/README-caddy.md:18-65` and `docs/runbooks/dockerize-migration-v1.md:2219-2294` — all three references use the same port literal `58731` and the same Caddyfile path. Cross-referenced consistency: ✓.

### CC5 — `bootstrap-bus-secrets` actually pushes the matching secrets into Convex env

`agents/Makefile:358-399` writes to `agents/secrets/bus-operator.key`, `bus-elder-{1..4}.key`, `webhook-shared.key`, then runs `npx convex env set BUS_OPERATOR_SECRET`, `BUS_ELDER_SECRET_{1..4}`, `WEBHOOK_SHARED_SECRET` against the configured CONVEX deployment. Bundle 2's `apps/server/convex/commandBus.ts:8-20` reads exactly those env vars (`BUS_OPERATOR_SECRET`, `BUS_ELDER_SECRET_${N}`). Cross-bundle wiring asserted: ✓. (See M2 for the prod-default URL caveat.)

### CC6 — Phase 2 cutover has a clean rollback ladder

`docs/runbooks/dockerize-migration-v1.md` rollback sections per step are concrete and reversible: cloudflared backup → `cp` + restart, legacy runner mask → `systemctl enable --now`, web env → captured `VITE_CONVEX_URL` from Step 0. One sharp edge: Step 4 rollback ("Imported self-hosted data remains in `clan-world_convex_data` volume. Destructive recovery requires explicit Liam approval") is correctly cautious. No data-loss surfaces I can find.

### CC7 — Test coverage for `commandBus.test.ts` lease/grace boundaries

New tests cover:
- completeCommand: within 30s grace ✓, beyond grace ✓, already-completed no-op (2 variants) ✓
- sweepStaleDelivered: within grace (no sweep) ✓, beyond grace ✓
- claimNext control-verb priority: 4 scenarios ✓

Gaps:
- `ackCommand` near lease boundary — no tests (relates to M1).
- `failCommand` near lease boundary or with grace — no tests (relates to M1).
- `releaseLease` not exercised at all.
- Broadcast (`targetAgentId: "*"`) lifecycle including `broadcastSequence` ordering — no tests in this delta.

For hackathon scope these gaps are acceptable; file as a follow-up.
