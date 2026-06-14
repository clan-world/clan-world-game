# Phase Super-Swarm Review — PR #525 (head 44f72e4)

## SUMMARY
NEEDS_FIXES. This PR successfully containerizes the heartbeat schedule loop but introduces two high-severity issues: a healthcheck logic hole that marks successful heartbeats as unhealthy, and a security regression where the container runs as root with access to all project secrets via `.env`. A medium-severity operational issue with fast-failing preflight checks also needs addressing before merge.

## HIGH severity findings

**1. Healthcheck file is not written on the timeout-with-advanced-state success path**
- **File:** `packages/runner/src/runnerCastHeartbeat.ts:143` and `packages/runner/src/heartbeatScheduler.ts:215`
- **Explanation:** `/tmp/last-heartbeat-success` is currently written only in the direct receipt-confirmed success path of `runnerCastHeartbeat.ts`. However, the scheduler gracefully handles transaction receipt timeouts where the chain state advanced anyway (treating them as successful). Because the success file isn't touched in this secondary success path, Docker Compose will incorrectly mark the container as unhealthy even when heartbeats are functioning normally and progressing the chain.
- **Suggested fix:** Remove `writeHeartbeatSuccessFile()` from `runnerCastHeartbeat.ts` entirely. Instead, invoke it at the scheduler boundary in `heartbeatScheduler.ts` inside `attemptHeartbeatWithBackoff` right before returning `{ success: true }` in both the direct success and the timeout-advanced success branches.

**2. Least-privilege violation and secret exposure via `env_file`**
- **File:** `docker-compose.yml:171` and `agents/heartbeat/Dockerfile`
- **Explanation:** Using `env_file: [.env]` injects every secret from the `.env` file (e.g., `DEPLOYER_PRIVATE_KEY`, all `ELDER_MNEMONIC`s, Anthropic tokens) directly into the heartbeat container's environment, vastly expanding its blast radius. Additionally, the Dockerfile builds and runs the Node process as the `root` user, which is unsafe when holding credentials like `RUNNER_PRIVATE_KEY`.
- **Suggested fix:** Drop `env_file: [.env]` from `docker-compose.yml` and explicitly define an allowlist in the `environment:` block for variables the heartbeat actually needs (using `${VAR:?required}` assertions). In the Dockerfile, add `USER node` after the `COPY . .` block to drop privileges before `ENTRYPOINT`.

## MEDIUM severity findings

**1. Immediate failure loop for preflight check**
- **File:** `agents/heartbeat/entrypoint.sh:56`
- **Explanation:** The `cast chain-id` preflight check exits immediately on failure. Docker Compose's `restart: on-failure:5` lacks backoff, so if the `CHAIN_NETWORK=dev` local `anvil-fork` takes a few seconds to start up and seed state, the heartbeat container will consume all 5 retries almost instantly and remain permanently dead on a fresh boot.
- **Suggested fix:** Add a short retry loop with backoff (e.g., retry 5-10 times with `sleep 2`) wrapping the `cast chain-id` command in `entrypoint.sh` to give the RPC endpoint time to become ready.

**2. Healthcheck threshold is tightly coupled to a 60s interval**
- **File:** `docker-compose.yml:206`
- **Explanation:** The compose healthcheck asserts that the success file is strictly younger than 120 seconds. Because `heartbeatIntervalSeconds` is fetched dynamically from the chain, if a deployer configures a longer interval on-chain (e.g., 5 minutes), the heartbeat container will be incorrectly marked unhealthy.
- **Suggested fix:** Document this constraint clearly in the README, or ideally, allow overriding the 120s threshold via an environment variable (`HEARTBEAT_HEALTH_THRESHOLD_S`) in `docker-compose.yml` so operators can tune it alongside on-chain changes.

**3. Hardcoded Chain ID coupling**
- **File:** `agents/heartbeat/entrypoint.sh:16`
- **Explanation:** The `EXPECTED_CHAIN_ID` is hardcoded to `84532` for both dev and prod profiles. If the production deployment migrates to Base Mainnet (8453) or if local dev uses a different fork, the container will persistently fail preflight without modifying the entrypoint script.
- **Suggested fix:** Accept an optional `EXPECTED_CHAIN_ID` environment variable in Docker Compose and default to `84532` if unset, decoupling the container logic from the deployed network.

## LOW severity findings

**1. Incomplete `.env.local` simulation**
- **File:** `agents/heartbeat/Dockerfile:36`
- **Explanation:** `RUN touch .env.local` runs in `/app`, and Node's `--env-file=../../.env.local` successfully finds this empty file. While this works because real environment variables override empty `.env` files, it's brittle.
- **Suggested fix:** Consider removing the `--env-file` argument in the runner package scripts for production builds, or passing an explicit environment variable to toggle this behavior at runtime instead of relying on touching a dummy file.

## Cross-cutting observations

- **Architectural adherence:** The PR successfully achieves containerization without reshaping the underlying runner package logic. Re-using the existing heartbeat TypeScript daemon prevents splitting state logic between a shell script and the real runner.
- **Integration testing:** The tests in `packages/runner/test/runnerCastHeartbeat.test.ts` currently do not verify the side-effect of `writeHeartbeatSuccessFile()` (or the `/tmp/last-heartbeat-success` touch). Refactoring the touch into the scheduler boundary will make it easier to inject a mock and explicitly test this critical operational integration seam.