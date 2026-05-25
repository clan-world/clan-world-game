#!/usr/bin/env bash
# DEV/ANVIL ONLY. This is the ownership hand-off from current clan owners
# (legacy elders / auto-operator wallets) to dockerized elder wallets.
# It intentionally transfers clans 1-4 away from their current owners. Never
# run this against prod or any RPC that is not the dev anvil fork.
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
CLAN_RETURNS="(uint32,uint256,address,uint8,uint8,uint8,uint8,uint8,uint64,uint64,uint16,uint64,uint256,uint256,uint256,uint256,uint256,uint256,uint256)"

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
fund_account "$PROVISIONER"
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

echo "[provision] OK: elder wallets are funded and own clans 1-4 on the anvil fork."
warn_world_preflight "after ownership hand-off"
echo "[provision] IMPORTANT: run one real elder clan submit-orders smoke on this SAME anvil state before trusting autonomous elders."
