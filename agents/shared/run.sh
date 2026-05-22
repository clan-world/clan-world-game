#!/usr/bin/env bash
# agents/shared/run.sh — canonical Elder container entrypoint
#
# Bind-mounted R/O at /opt/clan-world/shared/run.sh on every elder container.
# Invoked by agents/entrypoint.sh after the firewall init, and by
# `make reset-elder-N` / `make wipe-elder-N` via tmux new-session.
#
# Responsibilities:
#   1. Validate required per-elder env vars (CLAUDE_CODE_OAUTH_TOKEN, ELDER_ID,
#      CLAN_ID, BUS_ELDER_SECRET). Fail loud on missing — fail closed.
#   2. Bootstrap shared symlinks into /home/elder/.claude/ on first start so
#      settings.json + CLAUDE.md + skills/ resolve to the host-authored versions.
#   3. Detect whether a previous CC conversation exists for this CWD.
#   4. Exec `claude` with --continue when prior history exists, fresh otherwise.
#      Always append the shared system prompt via --append-system-prompt-file.
#
# Per-elder env vars are injected by docker compose's `env_file:` directive
# (sourced from agents/elder-N/.env — gitignored, templated by .env.template).
# The .env file is NOT bind-mounted into the container, so the agent's Bash
# tool cannot `cat /agent/.env`.
#
# NOTE on session resumption: per the round-4 design, --continue is the v1
# mechanism. Plan finding 11 calls for upgrading to explicit --resume <session-id>
# with a /home/elder/.session-id file. That upgrade ships as a follow-up;
# this script implements the round-4 --continue fallback.

set -euo pipefail

# --- required env validation -----------------------------------------------

# Fail-loud on missing identity/auth vars rather than silently launching an
# unauthenticated elder. Docker reports the container as unhealthy because
# `claude --` never enters the pgrep target.
missing=()
for var in CLAUDE_CODE_OAUTH_TOKEN ELDER_ID CLAN_ID; do
  if [ -z "${!var:-}" ]; then
    missing+=("$var")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "[run.sh] FATAL: required env vars not set: ${missing[*]}" >&2
  echo "[run.sh] Did you populate agents/elder-N/.env from .env.template before bring-up?" >&2
  exit 2
fi

# BUS_ELDER_SECRET is required for command-bus participation (#349/#415), but
# the v1 elder can boot and tick without it — the bus is opt-in via the elder
# CLI. Warn but do not abort if missing.
if [ -z "${BUS_ELDER_SECRET:-}" ]; then
  echo "[run.sh] WARNING: BUS_ELDER_SECRET unset — command-bus participation disabled. Set this in agents/elder-${ELDER_ID#elder-}/.env to enable." >&2
fi

# --- pin runtime paths -----------------------------------------------------

# Pin HOME + CC config dir so claude looks in the right place regardless of
# whoever invoked us.
export HOME=/home/elder
export CLAUDE_CONFIG_DIR=/home/elder/.claude

# --- bootstrap shared symlinks --------------------------------------------

# Shared CC harness state (settings.json + CLAUDE.md + skills/) is bind-mounted
# R/O at /opt/clan-world/shared/home-claude/. We symlink it into the per-elder
# /home/elder/.claude/ R/W volume so claude picks it up at the canonical path.
# Symlinks are re-created on every start (idempotent) so host-side edits take
# effect on container restart.
SHARED_HOME=/opt/clan-world/shared/home-claude
if [ -d "$SHARED_HOME" ]; then
  mkdir -p "$CLAUDE_CONFIG_DIR"
  for f in settings.json CLAUDE.md skills; do
    # ln -sfn replaces existing symlink or empty dir target atomically.
    ln -sfn "$SHARED_HOME/$f" "$CLAUDE_CONFIG_DIR/$f"
  done
else
  echo "[run.sh] WARNING: $SHARED_HOME not found — shared config not bind-mounted? Container will run without shared CLAUDE.md/settings.json/skills." >&2
fi

# --- session detection -----------------------------------------------------

# CC encodes the project path by replacing `/` with `-`, so /workspace -> -workspace.
# Sessions for the current CWD live under $CLAUDE_CONFIG_DIR/projects/<encoded>/sessions/.
# NOTE: this encoding is a best-effort match for CC's internal path-hash. If
# CC's algorithm drifts, --continue may fail to locate prior sessions and the
# elder starts fresh — recoverable, just loses continuity for one boot.
CWD_ENCODED="${PWD//\//-}"
SESSIONS_DIR="$CLAUDE_CONFIG_DIR/projects/${CWD_ENCODED}/sessions"

APPEND_PROMPT="/opt/clan-world/shared/APPENDED_SYSTEM_PROMPT.md"

# --- launch ----------------------------------------------------------------

if compgen -G "$SESSIONS_DIR/*.jsonl" > /dev/null 2>&1; then
  echo "[run.sh] previous conversation found at $SESSIONS_DIR, resuming with --continue"
  exec claude --continue --append-system-prompt-file "$APPEND_PROMPT"
else
  echo "[run.sh] no previous conversation at $SESSIONS_DIR, starting fresh"
  exec claude --append-system-prompt-file "$APPEND_PROMPT"
fi
