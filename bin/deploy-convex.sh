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

require_self_hosted_env() {
  local admin_key_file="${CONVEX_SELF_HOSTED_ADMIN_KEY_FILE:-agents/secrets/convex-admin.key}"
  export CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:-http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}}"
  if [[ -z "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ]]; then
    if [[ ! -f "$admin_key_file" ]]; then
      echo "ERROR: missing Convex admin key file: $admin_key_file" >&2
      echo "Run: make bootstrap-convex-admin-key PROFILE=dev" >&2
      exit 1
    fi
    export CONVEX_SELF_HOSTED_ADMIN_KEY="$(<"$admin_key_file")"
  fi
  unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY
}

is_local_origin() {
  # Returns 0 (true) if the URL points at a local/internal-only Convex origin
  # that must NOT be advertised to browsers in a prod deployment.
  #
  # Match rules: a local host must terminate with `/`, `:port`, end-of-string,
  # or path. Plain prefix-glob on `http://convex-backend*` would falsely accept
  # `http://convex-backend-prod.example.com` (a legitimate prod host whose
  # hostname starts with the local-network alias). It would also leave
  # http://[::1]/ and http://0.0.0.0/ uncovered.
  local value="$1"
  case "$value" in
    http://localhost|http://localhost/*|http://localhost:*|\
    https://localhost|https://localhost/*|https://localhost:*|\
    http://127.0.0.1|http://127.0.0.1/*|http://127.0.0.1:*|\
    https://127.0.0.1|https://127.0.0.1/*|https://127.0.0.1:*|\
    http://0.0.0.0|http://0.0.0.0/*|http://0.0.0.0:*|\
    https://0.0.0.0|https://0.0.0.0/*|https://0.0.0.0:*|\
    'http://[::1]'|'http://[::1]/'*|'http://[::1]:'*|\
    'https://[::1]'|'https://[::1]/'*|'https://[::1]:'*|\
    http://convex-backend|http://convex-backend/*|http://convex-backend:*|\
    https://convex-backend|https://convex-backend/*|https://convex-backend:*)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

require_pinned_convex_tags() {
  # Prod must not run unpinned Convex images — `latest` resolves to a different
  # SHA over time, so reproducible deploys + on-purpose upgrades both break.
  # Dev keeps `latest` as a convenience default.
  [[ "${CHAIN_NETWORK:-dev}" == "prod" ]] || return 0

  local name value
  for name in CONVEX_BACKEND_TAG CONVEX_DASHBOARD_TAG; do
    value="${!name:-}"
    if [[ -z "$value" || "$value" == "latest" ]]; then
      echo "ERROR: $name must be pinned to an immutable tag or digest when CHAIN_NETWORK=prod; got '${value:-<unset>}'" >&2
      echo "  e.g. CONVEX_BACKEND_TAG=<commit-sha-tag>  (see .env.template for current pin)" >&2
      exit 1
    fi
  done
}

require_prod_origins() {
  [[ "${CHAIN_NETWORK:-dev}" == "prod" ]] || return 0

  local name value
  for name in CONVEX_CLOUD_ORIGIN CONVEX_SITE_ORIGIN CONVEX_DASHBOARD_DEPLOYMENT_URL; do
    value="${!name:-}"
    if [[ -z "$value" ]] || is_local_origin "$value"; then
      echo "ERROR: $name must be set to a browser-routable prod URL when CHAIN_NETWORK=prod; got '${value:-<unset>}'" >&2
      exit 1
    fi
  done
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
require_prod_origins
require_pinned_convex_tags
require_self_hosted_env
check_cli_version

pnpm --filter @clan-world/sdk convex:codegen
pnpm --filter @clan-world/server convex:codegen
pnpm typecheck
pnpm --filter @clan-world/server convex:deploy
