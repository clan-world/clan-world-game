# Convex Real Indexer

The real indexer is feature-flagged so the fake heartbeat path can stay in
place during production soak.

## Flags

- `CLANWORLD_USE_REAL_INDEXER=true` enables receipt decoding in the heartbeat
  webhook, the 3s log poller, the 60s fallback snapshot refresher, and the
  60s poller liveness watchdog.
- `CLANWORLD_USE_FAKE_HEARTBEAT=true` keeps the MUST-13 fake tick cron alive for
  demos and fallback environments.
- Do not enable both in production. They coexist only so migration and rollback
  do not require deleting code.

## Crons (under `CLANWORLD_USE_REAL_INDEXER=true`)

The real-indexer posture registers three Convex crons (defined in
`crons.ts`):

1. **`real-indexer-log-poller`** — every **3s**. Calls `internal.indexer.pollLogs`.
   - Stamps the singleton `pollerHealth` row via `markPollerInvoked` BEFORE
     any early-return, so a quiet chain (`shouldPoll === false`) doesn't look
     like a dead cron.
   - Decodes any new logs up to `latestConfirmedBlock - INDEXER_CONFIRMATION_DEPTH`,
     persists `chainEvents` + `eventCheckpoint`.
   - When `inserted > 0 && toBlock >= safeLatest` (i.e. AT chain tip), schedules
     `refreshSnapshot` immediately. During historical backfill (`toBlock < safeLatest`),
     the 60s fallback cron handles snapshot refreshes — avoids hammering the
     RPC with refreshes against stale block numbers.

2. **`real-indexer-snapshot-refresh-fallback`** — every **60s**. Calls
   `internal.indexer.refreshSnapshot` unconditionally.
   - Backstops transient RPC failures in the event-driven path.
   - Covers periodic snapshot updates during historical backfill, when the
     event-driven refresh is intentionally suppressed (see above).

3. **`real-indexer-poller-watchdog`** — every **60s**. Calls
   `internal.indexer.pollerWatchdog`.
   - Reads the `pollerHealth` singleton (NOT `eventCheckpoint`) so it can
     detect a stuck cold-start where `pollLogs` has never produced even one
     successful heartbeat.
   - Returns `stale: false` when `CLANWORLD_USE_REAL_INDEXER !== "true"` —
     environments that don't run the real indexer don't produce false alerts.
   - Returns `stale: true` with reason `"poller never ran"` when the
     `pollerHealth` row is missing — catches import-time crashes, misconfigured
     env vars, totally-dead cron at startup.
   - Returns `stale: true` with reason `"poller heartbeat aged out"` when
     `pollerLastInvokedAt > 90s old` — catches the running-but-stuck failure
     mode (the original concern).
   - Logs an `[indexer]` error on stale; downstream alerting hooks off the
     Convex logs.

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
  intra-tick latency, about 30s on Base Sepolia in the current posture.
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
