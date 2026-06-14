# Phase Super-Swarm Review — PR #532 (head 1ed8d60)

## SUMMARY

NEEDS_FIXES. The integrated phase regresses two load-bearing ops seams that earlier sub-PRs were explicitly trying to harden: the dev self-hosted Convex path no longer exposes any host-reachable endpoint even though the bootstrap/deploy flow still depends on one, and the heartbeat container healthcheck now watches a success file that nothing writes anymore. I would not merge until those are fixed, because both failures break the advertised containerized workflow on a fresh bring-up.

## HIGH severity findings

- `Makefile:34-35`, `docker-compose.yml:98-132`, `bin/deploy-convex.sh:18-29`, `bin/check-stack-health.sh:56-58`, `.env.template:214-221`, `docs/runbooks/self-hosted-convex.md:9-24,104-108` — the dev self-hosted Convex flow is broken end-to-end. `bootstrap-convex-admin-key` still tries to `up -d convex-backend-dev-port`, but this compose file no longer defines that service (nor `convex-dashboard-dev-port`). More importantly, every host-side tool still assumes a loopback-published backend at `http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT}`: `deploy-convex.sh` exports that as `CONVEX_SELF_HOSTED_URL`, `check-stack-health.sh` probes it, `.env.template` documents it, and the runbook tells operators this is the happy path. On a fresh dev bootstrap, `make bootstrap-convex-admin-key PROFILE=dev` now fails with “no such service”; if an operator comments that out, `make deploy-convex` still cannot reach the backend from the host because nothing publishes 3210/6791 anymore. Suggested fix: either restore the dev loopback proxy services, or convert the entire bootstrap/deploy/health/runbook path to use `docker compose exec`/internal networking instead of localhost and update the defaults/docs in lockstep.

- `docker-compose.yml:201-203`, `agents/heartbeat/README.md:51-65`, `packages/runner/src/runnerCastHeartbeat.ts:114-219`, `packages/runner/src/heartbeatScheduler.ts:182-231` — the heartbeat container healthcheck is now permanently decoupled from runtime success. Compose still marks health from `/tmp/last-heartbeat-success`, and the README still says the runner writes that file after successful heartbeats, but there is no write path anywhere in the runtime code anymore. Both success branches only confirm the tx, post the webhook, and/or write `runnerStatus`; none touches `/tmp/last-heartbeat-success`, including the timeout-with-advanced-state branch. Result: a healthy heartbeat loop becomes `unhealthy` after `start_period` even while it is advancing the chain correctly, which destroys the operator signal this containerization work was supposed to provide. Suggested fix: restore the success-file writer and call it at the scheduler success boundary for both direct receipt success and timeout-with-advanced-state, then add a regression test so this seam cannot silently disappear again.

## MEDIUM severity findings

- `docker-compose.yml:117-120`, `.env.template:228-230`, `bin/deploy-convex.sh:39-49` — the dashboard origin plumbing regressed into dead configuration. The deploy script now validates `CONVEX_DASHBOARD_DEPLOYMENT_URL` for prod, and `.env.template` tells operators to override it, but the compose service ignores that variable and hardcodes `NEXT_PUBLIC_DEPLOYMENT_URL: http://convex-backend:3210`. So prod validation can pass while the actual dashboard still advertises a Docker-internal hostname that browsers cannot resolve. This reopens the same browser-origin problem PR #526 was fixing. Suggested fix: wire `NEXT_PUBLIC_DEPLOYMENT_URL` back to `${CONVEX_DASHBOARD_DEPLOYMENT_URL}` (with the same prod fail-loud discipline), or delete the now-misleading env var + validation/docs if the dashboard is intentionally internal-only.

## LOW severity findings

CLEAN — no findings.

## Cross-cutting observations

SettleLatch removal itself looks mechanically complete in the current tree: the old latch files are gone, there are no live references left, and Cycle B now gates reset behavior through `waitForAckAndClear()` only. The bigger integration problem is regression containment: this phase reopens previously reviewed container/health/origin seams because the compose topology, scripts, and docs no longer move together. The missing success-file test coverage is especially notable here, because this exact heartbeat health seam had already been identified as load-bearing in prior review rounds.
```
