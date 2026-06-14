# Heartbeat runner — operations

**BLUF:** The heartbeat runner (`packages/heartbeat`, container
`clan-world-heartbeat-1`) is the **only** thing that advances the world clock. It
calls `heartbeat()` on the diamond every **30 seconds** (the on-chain,
owner-settable `heartbeatIntervalSeconds()`), seeding each tick's randomness. If
it stops, the game freezes. This doc is the canonical heartbeat operations
reference — it consolidates the old `packages/heartbeat/README.md` and
`agents/heartbeat/README.md`.

> **It is not an external keeper.** The retired sponsor keeper integration is
> gone; the live tick driver is this dockerized TypeScript runner.

## What it does

```
loop:
  read getWorldState().nextHeartbeatAtTs
  wait until now >= nextHeartbeatAtTs + safety margin (1500 ms)
  call heartbeat()        (dedicated runner wallet, viem writeContract)
  on confirm: write /tmp/last-heartbeat-success, best-effort Convex runnerStatus + webhook POST
  sleep until the next beat
```

The runner satisfies the seam interfaces from `@clan-world/agents/seams`:
`IHeartbeatCaller` (`RunnerCastHeartbeat`), and — in the legacy combined runner —
`IRunnerInbox` (tmux), `IElderMemoryStore` (`FileMemoryStore`), `IElderPeerInbox`
(`FilePeerInbox`). The per-tick elder driver now lives in the Convex pipeline;
the dockerized heartbeat container's job is the on-chain `heartbeat()` itself.

## Configuration (container env)

| Variable | Purpose |
|---|---|
| `CHAIN_NETWORK` | `dev` or `prod`; selects the RPC URL. |
| `DEV_RPC_URL` | RPC when `CHAIN_NETWORK=dev` — normally `http://anvil-fork:8545`. |
| `PROD_RPC_URL` | RPC when `CHAIN_NETWORK=prod` — normally `${RPC_URL_PRIMARY}`. |
| `RUNNER_PRIVATE_KEY` | Dedicated heartbeat wallet. **Never reuse an elder wallet.** |
| `CLAN_WORLD_CONTRACT_ADDRESS` | Diamond address (`0x098fa5c2…7af1`). |
| `CONVEX_URL` / `CONVEX_WEBHOOK_URL` | Convex base + HTTP-actions base for `runnerStatus` / `/api/heartbeat-webhook`. |
| `INDEXER_SECRET` | Secret for the Convex `runnerStatus` write. |
| `HEARTBEAT_HEALTH_THRESHOLD_S` | Max age of `/tmp/last-heartbeat-success` for the healthcheck. Default `180`. |
| `RUNNER_ID` | Stable `runnerStatus` row id, e.g. `heartbeat-dev`. |

The entrypoint validates `CHAIN_NETWORK`, selects the RPC, exports it as
`RPC_URL_PRIMARY` (the process reads that name), checks `cast chain-id` against
`84532`, and verifies the contract address is set before starting Node.

## Changing the interval

The interval is owner-settable on-chain; the runner reads
`heartbeatIntervalSeconds()` once at boot.

```bash
# As the diamond owner, on HeartbeatConfigFacet:
cast send "$DIAMOND" 'setHeartbeatIntervalSeconds(uint64)' 30 --private-key <owner-key> --rpc-url <rpc>
```

Then **restart the runner** so it re-reads the new value, and **widen
`HEARTBEAT_HEALTH_THRESHOLD_S`** to stay above the new interval + restart/RPC
slack (otherwise the container flaps unhealthy between normal ticks).

> Do not confuse `heartbeatIntervalSeconds()` (the tick clock, 30s) with
> `clansmanCooldownSeconds()` (the per-clansman submission throttle, 60s). They
> are independent levers on `HeartbeatConfigFacet`.

## Healthcheck interpretation

The compose healthcheck reads `/tmp/last-heartbeat-success`. The runner writes
the current Unix timestamp there after either (a) a confirmed `heartbeat()` tx,
or (b) the receipt-timeout recovery path when on-chain `nextHeartbeatAtTs` is
observed to have advanced. So a fresh marker proves **forward progress**, not
that the last tx confirmed end-to-end. Convex ingest can still fail
independently; webhook / `runnerStatus` failures are logged and non-fatal.

Plain Docker Compose does **not** restart a container just because it's
unhealthy — a stale healthcheck must be watched by external ops tooling (or the
Convex / dev-UI status view). Compose uses `restart: on-failure:5` for hard
process exits (missing env, failed preflight).

## Failure modes

### Runner out of gas → empty `0x` revert → frozen game (#652, the big one)

**Symptom:** heartbeat container unhealthy, **no ticks landing**, game frozen.
The `heartbeat()` tx reverts with **empty `0x` data**, yet an `eth_call`
simulation of the same call **succeeds**.

**Diagnosis:** sim-succeeds + tx-reverts-empty == **insufficient funds**. Check
the runner balance FIRST, before any contract/timing/gas-estimation theory:

```bash
docker exec clan-world-anvil-fork-1 cast balance 0xBC34eB46EF3Ad429C3Bcef049dc8ccca6f786cc7 --ether --rpc-url http://localhost:8545
```

**Fix (fork):** top the runner back up (and make it a permanent fork-bootstrap
step):

```bash
docker exec clan-world-anvil-fork-1 cast rpc anvil_setBalance \
  0xBC34eB46EF3Ad429C3Bcef049dc8ccca6f786cc7 0x3635C9ADC5DEA00000 \
  --rpc-url http://localhost:8545     # 1000 ETH
```

On Base Sepolia, fund the runner with real testnet ETH. Each beat burns
~0.0017 ETH, so fund durably.

**What drained it:** a revert flood. Every reverted tx still burns gas, so a
hot-loop of reverts (below) self-harms by emptying the sender wallet — escalating
a cosmetic flapping bug into a hard freeze.

### Fork hot-loop (`rate-limited; retrying after 0ms`)

**Symptom:** dozens of `heartbeat rate-limited; retrying` lines per second, 0
ticks landing.

**Cause:** on the anvil fork, `block.timestamp` does **not** track wall-clock —
it only advances when something mines + advances time. When wall passes
`nextHeartbeatAtTs` but chain `block.timestamp` is still below it, a naive
"delay = max(0, target − wallNow)" scheduler returns 0 → fires → on-chain
`require(block.timestamp >= nextHeartbeatAtTs)` reverts → re-reads the same value
→ waits 0 → spins. The revert flood then drains gas (above).

**Mitigations in the runner:** a safety margin (`HEARTBEAT_SAFETY_MARGIN_MS`, no
early fire), treating a rate-limited revert as *wait-in-window* (don't consume
the failure-retry budget), a minimum retry floor (never 0ms), and a fork-only
chain-time advance (`evm_increaseTime`/`evm_mine`, gated so it NEVER runs on a
real chain) so the next beat lands first-try.

> **Test lesson:** a heartbeat fix targeting the fork MUST model the fork's clock
> semantics (`block.timestamp` advances per-tx / on explicit time-jump, NOT with
> wall-clock). 66/66 green unit tests once passed while the live game was frozen
> because the suite modeled `wall ≈ chain` and never the fork case.

### Stale image

The runner is a `build:` service. If you change `packages/heartbeat` but don't
rebuild, the container runs old behavior. Rebuild + recreate:

```bash
docker compose build heartbeat
docker compose --profile dev up -d --force-recreate heartbeat
```

### Other

| Symptom | Cause | Action |
|---|---|---|
| `paused`/season-boundary revert | `worldPaused == true` or season finalizing | Check `getWorldState()`; unpause / wait for rollover. |
| Wrong RPC / chain-id mismatch | `CHAIN_NETWORK` vs RPC | Preflight fails on chain-id != 84532 — fix the env. |
| Convex not catching up | webhook / indexer lag | Heartbeat tx is fine; debug Convex (see `self-hosted-convex.md`). |
| `TELEGRAM_BOT_TOKEN is not set` errors | alert path with no token | Absent token should be a no-op; safe to ignore. |

## Stopgap (retire once the fix is verified)

`clanworld-heartbeat-restart.timer` (hourly `docker restart`) was a stopgap while
#652 was being root-caused. Retire it once a clean 30s cadence with **0
rate-limited reverts** is confirmed.

## Related

- [fresh-session-checklist.md](fresh-session-checklist.md) — §3 gas sweep, §4 on-chain values.
- [../architecture/current-architecture.md](../architecture/current-architecture.md) — tick lifecycle diagram.
- `reference-clanworld-652-heartbeat-flapping-rootcause` (memory) — the full root-cause story.
