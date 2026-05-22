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
  # Match rules: a local host must terminate with `/`, `:port`, `?`, `#`,
  # end-of-string, or path. Plain prefix-glob on `http://convex-backend*` would
  # falsely accept `http://convex-backend-prod.example.com` (a legitimate prod
  # host whose hostname starts with the local-network alias). It would also
  # leave `http://[::1]/`, `http://0.0.0.0/`, and `http://[::]/` uncovered.
  #
  # Per RFC 3986, scheme and host are case-insensitive (path/query are not,
  # but our patterns only constrain the host so a `*` tail keeps them intact).
  # Lowercase the input before matching so `HTTP://Localhost` cannot slip past.
  # Trailing-dot hosts (`http://localhost.`) resolve identically to the bare
  # form, so they get their own glob entries.
  #
  # Normalize userinfo: `http://admin@localhost` is the same origin as
  # `http://localhost` per RFC 3986. Strip the `[userinfo@]` between scheme
  # and host before matching.
  local value="${1,,}"
  if [[ "$value" =~ ^([a-z]+://)([^/?#]*@)(.*)$ ]]; then
    value="${BASH_REMATCH[1]}${BASH_REMATCH[3]}"
  fi
  case "$value" in
    http://localhost|http://localhost/*|http://localhost:*|http://localhost\?*|http://localhost#*|\
    http://localhost.|http://localhost./*|http://localhost.:*|http://localhost.\?*|http://localhost.#*|\
    https://localhost|https://localhost/*|https://localhost:*|https://localhost\?*|https://localhost#*|\
    https://localhost.|https://localhost./*|https://localhost.:*|https://localhost.\?*|https://localhost.#*|\
    http://127.0.0.1|http://127.0.0.1/*|http://127.0.0.1:*|http://127.0.0.1\?*|http://127.0.0.1#*|\
    https://127.0.0.1|https://127.0.0.1/*|https://127.0.0.1:*|https://127.0.0.1\?*|https://127.0.0.1#*|\
    http://0.0.0.0|http://0.0.0.0/*|http://0.0.0.0:*|http://0.0.0.0\?*|http://0.0.0.0#*|\
    https://0.0.0.0|https://0.0.0.0/*|https://0.0.0.0:*|https://0.0.0.0\?*|https://0.0.0.0#*|\
    'http://[::1]'|'http://[::1]/'*|'http://[::1]:'*|'http://[::1]?'*|'http://[::1]#'*|\
    'https://[::1]'|'https://[::1]/'*|'https://[::1]:'*|'https://[::1]?'*|'https://[::1]#'*|\
    'http://[::]'|'http://[::]/'*|'http://[::]:'*|'http://[::]?'*|'http://[::]#'*|\
    'https://[::]'|'https://[::]/'*|'https://[::]:'*|'https://[::]?'*|'https://[::]#'*|\
    http://convex-backend|http://convex-backend/*|http://convex-backend:*|http://convex-backend\?*|http://convex-backend#*|\
    http://convex-backend.|http://convex-backend./*|http://convex-backend.:*|http://convex-backend.\?*|http://convex-backend.#*|\
    https://convex-backend|https://convex-backend/*|https://convex-backend:*|https://convex-backend\?*|https://convex-backend#*|\
    https://convex-backend.|https://convex-backend./*|https://convex-backend.:*|https://convex-backend.\?*|https://convex-backend.#*)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

require_pinned_convex_tags() {
  # Prod must not run unpinned Convex images — `latest` resolves to a different
  # SHA over time, so reproducible deploys + on-purpose upgrades both break.
  # Dev keeps `latest` as a convenience default.
  #
  # Reject the common mutable-tag conventions: `latest`, `main`, `master`,
  # `edge`, `stable`, `head`, `nightly`. The check is case-insensitive so
  # `LATEST` or `Main` are caught too. CHAIN_NETWORK is also matched
  # case-insensitively to stay symmetric with require_prod_origins.
  local network="${CHAIN_NETWORK:-dev}"
  [[ "${network,,}" == "prod" ]] || return 0

  local name value value_lc
  for name in CONVEX_BACKEND_TAG CONVEX_DASHBOARD_TAG; do
    value="${!name:-}"
    value_lc="${value,,}"
    case "$value_lc" in
      ""|latest|main|master|edge|stable|head|nightly)
        echo "ERROR: $name must be pinned to an immutable tag or digest when CHAIN_NETWORK=prod; got '${value:-<unset>}'" >&2
        echo "  Mutable tags (latest/main/master/edge/stable/head/nightly) break reproducible deploys." >&2
        echo "  e.g. CONVEX_BACKEND_TAG=<commit-sha-tag>  (see .env.template for current pin)" >&2
        exit 1
        ;;
    esac
  done
}

require_prod_origins() {
  # Case-insensitive match — `Prod` / `PROD` / `production` should not skip
  # the guard. `production` is intentionally NOT accepted to keep the network
  # alias finite (callers should set CHAIN_NETWORK=prod, not production).
  local network="${CHAIN_NETWORK:-dev}"
  [[ "${network,,}" == "prod" ]] || return 0

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
