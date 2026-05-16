# Convex Real Indexer

The v1.0.1 indexer is feature-flagged so the fake heartbeat path can stay in
place during production soak.

## Flags

- `CLANWORLD_USE_REAL_INDEXER=true` enables receipt decoding in the heartbeat
  webhook, the 3s log poller, and the 60s fallback snapshot refresher.
- `CLANWORLD_USE_FAKE_HEARTBEAT=true` keeps the MUST-13 fake tick cron alive for
  demos and fallback environments.
- Do not enable both in production. They coexist only so migration and rollback
  do not require deleting code.

## Required Env

- `RPC_URL_PRIMARY`: RPC used by Convex actions for receipts, logs, and snapshot
  reads.
- `CLAN_WORLD_CONTRACT_ADDRESS`: engine address to read and filter logs.
- `CLAN_WORLD_LENS_ADDRESS`: deployed lens contract address for snapshot view
  reads.
- `WEBHOOK_SHARED_SECRET`: bearer token shared by the heartbeat loop and Convex
  webhook.
- `INDEXER_START_BLOCK`: optional cold-start log cursor. Set this to the
  contract deploy block for real deployments. If unset, the poller starts at
  `latestConfirmedBlock - 1000`.
- `INDEXER_CONFIRMATION_DEPTH`: optional block confirmation depth for log
  polling. Defaults to `5`.

## Reorg and Cutover Notes

- The log poller only indexes up to `latest - INDEXER_CONFIRMATION_DEPTH`.
  This avoids persisting events from short reorgs. The trade-off is extra
  intra-tick latency, about 30s on Base Sepolia in the current v1.0.1 posture.
- `worldSnapshot.regions` and `worldSnapshot.clans` are still parallel-written
  for the legacy frontend query. `clans` is backfilled from `clanView`; regions
  use the static 8-region spec list. v1.1+ can drop these fields after the
  frontend moves to direct projection-table queries.

## Migration Path

1. Deploy with both flags unset and verify existing fake paths still build.
2. Set `INDEXER_START_BLOCK` to the contract deploy block.
3. Set `CLANWORLD_USE_REAL_INDEXER=true` in the Convex deployment.
4. Verify heartbeat loop callers emit webhook payloads with `txHash` and
   `blockNumber`.
5. Let `chainEvents`, projection tables, and `eventCheckpoint` run for a while.
6. In v1.1+, remove fake tick code after production confidence is boring.
