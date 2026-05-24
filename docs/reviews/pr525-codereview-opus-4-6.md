# Phase Super-Swarm Review — PR #525 (head 44f72e4)

## SUMMARY

NEEDS_FIXES. Scope discipline is clean (no architectural drift, preserves v2.13 scheduler behavior), and the bundle interaction with #523/#526 is well-coordinated. Four MEDIUM findings cluster around container security posture and operational signal-handling, plus the now-familiar receipt-timeout-success healthcheck gap. Recommend addressing all four MEDs in a fix-round before merging into `dev-containerize-services`.

## HIGH severity findings

CLEAN — no findings.

## MEDIUM severity findings

- **MED-1:** `env_file: [.env]` is load-bearing for `RUNNER_PRIVATE_KEY` and `INDEXER_SECRET` but also leaks every unrelated secret (`DEPLOYER_PRIVATE_KEY`, `ELDER_MNEMONIC`, all elder/Anthropic API keys) into the heartbeat container's process environment. Least-privilege violation. Fix: drop `env_file: [.env]` and use explicit `environment:` allowlist with `${VAR:?required}` guards for the vars the heartbeat actually needs.
- **MED-2:** Healthcheck file (`/tmp/last-heartbeat-success`) is not written on the timeout-with-advanced-state success path in `heartbeatScheduler.ts:215-231`. When `waitForTransactionReceipt` times out but the chain has advanced, the scheduler treats it as success but `writeHeartbeatSuccessFile()` is never invoked → compose marks container unhealthy while heartbeat IS firing on schedule.
- **MED-3:** No PID-1 init process. `ENTRYPOINT entrypoint.sh` + `exec pnpm` makes pnpm PID 1. PID 1 ignores SIGTERM unless explicitly handled, and signal forwarding through `pnpm → tsx → node` is brittle. heartbeatLoopMain.ts shutdown handlers depend on signals reaching the Node process. Fix: add `init: true` to the compose service (uses Docker's bundled tini).
- **MED-4:** `CONVEX_WEBHOOK_URL` is compose-required (line 188 uses `${CONVEX_WEBHOOK_URL:?required}`), but `.env.template` leaves it commented out as optional. Operators following the documented `cp .env.template .env` flow will fail before container starts. Fix: provide a concrete dev default (`CONVEX_WEBHOOK_URL=http://convex-backend:3210`) or mark explicitly required in template.

## LOW severity findings

- Fragile `COPY package.json` allowlist in Dockerfile — future workspace additions will silently break `frozen-lockfile`.
- Container runs as root despite holding `RUNNER_PRIVATE_KEY`. Use `USER node` after copies.
- `pnpm install --frozen-lockfile` pulls all workspace deps for a single-package container. Image bloat.
- Healthcheck threshold (120s) is hardcoded. If `heartbeatIntervalSeconds()` is widened on-chain, container will flap.
- `WEBHOOK_SHARED_SECRET="$(cat ...)"` does not strip CR/LF — secret files with non-LF endings produce malformed Bearer tokens.
- No integration smoke test exercising "entrypoint validates env → runner writes success file → healthcheck reads it."

## Cross-cutting observations

1. Clean scope discipline — does NOT drift from the post-#503 SettleLatch lesson about preserving approved v2.13 behavior under cover of containerization. Matches Option C directive scope cleanly.
2. `restart: on-failure:5` (changed from `:0` in PR #408) is operationally correct softening — but README footnote correctly notes that plain compose does NOT restart on unhealthy, which is the load-bearing gap.
3. `touch .env.local` in the Dockerfile is a fragile hack to satisfy vite's optional .env.local read — works for now but accumulates.
4. Bundle interaction with PR #523 (SettleLatch removal) is clean — this PR depends on #523 landing first, which it did.
5. Prod-RPC reject list (`*anvil-fork*|*localhost*|*127.0.0.1*`) misses common loopback spellings (`0.0.0.0`, `[::1]`, `host.docker.internal`) but the chain-id assertion catches the real bug class.

---
*Note: this review was produced by the model but the model's Write tool was permission-denied repeatedly; orchestrator reformatted the output from the log file.*
