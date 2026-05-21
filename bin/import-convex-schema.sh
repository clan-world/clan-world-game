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

export_self_hosted_env() {
  local admin_key_file="${CONVEX_SELF_HOSTED_ADMIN_KEY_FILE:-agents/secrets/convex-admin.key}"
  export CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:-http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}}"
  if [[ -z "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ]]; then
    if [[ ! -f "$admin_key_file" ]]; then
      echo "ERROR: missing Convex admin key file: $admin_key_file" >&2
      exit 1
    fi
    export CONVEX_SELF_HOSTED_ADMIN_KEY="$(<"$admin_key_file")"
  fi
  unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY
}

has_hosted_selector() {
  [[ -n "${CONVEX_DEPLOYMENT:-}" || -n "${CONVEX_DEPLOY_KEY:-}" ]]
}

load_env
check_cli_version

mkdir -p agents/backups
if [[ -n "${HOSTED_CONVEX_EXPORT_ZIP:-}" ]]; then
  if [[ ! -f "$HOSTED_CONVEX_EXPORT_ZIP" ]]; then
    echo "ERROR: HOSTED_CONVEX_EXPORT_ZIP points to a missing file: $HOSTED_CONVEX_EXPORT_ZIP" >&2
    exit 1
  fi
  export_zip="$HOSTED_CONVEX_EXPORT_ZIP"
else
  if ! has_hosted_selector; then
    echo "ERROR: set HOSTED_CONVEX_EXPORT_ZIP to an existing export, or set an explicit hosted selector (CONVEX_DEPLOYMENT or CONVEX_DEPLOY_KEY) before export." >&2
    exit 1
  fi
  export_zip="agents/backups/convex-hosted-$(date -u +%Y%m%dT%H%M%SZ).zip"
fi

schema_sha="$(sha256sum packages/sdk/convex/schema.ts | awk '{print $1}')"
if [[ -n "${SDK_SCHEMA_SHA256:-}" && "$schema_sha" != "$SDK_SCHEMA_SHA256" ]]; then
  echo "ERROR: SDK schema fingerprint mismatch: expected $SDK_SCHEMA_SHA256, got $schema_sha" >&2
  exit 1
fi
echo "SDK schema fingerprint: $schema_sha"

if [[ -f "$export_zip" ]]; then
  echo "Using existing hosted export: $export_zip"
else
  echo "Exporting hosted Convex data to $export_zip"
  unset CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
  convex_cli export --path "$export_zip"
fi

if [[ "${CONFIRM_REPLACE_ALL:-}" != "1" && "${FRESH_SELF_HOSTED:-}" != "1" ]]; then
  echo "ERROR: destructive import refused. Set CONFIRM_REPLACE_ALL=1 or FRESH_SELF_HOSTED=1 to replace all self-hosted Convex data." >&2
  exit 1
fi

export_self_hosted_env
echo "WARNING: destructive import will replace all data in self-hosted Convex."
echo "Importing $export_zip into self-hosted Convex at $CONVEX_SELF_HOSTED_URL"
convex_cli import --replace-all --yes "$export_zip"
