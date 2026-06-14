# @clan-world/heartbeat

ClanWorld heartbeat package. In Bundle 4 PR1 this is a mechanical rename of
the old centralized runner package; PR2 will strip it down to the dumb
heartbeat singleton.

## What it does

```
loop:
  chainTick = pollChainTick(convex)
  if chainTick > lastProcessedTick:
    parallel for elder in 1..4:
      update = composeSituationBlock(elder, chainTick)
      tmux send-keys -t elder-N -l "$update" + Enter
    settle window (~90s) — Elders read, reason, submit orders
    lastProcessedTick = chainTick
  sleep pollInterval
```

The runner is the **only** writer of tick updates into Elder sessions. It
satisfies four seam interfaces from `@clan-world/agents/seams`:

| Seam                  | Impl                       | Notes                                              |
| --------------------- | -------------------------- | -------------------------------------------------- |
| `IRunnerInbox`        | `TmuxRunnerInbox`          | `tmux send-keys -l` + paste tick update + Enter   |
| `IElderMemoryStore`   | `FileMemoryStore`          | Local JSON memory per Elder                    |
| `IElderPeerInbox`     | `FilePeerInbox`            | JSONL per recipient clan                       |
| `IHeartbeatCaller`    | `RunnerCastHeartbeat`      | viem `writeContract`, dedicated runner wallet     |

## Heartbeat timing

Heartbeat cadence comes from the diamond's owner-configured
`heartbeatIntervalSeconds()` value. To change cadence:

1. Call `setHeartbeatIntervalSeconds(uint64)` on-chain as the contract owner.
2. Restart the runner or `scripts/start-heartbeat-loop.sh`.

The scheduler reads `heartbeatIntervalSeconds()` once at boot, then schedules
each fire from `getWorldState().nextHeartbeatAtTs` with a 500 ms jitter buffer.

## Alerts and status

The scheduler writes a `runnerStatus` row to Convex after heartbeat attempts
when `CONVEX_URL` and `INDEXER_SECRET` are configured. Telegram alerting is
best-effort and never crashes the loop.

| Variable | Description |
|---|---|
| `RUNNER_ID` | Stable `runnerStatus` id. Defaults to `clanworld-runner` in the full runner and `clanworld-heartbeat-loop` in the standalone loop. |
| `TELEGRAM_BOT_TOKEN` | Bot token used for heartbeat retry-exhaustion alerts. If unset, the runner logs locally and keeps running. |
| `TELEGRAM_ALERT_CHAT_ID` | Alert target chat. Defaults to do-crew group `-1003806628027`. |
| `TELEGRAM_ALERT_THREAD_ID` | Optional Telegram forum topic id. If unset, alerts post to the main group. |

## Run it

```bash
# 1. Provision a fresh runner wallet (NEVER reuse an Elder key) and fund it
#    with Base Sepolia ETH.
export RUNNER_PRIVATE_KEY=0x...
export CLAN_WORLD_CONTRACT_ADDRESS=0xC012275376b867944cd874FB2d600d6dA3B4A56e
export RPC_URL_PRIMARY=https://base-sepolia.g.alchemy.com/v2/...
export CONVEX_URL=https://...convex.cloud   # optional; runner idles without it
export INDEXER_SECRET=...                    # optional; enables runnerStatus writes
export TELEGRAM_BOT_TOKEN=...                # optional; enables heartbeat failure alerts

# 2. Make sure 4 tmux sessions exist with Elder Claude Code already attached:
#    elder-1, elder-2, elder-3, elder-4

# 3. Start the daemon:
pnpm --filter @clan-world/heartbeat start
```

## Env vars

See [`.env.example`](./.env.example). `pnpm start` loads the repo-root
`.env.local`; other launchers can provide the same vars through `process.env`.

## State directory

Default: `~/.world/clanworld-runner/state/`. Layout:

```
elder-1-memory.json          ← FileMemoryStore
elder-2-memory.json
elder-3-memory.json
elder-4-memory.json

elder-1-last-tick.txt        ← TmuxRunnerInbox idempotency marker
elder-2-last-tick.txt
…

elder-1-ack.flag             ← Set by `elder ack-clear` from Elder side
…

peer-inbox/
  elder-1.jsonl              ← FilePeerInbox; one file per recipient clan
  elder-2.jsonl
```

## Stub mode

- If `CONVEX_URL` is unset, `createConvexClient()` hands back a stub returning
  `{ tick: 0, ... }`. The tick loop interprets this as "no real chain state"
  and idles (logs a warning at boot).
- If `RUNNER_PRIVATE_KEY` is missing, the daemon refuses to start.

## systemd

Template unit file: [`clanworld-runner.service`](./clanworld-runner.service).
Install with:

```bash
mkdir -p ~/.config/systemd/user
cp packages/heartbeat/clanworld-runner.service ~/.config/systemd/user/
mkdir -p ~/.config/clanworld-runner
cp packages/heartbeat/.env.example ~/.config/clanworld-runner/runner.env
chmod 600 ~/.config/clanworld-runner/runner.env
# edit runner.env, then:
systemctl --user daemon-reload
systemctl --user enable --now clanworld-runner.service
```

## Memory adapter

The runner uses `IElderMemoryStore` for durable Elder memory across `/clear` context resets.

The runner uses `FileMemoryStore` — a local JSON file at:

```
~/.world/clanworld-runner/state/elder-{N}-memory.json
```

No extra config required.

## Peer inbox adapter (Phase 8)

The runner uses `IElderPeerInbox` for Elder-to-Elder private messaging (clan diplomacy).

The runner uses `FilePeerInbox`:

- Messages stored as JSONL at `~/.world/clanworld-runner/state/peer-inbox/elder-{recipient}.jsonl`
- `send()` appends to the **recipient's** file; `inbox()` reads the caller's own file.
- Non-destructive reads: `inbox()` returns all messages without deleting them.
- Wire format is back-compat with the Elder CLI's `peer whisper`/`peer inbox` commands.
- No external services required.

## Tests

```bash
pnpm test
```

Tests cover the file-based paths. No external peer or memory service is required to run the test suite.

## Known TODOs

- `pollChainTick` reads the full snapshot — switch to a dedicated
  `getCurrentTick` Convex query once it exists.
- Heartbeat rate-limit detection re-reads `getWorldState()` after a revert.
  When a typed `HeartbeatTooSoon` custom error lands in the contract ABI,
  upgrade `RunnerCastHeartbeat.callHeartbeat` to decode it directly.
