#!/usr/bin/env bash
# agents/shared/run.sh — canonical Elder container entrypoint
#
# Bind-mounted R/O at /opt/clan-world/shared/run.sh on every elder container.
# Invoked by agents/entrypoint.sh after the firewall init, and by
# `make reset-elder-N` / `make wipe-elder-N` via tmux new-session.
#
# Responsibilities:
#   1. Validate required per-elder env vars (CLAUDE_CODE_OAUTH_TOKEN, ELDER_ID,
#      CLAN_ID). Fail loud on missing identity/auth — fail closed.
#   2. Bootstrap shared symlinks into /home/elder/.claude/ on first start so
#      settings.json + CLAUDE.md + skills/ resolve to the host-authored versions.
#   3. Detect whether a previous CC conversation exists for this CWD.
#   4. Exec `claude` with --continue when prior history exists, fresh otherwise.
#      The runner may override auto-detection with CLAN_WORLD_CLAUDE_CONTINUE:
#      `always`, `never`, or `auto` (default).
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

# --- bootstrap shared CC harness state ------------------------------------

# Shared CC harness state lives at /opt/clan-world/shared/home-claude/ (R/O
# bind-mount). We bootstrap it into the per-elder /home/elder/.claude/ R/W
# named volume in two modes:
#
#   - settings.json + CLAUDE.md → SYMLINK to the bind-mounted source. Edits on
#     the host are picked up at the next container restart. Writes are denied
#     by the R/O source filesystem (defense-in-depth on top of settings.json's
#     own deny rules for Write(CLAUDE.md) / Edit(settings.json)).
#
#   - skills/ → COPY with no-clobber on first boot. Shared base skills land in
#     /home/elder/.claude/skills/ as real files (R/W) so the agent can add
#     per-elder runtime skills alongside the shared base, per the Phase 1.7
#     contract documented in agents/shared/home-claude/skills/README.md
#     ("Per-elder runtime skills authored by the agent itself live in
#     /home/elder/.claude/skills/ (R/W)"). On subsequent boots, no-clobber
#     preserves agent-authored skills; updated shared skills can be picked up
#     by `make wipe-elder-N` clearing the named volume.
SHARED_HOME=/opt/clan-world/shared/home-claude
if [ -d "$SHARED_HOME" ]; then
  mkdir -p "$CLAUDE_CONFIG_DIR"

  # File-level symlinks for settings.json + CLAUDE.md. Use `ln -sfn` which is
  # safe against an existing symlink, but `ln` cannot replace an existing real
  # file or directory — so we explicitly `rm -f` first (file-only; will refuse
  # to remove a directory, surfacing the misconfig if one exists).
  for f in settings.json CLAUDE.md; do
    target="$CLAUDE_CONFIG_DIR/$f"
    if [ -e "$target" ] && [ ! -L "$target" ]; then
      # Pre-existing real file (operator override?) — preserve it, log warning.
      echo "[run.sh] WARNING: $target exists as a real file, not symlinking to shared. Operator override or stale state from earlier image version." >&2
      continue
    fi
    rm -f "$target"
    ln -s "$SHARED_HOME/$f" "$target"
  done

  # Skills: copy with no-clobber so per-elder runtime additions coexist with
  # the shared base. `cp -rn` skips existing targets, so on container restart
  # we don't trample agent-authored skills.
  mkdir -p "$CLAUDE_CONFIG_DIR/skills"
  cp -rn "$SHARED_HOME/skills/." "$CLAUDE_CONFIG_DIR/skills/"
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
MCP_CONFIG="/opt/clan-world/shared/elder-mcp.json"

CLAUDE_ARGS=(--append-system-prompt-file "$APPEND_PROMPT")
if [ -f "$MCP_CONFIG" ]; then
  CLAUDE_ARGS=(--mcp-config "$MCP_CONFIG" "${CLAUDE_ARGS[@]}")
fi

# --- launch ----------------------------------------------------------------

CONTINUE_MODE="${CLAN_WORLD_CLAUDE_CONTINUE:-auto}"
if [ "$CONTINUE_MODE" = "always" ]; then
  echo "[run.sh] runner requested --continue"
  exec claude --continue "${CLAUDE_ARGS[@]}"
elif [ "$CONTINUE_MODE" = "never" ]; then
  echo "[run.sh] runner requested fresh session"
  exec claude "${CLAUDE_ARGS[@]}"
elif compgen -G "$SESSIONS_DIR/*.jsonl" > /dev/null 2>&1; then
  echo "[run.sh] previous conversation found at $SESSIONS_DIR, resuming with --continue"
  exec claude --continue "${CLAUDE_ARGS[@]}"
else
  echo "[run.sh] no previous conversation at $SESSIONS_DIR, starting fresh"
  exec claude "${CLAUDE_ARGS[@]}"
fi
