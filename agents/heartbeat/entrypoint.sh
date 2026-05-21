#!/bin/sh
set -eu

log() {
  printf '%s\n' "[heartbeat-entrypoint] $*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

case "${CHAIN_NETWORK:-}" in
  dev)
    SELECTED_RPC_URL="${DEV_RPC_URL:-}"
    EXPECTED_CHAIN_ID="84532"
    ;;
  prod)
    SELECTED_RPC_URL="${PROD_RPC_URL:-}"
    EXPECTED_CHAIN_ID="84532"
    ;;
  "")
    fail "CHAIN_NETWORK is required (dev|prod)"
    ;;
  *)
    fail "CHAIN_NETWORK must be dev or prod, got '${CHAIN_NETWORK}'"
    ;;
esac

[ -n "$SELECTED_RPC_URL" ] || fail "selected RPC URL is empty for CHAIN_NETWORK=${CHAIN_NETWORK}"
[ -n "${CLAN_WORLD_CONTRACT_ADDRESS:-}" ] || fail "CLAN_WORLD_CONTRACT_ADDRESS is required"

if [ "$CHAIN_NETWORK" = "prod" ]; then
  case "$SELECTED_RPC_URL" in
    *anvil-fork*|*localhost*|*127.0.0.1*)
      fail "prod RPC URL must not point at local/anvil endpoint: $SELECTED_RPC_URL"
      ;;
  esac
fi

if [ -n "${WEBHOOK_SHARED_SECRET_FILE:-}" ]; then
  [ -f "$WEBHOOK_SHARED_SECRET_FILE" ] || fail "WEBHOOK_SHARED_SECRET_FILE does not exist: $WEBHOOK_SHARED_SECRET_FILE"
  WEBHOOK_SHARED_SECRET="$(cat "$WEBHOOK_SHARED_SECRET_FILE")"
  [ -n "$WEBHOOK_SHARED_SECRET" ] || fail "WEBHOOK_SHARED_SECRET_FILE is empty: $WEBHOOK_SHARED_SECRET_FILE"
  export WEBHOOK_SHARED_SECRET
fi

[ -n "${WEBHOOK_SHARED_SECRET:-}" ] || fail "WEBHOOK_SHARED_SECRET or WEBHOOK_SHARED_SECRET_FILE is required"

# runnerCastHeartbeat.ts reads RPC_URL_PRIMARY, so export the profile-selected
# URL under the name the existing runner process already consumes.
export RPC_URL_PRIMARY="$SELECTED_RPC_URL"

log "network=${CHAIN_NETWORK} expectedChainId=${EXPECTED_CHAIN_ID} contract=${CLAN_WORLD_CONTRACT_ADDRESS}"

OBSERVED_CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL_PRIMARY")" || fail "cast chain-id failed"
[ "$OBSERVED_CHAIN_ID" = "$EXPECTED_CHAIN_ID" ] || fail "chain id mismatch: expected ${EXPECTED_CHAIN_ID}, got ${OBSERVED_CHAIN_ID}"

log "preflight passed; starting @clan-world/runner heartbeat"
exec pnpm --filter @clan-world/runner heartbeat
