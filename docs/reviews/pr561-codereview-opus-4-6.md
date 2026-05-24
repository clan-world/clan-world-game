# Phase Super-Swarm Review — PR #561 (head 2de51e1) — Claude Opus 4.6

## SUMMARY

**NEEDS_FIXES (non-blocking).** The Bundle 3 merge-order recovery PR is structurally sound: bootstrap-bus-secrets correctly wires BUS_OPERATOR_SECRET + BUS_ELDER_SECRET_N into self-hosted Convex, the dockerized Caddy routes to per-elder ttyd ports via HTTP/1.1 handle_path, the `--writable` flag is removed from ttyd (fixing the pre-existing cross-elder paste RCE surface), and the command-bus gets control-verb priority + a 30s completion grace window. Two operational bugs in `agents/Makefile` pattern rules (`reset-%`, `restart-%` missing `--profile`) and one grace-window asymmetry in `commandBus.ts` (`failCommand` lacks the grace that `completeCommand` now has) should be fixed in a follow-up. Merge is safe — none of the findings cause data loss or security regression.

## HIGH severity findings

### H1 — `failCommand` lease check lacks COMPLETION_GRACE_MS — asymmetric with `completeCommand` (NEW in this delta)

`apps/server/convex/commandBus.ts:165`: `completeCommand` (diff line 1105-1106) now uses `leaseExpiresAt + COMPLETION_GRACE_MS <= Date.now()`, and `sweepStaleDelivered` (diff line 1114) uses `sweepBefore = now - COMPLETION_GRACE_MS`. But `failCommand` at line 165 still uses the old `leaseExpiresAt <= Date.now()` with no grace. If a long-running command's nonce-wait timeout fires and the supervisor calls `failCommand` at lease-expiry + 15s, the call is rejected — but the same call via `completeCommand` would succeed. The supervisor would then get an unhandled error; the sweeper would eventually re-queue the command (it respects grace), but the elder's error log becomes noisy and the retry count doesn't increment. The `ackCommand` comment at line 111-114 also claims "Symmetric with completeCommand/failCommand" which is now false.

**Suggested fix:** Add `+ COMPLETION_GRACE_MS` to the `failCommand` lease check at line 165, and update the `ackCommand` comment to note that ack intentionally has no grace (it should happen immediately after claim). `ackCommand` not having grace is correct — if you haven't acked within 6 minutes, something is fundamentally wrong.

**Severity rationale:** HIGH because the supervisor's `failCommand` call after nonce timeout is the primary cleanup path for stuck commands. If it silently fails due to the missing grace, the command is orphaned until the sweeper runs (which does respect grace), creating a ~60s window where the command is in limbo. The system self-heals but the inconsistency can mask real issues in operator logs.

## MEDIUM severity findings

### M1 — `reset-%`, `restart-%`, `wipe-%` (workspace/session) targets don't pass `--profile` to `docker compose up`

`agents/Makefile:300-301` (`reset-%`): `$(DC) up -d --force-recreate $*` runs without `--profile $(PROFILE)`. All Elder services are profile-scoped (`profiles: [dev, prod]` in `docker-compose.yml:299`), so Docker Compose v2 will reject the command with "service elder-N is not enabled by any profile." Same issue in `restart-%` (line 303) and `wipe-%` workspace/session branches (which call `$(MAKE) reset-$*`). The `wipe-%` LEVEL=full branch uses `stop`/`rm` on existing containers and is likely OK.

**Suggested fix:** Add `check-profile` dependency to `reset-%` and `restart-%` targets and pass `--profile $(PROFILE)` to compose calls. The `wipe-%` target already needs PROFILE for the `reset-$*` sub-make call, so propagate it.

### M2 — Secret-exfil deny list gaps: `echo`, `printf`, `compgen` not blocked

`agents/shared/home-claude/settings.json:22-42` (NEW in this delta, PR #551): The 13 new deny entries cover `set`, `declare`, `export`, `node -e`, `python -c`, `bash -c`, etc. but miss:
- `Bash(echo *)` — an elder could run `echo $BUS_ELDER_SECRET_1`
- `Bash(printf *)` — `printf '%s\n' "$SECRET"`
- `Bash(compgen *)` — `compgen -v` enumerates all env var names

The primary defense is the **allow list** (`Bash(elder *)`, `Bash(date *)` are the only auto-approved commands), and in automated containers with no interactive user, non-allowed non-denied commands can't be approved. So these gaps are defense-in-depth holes, not primary-gate bypasses. Still, adding `Bash(echo *)`, `Bash(printf *)`, and `Bash(compgen *)` to the deny list would close the enumerated attack surface from the PR #560 review brief.

### M3 — `claimNext` control-verb priority does two separate Convex queries — no test for the fallback path

`apps/server/convex/commandBus.ts:84-98` (diff): The new `claimNext` first queries for control verbs, then falls back to any queued command. The test file covers the control-verb priority path (lines 729-875 of diff) but there is no explicit test for the fallback: "when no control verbs are queued, claims the oldest non-control command." The existing `claimNext` tests from before this PR implicitly cover this (they test `user_message` claims), but an explicit test documenting the two-query contract would prevent future regressions.

## LOW severity findings

### L1 — Rehearsal transcript pins Convex CLI 1.17.4 but agents/Makefile defaults to 1.39.1

`agents/Makefile:139` (`CONVEX_CLI_PINNED_VERSION ?= 1.39.1`) vs `docs/runbooks/dockerize-migration-v1-rehearsal-transcript.md:17` (`Convex CLI pin | 1.17.4`). The runbook correctly explains that operators must `export CONVEX_CLI_PINNED_VERSION=1.17.4` during migration, but the Makefile's `bootstrap-bus-secrets` target uses `convex@$(CONVEX_CLI_PINNED_VERSION)` which defaults to 1.39.1. This is correct for steady-state operation (post-migration), but an operator who runs `make -C agents bootstrap-bus-secrets` during the migration without the export would use 1.39.1, which may exhibit the issue #531 behavior. Not a bug — the runbook is clear — but a comment in the Makefile would help.

### L2 — `handle /map*` Caddy matcher is overly broad

`agents/shared/caddy.conf:65` (diff): `handle /map*` matches `/map`, `/map/`, `/mapper`, `/mapquest`, etc. Since both this matcher and the catch-all `handle` route to the same `CLAN_WORLD_WEB_UPSTREAM`, the behavior is identical — no wrong routing occurs. But `handle /map/*` or `handle /map` (exact) would be more precise and wouldn't mislead future readers.

### L3 — Bare-elder redirect uses 308; plan originally specified 301

`agents/shared/caddy.conf:31` (diff): `redir @bare_elder {path}/ 308` uses 308 (Permanent Redirect, preserves method) while the earlier plan text said 301. 308 is arguably more correct for preserving POST/PUT methods through the redirect, so this is a reasonable improvement — but the plan doc at `docs/plans/dockerize-elder-infra-v1.md` should be updated to match.

### L4 — `bootstrap-convex-dashboard-auth` generates SHA-512 crypt hash but comments say "No current compose/Caddy consumer reads this JSON"

`agents/Makefile:401-403` (diff): The comment correctly notes that Caddy would need a bcrypt hash from `caddy hash-password`, not SHA-512 crypt. The target generates a `convex-dashboard-auth.json` with `password_sha512crypt` that nothing currently consumes. This is dead code — tracked for future dashboard auth wiring. Fine for now, but should be cleaned up or wired in a follow-up.

## Cross-cutting observations

### ttyd `--writable` removal — FIX for pre-existing H2

`agents/entrypoint.sh:43` (diff line 477): This PR removes `--writable` from ttyd, fixing the cross-elder paste RCE surface flagged in PR #560's review (H2). The comment explains that operators use the Convex command bus instead. Verified: the entrypoint.sh on `dev` (base) still has `--writable`; this PR's delta removes it. **Fixed in this PR.**

### Pre-existing issues (unchanged, DEFER-FOR-FOLLOWUP)

All of the following were flagged in the PR #560 super-swarm and remain unchanged in this PR's delta:

- **Bracketed-paste prompt injection** in `packages/elder-runtime/src/tmuxSink.ts`: paste content not sanitized for `\x1b[201~`. Pre-existing.
- **TOCTOU race in supervisor.lock** (`packages/elder-runtime/src/main.ts:28-64`): Pre-existing.
- **Freeze gate in-memory only** — restart silently unfreezes: Pre-existing.
- **`lastTickProcessed` counts commands not ticks**: Pre-existing.
- **Non-constant-time auth comparison** in `checkOperatorAuth`/`checkElderAuth` (`apps/server/convex/commandBus.ts:8,17`): Uses `!==` instead of `timingSafeEqual`. Pre-existing, not modified by this PR.

### Integration assertions verified

1. **`bootstrap-bus-secrets` → Convex env wiring**: `agents/Makefile:385-396` generates secret files, then calls `npx convex env set BUS_OPERATOR_SECRET`, `BUS_ELDER_SECRET_1..4`, and `WEBHOOK_SHARED_SECRET` against the self-hosted Convex. This correctly matches the env var names in `commandBus.ts:8` (`BUS_OPERATOR_SECRET`) and `commandBus.ts:16` (`BUS_ELDER_SECRET_${m[1]}`). **Wiring verified.**

2. **Caddy → ttyd routing**: `agents/shared/caddy.conf` (diff) routes `handle_path /elder-N/*` to `elder-N:7681` with `transport http { versions 1.1 }`. The elder compose service definition exposes ttyd on internal port 7681 (not host-published). Caddy and elders share the `clan-world-internal` network. **Wiring verified.**

3. **LEASE_MS / nonceTimeoutMs / COMPLETION_GRACE_MS budget**: LEASE_MS = 6 min (360s), nonceTimeoutMs default = 4 min (240s), COMPLETION_GRACE_MS = 30s. Effective safety window = 360 + 30 - 240 = 150s (2.5 min). The comment in `packages/elder-runtime/src/config.ts:43-48` (diff) correctly documents this math. The supervisor's nonce timeout fires well before the sweep threshold. **Budget verified.**

4. **All documented Makefile targets are implemented**: `setup`, `up`, `down`, `status`, `logs`, `pause`/`unpause` (fan-out + per-elder), `pause-heartbeat`/`unpause-heartbeat`, `reset-elder-N`, `restart-elder-N`, `wipe-elder-N`, `reset-anvil`, `link-mounts`, `bootstrap-convex-admin-key`, `bootstrap-bus-secrets`, `bootstrap-convex-dashboard-auth`, `oauth-bootstrap` (fan-out + per-elder), `smoke-test`, `build`, `help`. **All present.** PROFILE handling is inconsistent on the pattern rules (see M1).

5. **Test coverage**: `commandBus.test.ts` adds 148+ lines of new tests covering control-verb priority (4 cases), completion grace window (2 cases), already-completed idempotency (2 cases), and sweep grace window (1 case). The mock query builder's `or()` method (diff line 719-721) is a correct approximation. Coverage is adequate for the new FSM transitions.
