# Phase Super-Swarm Review — PR #532 (head 1ed8d60)

## SUMMARY
NEEDS_FIXES. The core containerization and Convex self-hosting scaffolding are solidly built, and the scripts handle the migration paths cleanly. However, there is a critical architecture regression regarding state-machine synchronization (`SettleLatch` removal) that will cause the heartbeat caller to detach from the game state under load. Furthermore, two sensitive secrets were added as plain environment variables, contradicting the existing security pattern established in Finding 10. I recommend fixing the synchronization and secret handling before merging.

## HIGH severity findings

**1. Architectural / Timing Regression: Complete loss of backpressure without `SettleLatch`**
`packages/runner/src/heartbeatScheduler.ts:124` (and `tickLoop.ts`)
The complete removal of `SettleLatch` without an equivalent replacement breaks the fundamental synchronization between the on-chain pacemaker (Cycle A) and the off-chain game loop/indexer (Cycle B). The standalone heartbeat container now blindly polls `nextHeartbeatAtTs` and fires a transaction exactly when the interval elapses. If the Convex indexer lags, or if the Elders take longer than `heartbeatIntervalSeconds` to settle, the heartbeat will advance the on-chain tick prematurely. The heartbeat container will sprint ahead, burning gas, while the Elders are permanently left behind and submitting stale actions for previous ticks.
*Suggested fix:* Restore the standalone Convex `worldSnapshot.tick` polling latch (formerly `makeConvexSnapshotSettleLatch`) inside the heartbeat container. The heartbeat loop must query Convex and verify that the indexer has successfully processed the *previous* heartbeat's tick before it is allowed to send the next heartbeat transaction.

**2. Security: High-privilege secrets leaked to Docker config via plain environment variables**
`docker-compose.yml:206`
`RUNNER_PRIVATE_KEY` (an active hot wallet holding gas funds) and `INDEXER_SECRET` are passed to the heartbeat container as plain `environment` variables. As noted in your own security plan (Finding 10) regarding the `convex-admin-key`, environment variables are recorded in the container's config and leak to any process or user with host `docker inspect` access.
*Suggested fix:* Move both to the `secrets:` block (e.g., `RUNNER_PRIVATE_KEY_FILE` and `INDEXER_SECRET_FILE`). Update the `entrypoint.sh` script or `configFromEnv` to read the values from `/run/secrets/...` into memory at runtime rather than relying on Docker's environment injection.

## MEDIUM severity findings

**1. Configuration inconsistency: Compose healthcheck ignores operator override**
`docker-compose.yml:224`
The `heartbeat` service's healthcheck explicitly hardcodes the file path `/tmp/last-heartbeat-success` in its `CMD-SHELL` test. However, both `.env.template` and `writeHeartbeatSuccessFile()` support overriding this path via `HEARTBEAT_SUCCESS_FILE_OVERRIDE`. If an operator uses the override in `.env.local`, the container will write the timestamp to the new location, but the Docker healthcheck will perpetually check the hardcoded `/tmp/...` path and mark the container as unhealthy.
*Suggested fix:* Update the healthcheck command to evaluate the environment variable with a fallback: `test: ["CMD-SHELL", "test -f $${HEARTBEAT_SUCCESS_FILE_OVERRIDE:-/tmp/last-heartbeat-success} && ..."]`.

## LOW severity findings

**1. Assertions codifying buggy behavior**
`packages/runner/test/heartbeatScheduler.test.ts:437`
The test case `"keeps firing due heartbeats without waiting for Cycle B state"` codifies the exact timing regression identified in the HIGH findings. When restoring the backpressure synchronization, this test will need to be reverted or updated to assert the correct backpressure blocking behavior.

## Cross-cutting observations

- **Volume Mounts:** Moving `convex_data` from `/data` to `/convex/data` in `docker-compose.yml` aligns correctly with the official Convex backend image expectations, and Docker's named volumes will handle this transparently for the operator without data loss.
- **Runbooks:** The `backup-convex` and `import-convex-schema` wrappers are excellent. The fallback to cloud export if the local zip is absent during import provides a very robust cloud-to-self-hosted migration path.
- **Entrypoint validation:** The explicit newline/carriage return checks for the webhook secret in `entrypoint.sh` are thorough and proactively prevent frustrating silent HTTP auth failures.
- **Health Checks:** The use of `curl -f` with explicit timeouts and correct handling of 5xx HTTP codes in `check-stack-health.sh` is robust and resilient.EXIT=0
