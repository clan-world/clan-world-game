# Phase Super-Swarm Review — PR #525 R4 (head da14fbd)

## SUMMARY

CLEAN — ready to merge. Both R3 fixes landed correctly: `writeHeartbeatSuccessFile` resolves the env override at call-time via the default-parameter form, and the entrypoint RPC preflight retries up to 30 × 2s before failing loud. Tests use per-file `mkdtempSync` isolation + `vi.stubEnv`/`vi.unstubAllEnvs`, and Vitest's default `forks` pool gives per-test-file process isolation so env stubbing cannot race across files. No new HIGH/MED bugs introduced.

## R3 FIX VERIFICATION

| R3 Fix | Status | Notes |
|---|---|---|
| Test isolation (env override) | LANDED | `runnerCastHeartbeat.ts:259-263` reads `process.env['HEARTBEAT_SUCCESS_FILE_OVERRIDE']` in the default-arg expression — re-evaluated on every call. Both test files mkdtemp a unique dir, `vi.stubEnv` it, and `vi.unstubAllEnvs()` in `afterEach`. Atomic write (PID-suffixed tmp + rename) prevents partial reads from the healthcheck. |
| RPC retry loop | LANDED | `entrypoint.sh:209-218` retries `cast chain-id` until success or 30 attempts (60s budget), logs each attempt, fails loud after exhaustion. Handles cold anvil-fork startup. After loop exits, one more `cast chain-id` reads the actual id to compare against `EXPECTED_CHAIN_ID=84532`. |

Test assertion `toBe('100')` at `heartbeatScheduler.test.ts:428` is correct: fake timers freeze `Date.now()` at 100_000ms; the mocked `getNextHeartbeatAtTs`/`postRunnerStatus` await on microtasks only, so `Date.now()` does not advance before `writeHeartbeatSuccessFile()` runs.

## HIGH severity findings (new in R4)

None.

## MEDIUM severity findings (new in R4)

None.

## LOW severity findings (new in R4)

1. **EACCES test fragile under root** — `runnerCastHeartbeat.test.ts:507-523` chmods a dir to `0o500` and expects `writeHeartbeatSuccessFile` to log `EACCES`. Root bypasses POSIX perms, so this test would silently fail (warn never called) if a future CI runner ran as root. Add a `process.getuid?.() === 0` skip guard, or accept the risk (vitest rarely runs as root). Not a blocker.

2. **Retry loop swallows root cause** — `entrypoint.sh:211` does `>/dev/null 2>&1` for every retry, so the final `fail` message says "did not respond after 30 attempts" without surfacing the actual cast error (DNS, connection refused, TLS, etc). For ops debuggability, consider emitting the last error's stderr on exhaustion. Cosmetic.

3. **Double `cast chain-id` invocation** — After the retry loop exits successfully, a second `cast chain-id` runs (line 220) to capture the id. Tiny race: anvil could in theory restart between the two calls. Combine: capture stdout inside the loop and reuse. Cosmetic.

4. **`renameSync` failure path** — `runnerCastHeartbeat.ts:265-269` swallows both `writeFileSync` and `renameSync` errors via `console.warn`. If rename fails (e.g., cross-device EXDEV from a misconfigured tmpfs override), the PID-suffixed tmp file leaks. Not currently exploitable (default path is `/tmp` and the test cleans up its own tmp), but worth noting.

5. **Telegram alert env not wired** — `agents/heartbeat/README.md` mentions Telegram alerts as preserved behavior, but the compose `heartbeat` env block does not pass `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`. Alerts will silently no-op. Likely intentional for dev profile; flag for prod-profile follow-up.

6. **Healthcheck depends on env presence at exec time** — `docker-compose.yml:277` references `$$HEARTBEAT_HEALTH_THRESHOLD_S` inside the container shell. Compose sets the default `:-180`, so this is fine, but a future env-pruning change could regress. A literal default inside the test (e.g., `lt ${HEARTBEAT_HEALTH_THRESHOLD_S:-180}`) would be belt-and-suspenders.

## Cross-cutting observations

- The new dual call sites for `writeHeartbeatSuccessFile` (after `waitForTransactionReceipt` success AND after a receipt-timeout-but-state-advanced recovery) correctly avoid double-writes in the happy path — the second site only fires on the timeout-recovery branch where `callHeartbeat` already threw before its inline write.
- `.dockerignore` is comprehensive — node_modules, `.env*` (with whitelist for templates), agent secrets, runtime state. `COPY . .` in the Dockerfile is safe.
- `apps/kickstart-mobile` has no `package.json`, so its absence from the Dockerfile workspace-copy block is correct, not an oversight.
- Restart policy change `on-failure:0 → on-failure:5` is the right call now that the entrypoint handles transient anvil-fork startup via the retry loop; 5 retries × ~70s of preflight time ≈ ~6 min of self-recovery before going visibly stuck.
- `init: true` added — correct for PID 1 signal handling under `pnpm`-spawned children.

**CLEAN — ready to merge.**
