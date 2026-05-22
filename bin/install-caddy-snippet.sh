#!/usr/bin/env bash
# install-caddy-snippet.sh — idempotently install the clan-world caddy
# subroute snippet into the host caddy config.
#
# Adds ONE `import <repo>/agents/shared/caddy.conf` line to
# /etc/caddy/Caddyfile (with a timestamped backup), validates the
# resulting config, and reloads caddy via systemctl.
#
# Usage:
#   bin/install-caddy-snippet.sh             # install (idempotent)
#   bin/install-caddy-snippet.sh --check     # dry-run; report-only
#   bin/install-caddy-snippet.sh --uninstall # remove the import line
#
# Exit codes:
#   0  success / already installed
#   1  caddy validate failed
#   2  caddyfile missing or unwritable
#   3  uninstall requested but import not present
#   4  caddy reload failed

set -euo pipefail

readonly CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT
readonly SNIPPET_PATH="${REPO_ROOT}/agents/shared/caddy.conf"
readonly IMPORT_LINE="import ${SNIPPET_PATH}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
readonly TIMESTAMP

MODE="install"
if [[ "${1:-}" == "--check" ]]; then MODE="check"; fi
if [[ "${1:-}" == "--uninstall" ]]; then MODE="uninstall"; fi

log() { printf '[install-caddy-snippet] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit "${2:-1}"; }

# --- Preflight ---------------------------------------------------------

[[ -f "${SNIPPET_PATH}" ]] || die "snippet not found: ${SNIPPET_PATH}"
[[ -f "${CADDYFILE}" ]]    || die "host Caddyfile missing: ${CADDYFILE}" 2

if ! command -v caddy >/dev/null 2>&1; then
    die "caddy binary not in PATH"
fi

# --- Detect existing import -------------------------------------------

if grep -Fxq "${IMPORT_LINE}" "${CADDYFILE}"; then
    ALREADY_INSTALLED=1
else
    ALREADY_INSTALLED=0
fi

# --- --check ----------------------------------------------------------

if [[ "${MODE}" == "check" ]]; then
    if [[ "${ALREADY_INSTALLED}" -eq 1 ]]; then
        log "INSTALLED: '${IMPORT_LINE}' is present in ${CADDYFILE}"
    else
        log "NOT INSTALLED: '${IMPORT_LINE}' is missing from ${CADDYFILE}"
    fi
    log "Validating snippet on its own..."
    if caddy validate --config "${SNIPPET_PATH}" --adapter caddyfile >/dev/null 2>&1; then
        log "  snippet validates OK"
    else
        log "  snippet FAILS validation"
    fi
    log "Validating current host Caddyfile (via sudo)..."
    if sudo caddy validate --config "${CADDYFILE}" >/dev/null 2>&1; then
        log "  host Caddyfile validates OK"
    else
        log "  host Caddyfile FAILS validation (run \`sudo caddy validate --config ${CADDYFILE}\` for details)"
    fi
    exit 0
fi

# --- --uninstall ------------------------------------------------------

if [[ "${MODE}" == "uninstall" ]]; then
    if [[ "${ALREADY_INSTALLED}" -eq 0 ]]; then
        log "import line not present — nothing to uninstall"
        exit 3
    fi
    backup="${CADDYFILE}.bak.${TIMESTAMP}.pre-uninstall"
    log "backing up ${CADDYFILE} → ${backup}"
    sudo cp -p "${CADDYFILE}" "${backup}"
    log "removing import line from ${CADDYFILE}"
    sudo sed -i "\|^${IMPORT_LINE}$|d" "${CADDYFILE}"
    log "validating result..."
    if ! sudo caddy validate --config "${CADDYFILE}" >/dev/null 2>&1; then
        log "validation FAILED after uninstall — restoring backup"
        sudo cp -p "${backup}" "${CADDYFILE}"
        die "validation failed; original restored" 1
    fi
    log "reloading caddy..."
    sudo systemctl reload caddy || die "systemctl reload caddy failed" 4
    log "DONE: uninstall complete"
    exit 0
fi

# --- install (idempotent) ---------------------------------------------

if [[ "${ALREADY_INSTALLED}" -eq 1 ]]; then
    log "already installed — no changes to ${CADDYFILE}"
    log "validating current config anyway..."
    sudo caddy validate --config "${CADDYFILE}" >/dev/null \
        || die "current Caddyfile fails validation" 1
    log "OK"
    exit 0
fi

# Pre-flight: snippet must validate before we touch the host file.
log "pre-flight: validating snippet ${SNIPPET_PATH}"
if ! caddy validate --config "${SNIPPET_PATH}" --adapter caddyfile >/dev/null 2>&1; then
    caddy validate --config "${SNIPPET_PATH}" --adapter caddyfile 2>&1 | tail -20 >&2
    die "snippet failed validation; refusing to install" 1
fi

backup="${CADDYFILE}.bak.${TIMESTAMP}.pre-clan-world-import"
log "backing up ${CADDYFILE} → ${backup}"
sudo cp -p "${CADDYFILE}" "${backup}"

log "appending import line to ${CADDYFILE}"
# Append AFTER the global options block (line 1-N) — caddy allows imports
# at the file top level. Appending at the end is simplest + safest.
echo "" | sudo tee -a "${CADDYFILE}" >/dev/null
echo "${IMPORT_LINE}" | sudo tee -a "${CADDYFILE}" >/dev/null

log "validating combined config..."
if ! sudo caddy validate --config "${CADDYFILE}" >/dev/null 2>&1; then
    log "combined config FAILED validation — restoring backup"
    sudo cp -p "${backup}" "${CADDYFILE}"
    sudo caddy validate --config "${CADDYFILE}" 2>&1 | tail -20 >&2 || true
    die "validation failed; original restored" 1
fi

log "reloading caddy..."
if ! sudo systemctl reload caddy; then
    log "reload FAILED — restoring backup"
    sudo cp -p "${backup}" "${CADDYFILE}"
    sudo systemctl reload caddy || true
    die "systemctl reload caddy failed; original restored" 4
fi

log "DONE: install complete"
log "  backup: ${backup}"
log "  import: ${IMPORT_LINE}"
