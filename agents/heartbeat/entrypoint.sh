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
  # Read secret. Command substitution already strips trailing newlines, but a
  # paste-error could leave trailing spaces/tabs or embedded newlines; either
  # would corrupt the Authorization header. Trim trailing whitespace, then
  # reject any remaining embedded newlines outright.
  WEBHOOK_SHARED_SECRET="$(cat "$WEBHOOK_SHARED_SECRET_FILE")"
  WEBHOOK_SHARED_SECRET="$(printf '%s' "$WEBHOOK_SHARED_SECRET" | sed 's/[[:space:]]*$//')"
  # Detect embedded newlines: compare raw byte count to single-line byte count
  # (command substitution would strip a newline literal in a `case` pattern).
  _secret_raw_bytes="$(printf '%s' "$WEBHOOK_SHARED_SECRET" | wc -c | tr -d '[:space:]')"
  _secret_first_line_bytes="$(printf '%s' "$WEBHOOK_SHARED_SECRET" | head -n 1 | wc -c | tr -d '[:space:]')"
  if [ "$_secret_raw_bytes" != "$_secret_first_line_bytes" ]; then
    unset _secret_raw_bytes _secret_first_line_bytes
    fail "WEBHOOK_SHARED_SECRET_FILE contains embedded newlines; secret must be a single line: $WEBHOOK_SHARED_SECRET_FILE"
  fi
  unset _secret_raw_bytes _secret_first_line_bytes
  [ -n "$WEBHOOK_SHARED_SECRET" ] || fail "WEBHOOK_SHARED_SECRET_FILE is empty: $WEBHOOK_SHARED_SECRET_FILE"
  export WEBHOOK_SHARED_SECRET
fi

[ -n "${WEBHOOK_SHARED_SECRET:-}" ] || fail "WEBHOOK_SHARED_SECRET or WEBHOOK_SHARED_SECRET_FILE is required"

# runnerCastHeartbeat.ts reads RPC_URL_PRIMARY, so export the profile-selected
# URL under the name the existing runner process already consumes.
export RPC_URL_PRIMARY="$SELECTED_RPC_URL"

log "network=${CHAIN_NETWORK} expectedChainId=${EXPECTED_CHAIN_ID} contract=${CLAN_WORLD_CONTRACT_ADDRESS}"

RPC_RETRY_MAX=30
RPC_RETRY=0
until cast chain-id --rpc-url "$RPC_URL_PRIMARY" >/dev/null 2>&1; do
  RPC_RETRY=$((RPC_RETRY + 1))
  if [ "$RPC_RETRY" -ge "$RPC_RETRY_MAX" ]; then
    fail "RPC at $RPC_URL_PRIMARY did not respond after ${RPC_RETRY_MAX} attempts"
  fi
  log "RPC not ready (attempt ${RPC_RETRY}/${RPC_RETRY_MAX}); retrying in 2s"
  sleep 2
done

OBSERVED_CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL_PRIMARY")" || fail "cast chain-id failed"
[ "$OBSERVED_CHAIN_ID" = "$EXPECTED_CHAIN_ID" ] || fail "chain id mismatch: expected ${EXPECTED_CHAIN_ID}, got ${OBSERVED_CHAIN_ID}"

log "preflight passed; starting @clan-world/runner heartbeat"
exec pnpm --filter @clan-world/runner heartbeat
