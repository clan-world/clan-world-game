#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

load_env() {
  set -a
  [[ -f .env ]] && source .env
  [[ -f .env.local ]] && source .env.local
  set +a
}

PROFILE="${PROFILE:-dev}"
failed=0

check_exec() {
  local service="$1"
  local url="$2"
  if docker compose --profile "$PROFILE" exec -T "$service" curl -fsS "$url" >/dev/null 2>&1; then
    printf 'GREEN %s %s\n' "$service" "$url"
  else
    printf 'RED   %s %s\n' "$service" "$url"
    failed=1
  fi
}

check_host() {
  local name="$1"
  local url="$2"
  if curl -fsS "$url" >/dev/null 2>&1; then
    printf 'GREEN %s %s\n' "$name" "$url"
  else
    printf 'RED   %s %s\n' "$name" "$url"
    failed=1
  fi
}

check_exec_any_status() {
  local service="$1"
  local url="$2"
  local http_code
  # -w '%{http_code}' captures status; -o /dev/null discards body; --connect-timeout bounds wait.
  # Without explicit status parsing, plain curl returns 0 on HTTP 5xx, which would silently
  # report GREEN for a broken backend (cloud-review Finding 6 on PR #526).
  http_code="$(docker compose --profile "$PROFILE" exec -T "$service" curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 2 "$url" 2>/dev/null)" || http_code="000"
  case "$http_code" in
    2*|3*|4*)
      printf 'GREEN %s %s (HTTP %s)\n' "$service" "$url" "$http_code"
      ;;
    5*)
      printf 'RED   %s %s (HTTP %s — backend error)\n' "$service" "$url" "$http_code"
      failed=1
      ;;
    *)
      printf 'RED   %s %s (unreachable — curl status: %s)\n' "$service" "$url" "$http_code"
      failed=1
      ;;
  esac
}

load_env

check_exec convex-backend http://localhost:3210/version
check_exec_any_status convex-backend http://localhost:3211/
check_exec convex-dashboard http://localhost:6791/

if [[ "$PROFILE" == "dev" ]]; then
  check_host convex-backend-dev-loopback "http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}/version"
  check_host convex-dashboard-dev-loopback "http://127.0.0.1:${CONVEX_DASHBOARD_HOST_PORT:-6791}/"
fi

exit "$failed"
