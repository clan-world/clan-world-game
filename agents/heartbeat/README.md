# Heartbeat Container

This container runs the existing TypeScript heartbeat loop:

```bash
pnpm --filter @clan-world/heartbeat heartbeat
```

It is intentionally not a shell heartbeat loop. The container preserves the
heartbeat package behavior: on-chain scheduling from `nextHeartbeatAtTs`,
`heartbeatIntervalSeconds()` observability, retry/backoff, best-effort Convex
`runnerStatus` writes, Telegram alerts, and the Convex webhook POST.

## Required Runtime Env

Compose passes an explicit heartbeat-only environment allowlist into the
container, and the entrypoint normalizes the profile-specific RPC values before
Node starts.

| Variable | Purpose |
|---|---|
| `CHAIN_NETWORK` | `dev` or `prod`; selects the RPC URL. |
| `DEV_RPC_URL` | RPC used when `CHAIN_NETWORK=dev`, normally `http://anvil-fork:8545`. |
| `PROD_RPC_URL` | RPC used when `CHAIN_NETWORK=prod`, normally `${RPC_URL_PRIMARY}`. |
| `RUNNER_PRIVATE_KEY` | Dedicated heartbeat wallet. Never reuse an Elder wallet. |
| `CLAN_WORLD_CONTRACT_ADDRESS` | Diamond address to call. |
| `CONVEX_URL` | Convex query/mutation base URL for `runnerStatus`. |
| `CONVEX_WEBHOOK_URL` | Explicit HTTP actions base URL for `/api/heartbeat-webhook`. |
| `INDEXER_SECRET` | Secret passed to Convex `runnerStatus.updateRunnerStatus`. |
| `WEBHOOK_SHARED_SECRET_FILE` | Docker secret file mounted at `/run/secrets/webhook-shared`. |
| `HEARTBEAT_HEALTH_THRESHOLD_S` | Max age for `/tmp/last-heartbeat-success`; defaults to `180`. |
| `RUNNER_ID` | Stable row id for `runnerStatus`, e.g. `heartbeat-dev`. |

The entrypoint exports the selected RPC URL as `RPC_URL_PRIMARY` because the
existing heartbeat process reads `RPC_URL_PRIMARY`, not `DEV_RPC_URL` or `PROD_RPC_URL`.
It also reads `WEBHOOK_SHARED_SECRET_FILE` and exports `WEBHOOK_SHARED_SECRET`
for the bearer-auth webhook contract.

## Preflight

Before starting Node, the entrypoint:

1. Validates `CHAIN_NETWORK`.
2. Selects the matching RPC URL.
3. Checks `cast chain-id` against Base Sepolia chain id `84532`.
4. Verifies `CLAN_WORLD_CONTRACT_ADDRESS` is set.

The dev anvil fork currently also reports chain id `84532`, matching the
compose `anvil-fork` service and viem's `baseSepolia` chain config.

## Healthcheck

The compose healthcheck reads `/tmp/last-heartbeat-success` (path configurable
via `HEARTBEAT_SUCCESS_FILE_OVERRIDE`). The heartbeat process writes the current Unix timestamp
there after either (a) a confirmed heartbeat transaction, OR (b) the
receipt-timeout recovery path when on-chain
`nextHeartbeatAtTs` is observed to have advanced (no confirmed receipt, no
webhook POST). The marker indicates the scheduler is making forward progress,
NOT that the most recent transaction was confirmed end-to-end. A timestamp
younger than `HEARTBEAT_HEALTH_THRESHOLD_S` seconds means the heartbeat caller
is making progress.

Keep `HEARTBEAT_HEALTH_THRESHOLD_S` wider than the on-chain
`heartbeatIntervalSeconds()` cadence plus restart/RPC slack. If the owner widens
the on-chain interval, update this threshold with it so the container does not
flap unhealthy between normal ticks.

This file proves heartbeat tx progress. Convex ingest can still fail
independently; webhook and `runnerStatus` failures are logged by the heartbeat process and
treated as non-fatal.

## Restart Policy

Compose uses `restart: on-failure:5`. Fatal process exits, such as missing
required env or a failed preflight, are retried up to five times and then left
visible for operator intervention. Plain Docker Compose does not restart a
container only because it is unhealthy, so stale healthchecks should still be
watched by external ops tooling or the Convex/dev UI status view.

## Smoke Tests

```bash
docker compose --profile dev config
docker build -f agents/heartbeat/Dockerfile -t test-build .
```
