#!/usr/bin/env bash
# agents/shared/run.sh — canonical Elder container entrypoint
#
# Bind-mounted R/O at /opt/clan-world/run.sh on every elder container. Invoked
# by the container ENTRYPOINT (after the firewall init in Phase 1.2) and by
# `make reset-elder-N` / `make wipe-elder-N` via tmux new-session.
#
# Responsibilities:
#   1. Load per-elder env (ANTHROPIC_OAUTH_TOKEN, ELDER_ID, CLAN_ID, BUS_ELDER_SECRET)
#   2. Detect whether a previous CC conversation exists for this CWD
#   3. Exec `claude` with --continue when prior history exists, fresh otherwise
#   4. Always append the shared system prompt via --append-system-prompt-file
#
# NOTE on session resumption: per the round-4 design, --continue is the v1
# mechanism. Plan finding 11 calls for upgrading to explicit --resume <session-id>
# with a /home/elder/.session-id file. That upgrade ships as a follow-up;
# this script implements the round-4 --continue fallback.

set -euo pipefail

# --- env -------------------------------------------------------------------

# Per-elder secrets are mounted at /agent/.env by docker compose (env_file).
# If that's not present we still try /home/elder/.env as a fallback for
# tmux-driven local restarts where compose env_file isn't re-evaluated.
if [ -f /agent/.env ]; then
  # shellcheck disable=SC1091
  source /agent/.env
elif [ -f /home/elder/.env ]; then
  # shellcheck disable=SC1091
  source /home/elder/.env
fi

# Pin HOME + CC config dir so claude looks in the right place regardless of
# whoever invoked us.
export HOME=/home/elder
export CLAUDE_CONFIG_DIR=/home/elder/.claude

# --- session detection -----------------------------------------------------

# CC encodes the project path by replacing `/` with `-`, so /workspace -> -workspace.
# Sessions for the current CWD live under $CLAUDE_CONFIG_DIR/projects/<encoded>/sessions/.
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
