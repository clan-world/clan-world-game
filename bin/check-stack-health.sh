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
  if docker compose --profile "$PROFILE" exec -T "$service" curl -sS -o /dev/null --connect-timeout 2 "$url" >/dev/null 2>&1; then
    printf 'GREEN %s %s\n' "$service" "$url"
  else
    printf 'RED   %s %s\n' "$service" "$url"
    failed=1
  fi
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
