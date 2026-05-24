# Phase Super-Swarm Review — PR #561 R2 (head 62efa1d) — opus-4-7

## SUMMARY

All three R1 fixes verified against the diff. No regressions found in the fix-round. Two new findings (1 MED, 1 LOW) outside the deferred bucket; both are pre-existing-style gaps surfaced now. Merge ready conditional on Liam accepting the new MED.

## R1 fixes verification

- **ackCommand+failCommand grace: VERIFIED.** `apps/server/convex/commandBus.ts:110` — old `cmd.leaseExpiresAt <= Date.now()` removed; new `cmd.leaseExpiresAt + COMPLETION_GRACE_MS <= Date.now()` with error `"Lease expired beyond grace — re-claim the command before acking"`. Symmetric change at `:165` for failCommand (`"… before failing"`). Test coverage at `apps/server/convex/commandBus.test.ts` adds within-grace (succeeds) + beyond-grace (throws) cases for both verbs using `vi.setSystemTime(361_000)` vs `395_000` against `leaseExpiresAt: 360_000`. `afterEach(() => vi.useRealTimers())` cleanup added — prevents fake-timer leakage into other tests.
- **Deny-list expansion: VERIFIED.** `agents/shared/home-claude/settings.json` includes all 6 new entries after `Bash(export *)`: `Bash(echo $*)`, `Bash(printf *)`, `Bash(compgen)`, `Bash(compgen *)`, `Bash(typeset)`, `Bash(typeset *)`. JSON valid.
- **Makefile --profile: VERIFIED.** `agents/Makefile:299` (`reset-%`), `:303` (`restart-%`), `:306` (`wipe-%`) all carry `check-profile` dep. `pause-heartbeat:` (`:293`) and `unpause-heartbeat:` (`:296`) also depend on `check-profile`. Mutating compose calls in those targets propagate `--profile $(PROFILE)`. `exec` calls remain unflagged per the prior Opus 4.7 L2 (exec is profile-agnostic).

## HIGH severity findings (NEW only)

None.

## MEDIUM severity findings (NEW only)

**`agents/shared/home-claude/settings.json` — absolute-path shell bypass survives the R1 deny-list expansion.** The deny patterns `Bash(sh -c *)`, `Bash(bash -c *)`, `Bash(zsh -c *)` match the literal command prefix only. An Elder invoking `Bash(/bin/sh -c "echo $TOKEN")` or `Bash(/usr/bin/python3 -c "import os; print(os.environ['CLAUDE_CODE_OAUTH_TOKEN'])")` does not match any deny pattern and would execute under `bypassPermissions`. Same gap for `Bash(/bin/bash -c …)`, `/usr/bin/perl`, `/usr/bin/node`, etc. The R1 expansion closed the shell-builtin gaps (`echo $*`, `compgen`, `typeset`) but did not anchor the interpreter prefix. Suggested fix: add `Bash(/*sh -c *)`, `Bash(/*python* -c *)`, `Bash(/*node -e *)`, `Bash(/*perl -[eE] *)`, `Bash(/*ruby -e *)`. Same applies to `Bash(cat /proc/*/environ)` — the existing deny is `Bash(cat //proc/*/environ)` (double-slash CC convention) so a single-slash literal `cat /proc/self/environ` may bypass.

## LOW severity findings (NEW only)

**`apps/server/convex/commandBus.ts:248` — sweep predicate vs ack/fail grace boundary is off-by-one at the exact 30s mark.** `sweepStaleDelivered` uses `.lt("leaseExpiresAt", sweepBefore)` (strict less-than) where `sweepBefore = now - COMPLETION_GRACE_MS`. The ack/complete/fail checks use `cmd.leaseExpiresAt + COMPLETION_GRACE_MS <= Date.now()` (≤). At the exact boundary (now − expiry = 30_000), ack/fail throws but sweep does not requeue. A 1ms window where the command is stuck. Self-healing on the next sweep tick. Not worth fixing on its own, but worth noting: change sweep to `.lte(...)` or change ack/fail to `<` for symmetric semantics. Self-resolves when Bundle 4 strips this code.

## DEFERRED-PER-BUNDLE-4

Carried over from R1 — listed for completeness, no action this round:
- Migration runbook coexist reorder.
- `bootstrap-bus-secrets` prod-URL guard (target writes to whatever `CONVEX_SELF_HOSTED_URL` points at without confirmation).
- Bracketed-paste prompt injection (pre-existing).
- TOCTOU `supervisor.lock` (pre-existing).
- Freeze persistence (pre-existing).
- `lastTickProcessed` semantics (pre-existing).
- Non-constant-time auth in `checkOperatorAuth`/`checkElderAuth` (pre-existing).

## Cross-cutting observations

- **`LEASE_MS` bumped 5 → 6 min** (line 1196 of diff). Not called out in the brief but is part of `62efa1d`. The `packages/elder-runtime/src/config.ts` comment was updated to reflect the new math (`360_000 + 30_000 − 240_000 = 150_000 ms` safety margin). Consistent.
- **`completeCommand` idempotency added.** New `if (cmd.status === "completed") return;` short-circuit lets any Elder with a valid secret silently re-call complete on an already-completed command. Minor authorization weakening (a probe leaks completion state to any authenticated Elder, not just the original leaseOwner). Acceptable for an internal command bus; tests cover the no-op path.
- **`claimNext` control-verb priority** is correct and well-tested (4 new cases). Two-query pattern (control kinds first, then fallback) runs inside a single Convex mutation, so the read-then-patch is transactional. No new race introduced.
- **ttyd `--writable` removed** (`agents/entrypoint.sh:42`). Self-consistent within this PR (operators drive via the Convex command bus). Note for the team: Bundle 4 plans to strip the command bus — after that lands, operators have no input path unless ttyd is re-enabled writable. Coordination concern for Bundle 4's PR, not this one.
- **Caddy `reverse_proxy` with `transport http { versions 1.1 }`** is sufficient for ttyd's WS upgrade in Caddy 2 (the directive auto-forwards `Connection`/`Upgrade`). No explicit `@ws_elder` matcher needed; the older plan snippet was over-specified.
- **`docker-compose.rehearsal.yml`** has a literal default `INSTANCE_SECRET=clan-world-rehearsal-local-only-change-before-use` so `docker compose config` parses. Runbook step requires `export CONVEX_REHEARSAL_INSTANCE_SECRET="$(openssl rand -hex 32)"` before bring-up — operator-trapped, acceptable.
