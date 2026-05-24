# Phase Super-Swarm R2 Synthesis — PR #525 (head 72e96fb)

**Models run:** Codex 5.3 ✓ | Codex 5.4 ✓ | Codex 5.5 ✓ | Opus 4.6 ✓ | Opus 4.7 ✓ | Gemini 3.1 Pro ✓ (full 6-model lineup, R2 verification round)
**PR:** feat(heartbeat): containerize @clan-world/runner heartbeat (Option C, #353)
**Target:** dev-containerize-services
**CI:** 5/5 SUCCESS on fix-round commit

## Summary

**Verdict: NEEDS_FIXES (minor, R3 dispatched)** — 5/6 reviewers report CLEAN/READY TO MERGE with all R1 MUST + SHOULD fixes verified LANDED. Gemini 3.1 Pro alone flagged 2 NEW HIGHs in the R1→R2 delta. Orchestrator verified both real against actual code. R3 fix-round dispatched.

## R1 fix verification — confirmed by all 6 reviewers

| R1 Finding | Status | Source |
|---|---|---|
| `USER node` directive in Dockerfile | ✅ LANDED | unanimous |
| `writeHeartbeatSuccessFile` on receipt-timeout-with-advanced-chain | ✅ LANDED | unanimous |
| Drop `env_file: [.env]` → explicit allowlist | ✅ LANDED | unanimous |
| `init: true` on compose service | ✅ LANDED | unanimous |
| `HEARTBEAT_HEALTH_THRESHOLD_S` env var threshold | ✅ LANDED | unanimous |
| New tests on success-file refresh | ✅ LANDED | unanimous (153 tests pass, +2 from R1) |

## R2 NEW HIGH findings (gemini single-model, orch-verified)

| File:line | Severity | Finding | Fix shape |
|---|---|---|---|
| `packages/runner/test/heartbeatScheduler.test.ts:14` + `runnerCastHeartbeat.test.ts:39` | HIGH | Both test files hardcode `const HEARTBEAT_SUCCESS_FILE = '/tmp/last-heartbeat-success'` and `rmSync` it in beforeEach. Vitest default pool runs files in parallel across workers → race → flake. **Verified**: grep confirmed both files reference the same path with rmSync. | Make runtime path configurable via `HEARTBEAT_SUCCESS_FILE_OVERRIDE` env. Tests use `mkdtempSync(join(tmpdir(), 'hb-test-'))` per-file isolation. |
| `docker-compose.yml` heartbeat depends_on + `agents/heartbeat/entrypoint.sh` | HIGH | heartbeat depends_on only `convex-backend`, NOT `anvil-fork`. Dev profile: anvil-fork takes 3-10s to warm up; heartbeat starts after convex healthy; cast chain-id preflight against anvil-fork fails; entrypoint aborts; container retries via `restart: on-failure:5` with NO backoff; dies within ~1 sec. The R1 softening from `:0` to `:5` made this race surface more. **Verified**: read docker-compose.yml, confirmed heartbeat depends_on missing anvil-fork, anvil-fork has no healthcheck defined. | Add retry loop in entrypoint.sh: `until cast chain-id ...; do sleep 2; done` with 30×2s grace. Handles both dev anvil warm-up and prod RPC transients. |

## R2 LOW findings (defer)

- `agents/heartbeat/entrypoint.sh:43` — `WEBHOOK_SHARED_SECRET="$(cat ...)"` doesn't strip CR/LF; Windows-line-ending secrets break Bearer auth (gemini). Defer to next round or future hardening.

## Cross-model overlap stats

- Flagged by all 6 models: R1 fixes all LANDED (universal verification)
- Single-model HIGH: 2 (both from gemini, both orch-verified real)
- Single-model LOW: 1 (gemini CRLF stripping)
- New HIGH from any of the 5 "CLEAN" reviewers: 0
- New MED from any reviewer: 0

## Per-model verdicts

- **Codex 5.3:** CLEAN — ready to merge
- **Codex 5.4:** CLEAN — ready to merge
- **Codex 5.5:** CLEAN — ready to merge
- **Opus 4.6:** CLEAN — ready to merge
- **Opus 4.7:** CLEAN — ready to merge
- **Gemini 3.1 Pro:** NEEDS_FIXES — 2 HIGH, 0 MED, 1 LOW

## Key observation

Gemini was the only reviewer that DEEPLY inspected the test files for parallel-execution safety AND the compose dependency graph for startup-order races. The other 5 reviewers verified the R1 punch-list landed but did not surface these new bug classes. This validates the cross-model diversity argument — different families catch different bug shapes. Per memory `feedback_super_swarm_cross_model_disagreement_resolution.md`, single-model findings get verified, not dismissed. Both gemini HIGHs were real.

## Action

R3 fix-round dispatched via codex 5-stage (xhigh reasoning). Will address both HIGHs in a small targeted commit. Estimated ~50 LOC across 3 files (2 test files + entrypoint.sh).
