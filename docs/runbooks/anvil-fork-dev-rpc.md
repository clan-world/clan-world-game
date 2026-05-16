# Clan World — anvil-fork dev RPC

Operational runbook for the `anvil-fork` compose service: a Foundry `anvil` container that forks Base Sepolia, persists state to a named volume, and serves as a free-of-charge RPC for local dev iteration.

**Dev profile only.** Prod (the VPS) uses real Base Sepolia via `PROD_RPC_URL`. Trying to use anvil-fork in prod is a configuration mistake — `PROFILE=prod` does not even start the container.

## Overview

| Property | Value |
|---|---|
| Image | `ghcr.io/foundry-rs/foundry:v1.2.0` (pinned — never `:latest`) |
| Compose profile | `dev` only |
| Chain ID | `84532` (matches Base Sepolia) |
| Internal hostname | `anvil-fork` (on `clan-world-internal` network) |
| Internal port | `8545` (NOT published to host) |
| Persisted volume | `clan-world_anvil_data` |
| State file | `/data/anvil-state.json` (`--state-interval=60`) |
| Block time | 2s |
| Gas price | 0 (free dev iteration) |
| Auto-impersonate | on (`--auto-impersonate` — any address can sign without a key) |

When to use it:

- Local dev iteration where you don't want to burn real Base Sepolia RPC credits.
- Testing destructive admin flows (resets, wipes, owner-only paths) without polluting prod state.
- Reproducing a bug pinned to a specific block (`FORK_BLOCK_NUMBER`).

When NOT to use it:

- Anything prod-shaped — heartbeat preflight asserts `CHAIN_NETWORK=prod` against a real RPC.
- Multi-host or shared-state scenarios — the fork state is local to one VPS's named volume.

## 1. Bring up

```bash
# From the repo root
docker compose --profile dev up -d anvil-fork
```

Verify (from a sibling container on the `clan-world-internal` network):

```bash
docker compose --profile dev exec -T heartbeat \
  curl -sf -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","id":1}' \
    http://anvil-fork:8545
# → {"jsonrpc":"2.0","id":1,"result":"0x14a34"}    (0x14a34 = 84532)
```

If you don't have a sibling container handy:

```bash
docker compose --profile dev ps anvil-fork
# STATUS column should show "healthy" within ~20s of start
```

The healthcheck is `cast chain-id --rpc-url http://localhost:8545` from inside the container — same check the heartbeat preflight does, just internal.

## 2. Configure the fork

Settings live in `.env.local` (or whatever env file your stack picks up). The relevant variables are documented in `.env.template`:

```bash
# Required — what we read once to seed the fork. Alchemy/Infura/QuickNode all
# work; public sepolia.base.org is too aggressively rate-limited for fork-seeding.
BASE_SEPOLIA_RPC_FOR_FORK_SEED=https://base-sepolia.g.alchemy.com/v2/<YOUR_KEY>

# 0 = fork from latest block at first up. Otherwise pin a specific block so
# dev iteration is deterministic across team members + restarts.
FORK_BLOCK_NUMBER=0
```

To pin a specific block (recommended once your dev flow is reproducible):

```bash
# Read latest block once
cast block-number --rpc-url "$BASE_SEPOLIA_RPC_FOR_FORK_SEED"
# Edit .env.local: FORK_BLOCK_NUMBER=<that number>
# Then reset the fork — see section 4.
```

`FORK_BLOCK_NUMBER=0` means "use latest at first-up time" — the fork is still deterministic after that, because subsequent `restart`s resume from persisted state, not re-fork.

## 3. Persist + resume

`anvil-fork` writes state to `/data/anvil-state.json` every 60 seconds (`--state-interval=60`). The `/data` directory is the `clan-world_anvil_data` named volume.

```bash
# Restart picks up where it left off — no re-fork
docker compose --profile dev restart anvil-fork
```

After a restart, dev txs you submitted before the restart are still in chain state. You only lose the last <60s of activity (whatever happened between the most recent state dump and the restart).

To inspect the volume from the host (read-only snapshot pattern — see `agents/Makefile` `link-mounts` for the canonical helper-container approach):

```bash
docker run --rm -v clan-world_anvil_data:/data:ro busybox ls -lh /data
```

## 4. Reset

Use this when fork state has drifted too far from real Base Sepolia, or when you want a fresh fork pinned to a new `FORK_BLOCK_NUMBER`.

```bash
make -C agents reset-anvil PROFILE=dev
```

What that does (`agents/Makefile`):

1. `docker compose --profile dev stop anvil-fork`
2. `docker volume rm clan-world_anvil_data`
3. `docker compose --profile dev up -d anvil-fork` — re-forks from `BASE_SEPOLIA_RPC_FOR_FORK_SEED` at `FORK_BLOCK_NUMBER`

The Makefile target fails loud if `PROFILE` is unset or `PROFILE=prod` — the named volume `clan-world_anvil_data` should not exist in prod, but the guard is there as a safety net.

When to reset:

- Clan-world state on the fork is corrupt or in a half-state from an aborted test.
- You bumped `FORK_BLOCK_NUMBER` and want the fork to actually re-seed from the new block.
- You want a clean fork before running a destructive test suite.

When NOT to reset:

- You just want to roll back one tx — use `anvil_setBalance` / `anvil_setStorageAt` cheatcodes or restart the elders, both are cheaper.

## 5. Troubleshooting

### `unhealthy` status on `docker compose ps`

Most common cause: `BASE_SEPOLIA_RPC_FOR_FORK_SEED` is unset, malformed, or rate-limited. Check:

```bash
docker compose --profile dev logs anvil-fork | tail -50
```

Look for "fork URL" or "401 Unauthorized" or "429 Too Many Requests". Fix `BASE_SEPOLIA_RPC_FOR_FORK_SEED` in `.env.local` (e.g. swap to an Alchemy key with quota left), then `make -C agents reset-anvil PROFILE=dev`.

### "fork block not available" / "header not found"

`FORK_BLOCK_NUMBER` is older than the seed-RPC's retention window. Most non-archive Base Sepolia RPCs only retain the last ~256 blocks. Either:

- Set `FORK_BLOCK_NUMBER=0` (use latest), or
- Pick a more recent block from `cast block-number --rpc-url "$BASE_SEPOLIA_RPC_FOR_FORK_SEED"`, or
- Swap to an archive RPC (Alchemy growth tier, QuickNode, etc).

Then `make -C agents reset-anvil PROFILE=dev`.

### App side reports chain-ID mismatch

The heartbeat container's preflight asserts the observed chain ID matches `CHAIN_NETWORK`. If you see "chain ID mismatch: expected 84532, got X" against anvil-fork:

- Confirm the compose `command:` block still passes `--chain-id=84532` (someone may have overridden it locally).
- Confirm `CHAIN_NETWORK=dev` (not `prod`) in `.env.local`.
- Reset the fork (`make -C agents reset-anvil PROFILE=dev`) to drop any state from a wrong-chain-id run.

### Healthcheck flapping but RPC responds

The healthcheck uses `cast chain-id --rpc-url http://localhost:8545` with a 5s timeout and 15s interval. If the container is under heavy load (deploy script in progress, bulk `cast send` loop), the healthcheck can lag. If `eth_chainId` from a sibling container returns `0x14a34`, the fork is fine — wait for the load to drop or extend `timeout:` in `docker-compose.yml` locally.

## Cross-links

- `docs/runbooks/fresh-vps-bootstrap.md` — full VPS bring-up; prod stack uses real Base Sepolia, not anvil-fork.
- `docs/runbooks/soft-game-reset.md` — mid-season recovery flow; on dev profile, anvil-fork is the RPC the recovery txs hit.
- `agents/Makefile` — `reset-anvil`, `up PROFILE=dev`, `down`, `status`, `link-mounts`.
- `docker-compose.yml` — `anvil-fork:` service definition.
- `.env.template` — `BASE_SEPOLIA_RPC_FOR_FORK_SEED`, `FORK_BLOCK_NUMBER`, `DEV_RPC_URL`.
