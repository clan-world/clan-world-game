# Phase Super-Swarm Review — PR #525 R4 (head da14fbd)

## SUMMARY

**CLEAN — ready to merge.** Both R3 fixes land correctly: the env-var override is read at call-time (default parameter expression), and the entrypoint retry loop handles cold-anvil startup with a hard fail after 30 attempts. Tests use per-file `mkdtempSync` isolation with proper `vi.unstubAllEnvs` teardown. No new HIGH or MED findings.

## R3 FIX VERIFICATION

| R3 Fix | Status | Notes |
|---|---|---|
| Test isolation (env override) | LANDED | `writeHeartbeatSuccessFile` reads `process.env['HEARTBEAT_SUCCESS_FILE_OVERRIDE']` via default parameter — evaluated at call-time, not module-load-time. Both test files create isolated temp dirs via `mkdtempSync`, `vi.stubEnv` in `beforeEach`, `vi.unstubAllEnvs` in `afterEach`. Cleanup removes both the success file and the `.pid.tmp` staging file. |
| RPC retry loop | LANDED | `until cast chain-id ... >/dev/null 2>&1` loops up to 30 attempts with 2s sleep. Counter increments before the bounds check (`-ge`), so exactly 30 retries. Fails loud with `fail` (which calls `exit 1`). After the loop, a second `cast chain-id` call captures the actual value for chain-id validation — correct two-phase pattern (retry for availability, then assert correctness). |

## HIGH severity findings (new in R4)

None.

## MEDIUM severity findings (new in R4)

None.

## LOW severity findings (new in R4)

**L1: Retry loop suppresses stderr during wait.** The `until` loop redirects stderr to `/dev/null` (`>/dev/null 2>&1`), so transient RPC errors (TLS failures, DNS resolution, connection refused) are invisible in container logs during the wait phase. Operators see only the generic "RPC not ready" message. Not blocking — the post-loop `cast chain-id` call runs without suppression, so a persistent failure after the loop still surfaces the real error.

**L2: `heartbeatScheduler.ts` imports `writeHeartbeatSuccessFile` but the success-file call at line 231 sits inside the timeout-recovery branch only.** The primary happy path (no timeout) writes the file via `RunnerCastHeartbeat.callHeartbeat()` internally. This is correct — both code paths write the file — but the split call-sites could confuse future readers. Not a bug.

## Cross-cutting observations

- The atomic write pattern (`writeFileSync` to `.pid.tmp` then `renameSync`) is correct for the single-writer container model. `rename` is atomic on the same filesystem, which `/tmp` guarantees.
- `vi.setSystemTime(100_000)` in the scheduler test (line 349 of diff) ensures `Math.floor(Date.now() / 1000)` produces a deterministic `'100'` for the assertion. Correctly paired with the existing `vi.useFakeTimers()`.
- The EACCES test in `runnerCastHeartbeat.test.ts` properly restores dir permissions in a `finally` block — no leaked unwritable dirs on failure.

CLEAN — ready to merge.
