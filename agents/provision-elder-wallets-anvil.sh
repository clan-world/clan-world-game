#!/usr/bin/env bash
# DEV/ANVIL ONLY. This is the ownership hand-off from current clan owners
# (legacy elders / auto-operator wallets) to dockerized elder wallets.
# It intentionally transfers clans 1-4 away from their current owners. Never
# run this against prod or any RPC that is not the dev anvil fork.
#
# It ALSO funds the heartbeat runner wallet on the fork (anvil_setBalance) so
# the runner never goes gas-starved after a re-fork — reverted heartbeat txs
# still burn gas, so the runner's balance drains over time and the world stalls.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

set -a
[[ -f .env ]] && source .env
[[ -f .env.local ]] && source .env.local
set +a

PROFILE="${PROFILE:-dev}"
CHAIN_NETWORK="${CHAIN_NETWORK:-dev}"
RPC_URL="${DEV_RPC_URL:-http://anvil-fork:8545}"
DIAMOND="${CLAN_WORLD_CONTRACT_ADDRESS:-}"
BALANCE_HEX="${ELDER_ANVIL_BALANCE_HEX:-0x56BC75E2D63100000}" # 100 ETH
PROVISIONER="${ANVIL_PROVISIONER_ADDRESS:-0x1000000000000000000000000000000000000615}"
ZERO_ADDRESS="0x0000000000000000000000000000000000000000"
CLAN_RETURNS="(uint32,uint256,address,uint8,uint8,uint8,uint8,uint8,uint8,uint64,uint64,uint16,uint64,uint256,uint256,uint256,uint256,uint256,uint256)"

if [[ "$PROFILE" != "dev" || "$CHAIN_NETWORK" != "dev" ]]; then
  echo "FATAL: this script is dev/anvil-only. Set PROFILE=dev and CHAIN_NETWORK=dev." >&2
  exit 2
fi

if [[ -z "$DIAMOND" ]]; then
  echo "FATAL: CLAN_WORLD_CONTRACT_ADDRESS is required." >&2
  exit 2
fi

if ! command -v cast >/dev/null 2>&1; then
  echo "FATAL: host cast is required to derive elder wallet addresses from key files." >&2
  exit 2
fi

if [[ -z "$(docker compose --profile dev ps -q heartbeat 2>/dev/null)" ]]; then
  echo "FATAL: heartbeat service is not running; start dev stack services before provisioning." >&2
  exit 2
fi

compose_cast() {
  docker compose --profile dev exec -T heartbeat cast "$@" --rpc-url "$RPC_URL"
}

key_file_for() {
  local n="$1"
  local var="ELDER_WALLET_KEY_FILE_${n}"
  local file="${!var:-}"
  if [[ -z "$file" ]]; then
    file="agents/secrets/elder-wallet-${n}.key"
  fi
  printf '%s\n' "$file"
}

elder_address_for() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "FATAL: missing elder wallet key file: $file" >&2
    exit 2
  fi
  cast wallet address "$(tr -d '[:space:]' < "$file")"
}

fund_account() {
  local address="$1"
  compose_cast rpc anvil_setBalance "$address" "$BALANCE_HEX" >/dev/null
}

# Derive the heartbeat runner address. Prefer deriving from RUNNER_PRIVATE_KEY
# (sourced from .env / .env.local above, same key the heartbeat container uses)
# so the funded address always tracks the configured runner wallet. If the key
# is unavailable OR fails to decode into a valid address, fall back to the
# configurable HEARTBEAT_RUNNER_ADDRESS env var which defaults to the known dev
# runner wallet.
#
# NOTE: .env.local may hold a non-empty BUT MALFORMED placeholder such as
# RUNNER_PRIVATE_KEY=DELETED_2026_06_08_PENDING_ROTATION. A bare `-n` check
# passes for that, then `cast wallet address` fails to decode → empty addr →
# anvil_setBalance errors → set -e aborts before the clan hand-off. So we must
# fall back when the key fails to decode, not only when it is empty: derive,
# validate the result is 0x+40hex, else use the hardcoded fallback.
runner_address() {
  local key="${RUNNER_PRIVATE_KEY:-}"
  local derived=""
  if [[ -n "$key" ]]; then
    derived="$(cast wallet address "$key" 2>/dev/null || true)"
    if [[ "$derived" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
      printf '%s\n' "$derived"
      return 0
    fi
    echo "WARN: RUNNER_PRIVATE_KEY did not decode to a valid address (got '${derived:-<empty>}'); falling back to HEARTBEAT_RUNNER_ADDRESS." >&2
  fi
  printf '%s\n' "${HEARTBEAT_RUNNER_ADDRESS:-0xBC34eB46EF3Ad429C3Bcef049dc8ccca6f786cc7}"
}

clan_owner() {
  local clan_id="$1"
  compose_cast call "$DIAMOND" "getClan(uint32)$CLAN_RETURNS" "$clan_id" \
    | grep -oE '0x[0-9a-fA-F]{40}' \
    | head -1 \
    || true
}

same_address() {
  [[ "${1,,}" == "${2,,}" ]]
}

assert_dev_anvil_rpc() {
  local client_version chain_id expected_chain_id
  expected_chain_id="${DEV_FORK_CHAIN_ID:-${ANVIL_CHAIN_ID:-}}"

  # Require anvil identity. This script uses anvil-only RPC methods
  # (anvil_setBalance, --unlocked impersonation) and transfers clan ownership,
  # so it must NEVER run against a non-anvil RPC. The chain-id check below is an
  # ADDITIONAL constraint (AND), not an alternative pass-path — a matching chain
  # id alone must not satisfy the guard (e.g. a real Base Sepolia node whose
  # chain id happens to equal DEV_FORK_CHAIN_ID must still be refused).
  client_version="$(compose_cast rpc web3_clientVersion 2>/dev/null || true)"
  if [[ "${client_version,,}" != *anvil* ]]; then
    echo "FATAL: refusing to run: DEV_RPC_URL is not a local anvil fork." >&2
    echo "FATAL: clientVersion='${client_version:-<unreadable>}' (anvil identity required)." >&2
    exit 2
  fi
  echo "[provision] verified anvil RPC: $client_version"

  # If an expected fork chain id is configured, it must ALSO match.
  if [[ -n "$expected_chain_id" ]]; then
    chain_id="$(compose_cast chain-id 2>/dev/null || true)"
    if [[ "$chain_id" != "$expected_chain_id" ]]; then
      echo "FATAL: anvil chain id '${chain_id:-<unreadable>}' != expected '$expected_chain_id'." >&2
      exit 2
    fi
    echo "[provision] verified dev fork chain id: $chain_id"
  fi
}

warn_world_preflight() {
  local label="$1"
  local paused_raw state_raw fields current_tick season_start_tick season_end_tick season_finalized rest

  if paused_raw="$(compose_cast call "$DIAMOND" "isWorldPaused()(bool)" 2>/dev/null)"; then
    if [[ "$paused_raw" == *true* ]]; then
      echo "WARN: world is paused ($label); elder submit-orders will revert until unpaused." >&2
    fi
  else
    echo "WARN: unable to read isWorldPaused() ($label); run a real submit smoke before trusting provisioning." >&2
  fi

  if state_raw="$(compose_cast call "$DIAMOND" "getWorldState()(uint64,uint64,uint64,bool,uint64,uint64,uint64,uint64,uint16,bytes32)" 2>/dev/null)"; then
    fields="$(printf '%s\n' "$state_raw" | tr -d '[](),' | tr '\n' ' ')"
    read -r current_tick season_start_tick season_end_tick season_finalized rest <<< "$fields"
    if [[ "$current_tick" =~ ^[0-9]+$ && "$season_end_tick" =~ ^[0-9]+$ ]]; then
      if (( current_tick >= season_end_tick )) && [[ "$season_finalized" == "false" ]]; then
        echo "WARN: season finalization is pending ($label); elder submit-orders will revert until finalized." >&2
      fi
    else
      echo "WARN: unable to parse getWorldState() ($label); run a real submit smoke before trusting provisioning." >&2
    fi
  else
    echo "WARN: unable to read getWorldState() ($label); run a real submit smoke before trusting provisioning." >&2
  fi
}

echo "[provision] diamond=$DIAMOND rpc=$RPC_URL balance=$BALANCE_HEX"
echo "[provision] DEV/ANVIL ONLY: transferring clans 1-4 to dockerized elder wallets."
echo "[provision] This is the intended auto-operator/legacy-owner -> elder ownership hand-off."
assert_dev_anvil_rpc
fund_account "$PROVISIONER"

# Fund the heartbeat runner wallet. Every reverted heartbeat tx still burns gas,
# so the runner's balance bleeds out over time; without this it can run dry after
# a re-fork and the world stalls (the freeze this step exists to prevent). Same
# generous balance as the elders, dev/anvil-only (inside the guards above).
RUNNER_ADDRESS="$(runner_address)"
echo "[provision] funded heartbeat runner $RUNNER_ADDRESS"
fund_account "$RUNNER_ADDRESS"

warn_world_preflight "before ownership hand-off"

for n in 1 2 3 4; do
  key_file="$(key_file_for "$n")"
  elder_addr="$(elder_address_for "$key_file")"
  clan_id="$n"

  echo "[provision] elder-$n address=$elder_addr key_file=$key_file clan=$clan_id"
  fund_account "$elder_addr"

  owner="$(clan_owner "$clan_id")"
  if [[ -z "$owner" || "$owner" == "$ZERO_ADDRESS" ]]; then
    echo "[provision] clan $clan_id missing; minting to elder-$n"
    compose_cast send "$DIAMOND" "mintClan(address)" "$elder_addr" --unlocked --from "$PROVISIONER" >/dev/null
    owner="$(clan_owner "$clan_id")"
    if ! same_address "$owner" "$elder_addr"; then
      echo "FATAL: mintClan did not create clan $clan_id owned by elder-$n; got owner '${owner:-<none>}'." >&2
      echo "FATAL: nextClanId may have drifted. Stop and inspect the anvil state before elders submit orders." >&2
      exit 1
    fi
  fi

  if same_address "$owner" "$elder_addr"; then
    echo "[provision] clan $clan_id already owned by elder-$n"
    continue
  fi

  echo "[provision] transferring clan $clan_id from $owner to elder-$n"
  fund_account "$owner"
  compose_cast send "$DIAMOND" "transferClanOwnership(uint32,address)" "$clan_id" "$elder_addr" \
    --unlocked --from "$owner" >/dev/null

  owner="$(clan_owner "$clan_id")"
  if ! same_address "$owner" "$elder_addr"; then
    echo "FATAL: clan $clan_id owner is still $owner after transfer attempt." >&2
    exit 1
  fi
done

echo "[provision] OK: elder wallets + heartbeat runner ($RUNNER_ADDRESS) are funded and elders own clans 1-4 on the anvil fork."
warn_world_preflight "after ownership hand-off"
echo "[provision] IMPORTANT: run one real elder clan submit-orders smoke on this SAME anvil state before trusting autonomous elders."
