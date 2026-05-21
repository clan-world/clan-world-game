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

convex_cli() {
  npx -y "convex@${CONVEX_CLI_PINNED_VERSION:?CONVEX_CLI_PINNED_VERSION is required}" "$@"
}

check_cli_version() {
  local expected="${CONVEX_CLI_PINNED_VERSION:?CONVEX_CLI_PINNED_VERSION is required}"
  local actual
  actual="$(convex_cli --version)"
  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: Convex CLI version mismatch: expected $expected, got $actual" >&2
    exit 1
  fi
}

load_env
check_cli_version

admin_key_file="${CONVEX_SELF_HOSTED_ADMIN_KEY_FILE:-agents/secrets/convex-admin.key}"
export CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:-http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}}"
if [[ -z "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ]]; then
  if [[ ! -f "$admin_key_file" ]]; then
    echo "ERROR: missing Convex admin key file: $admin_key_file" >&2
    exit 1
  fi
  export CONVEX_SELF_HOSTED_ADMIN_KEY="$(<"$admin_key_file")"
fi
unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY

install -d -m 0700 agents/backups
backup_path="agents/backups/convex-$(date -u +%Y%m%dT%H%M%SZ).zip"
convex_cli export --path "$backup_path" --include-file-storage
chmod 0600 "$backup_path"
echo "Wrote $backup_path"
