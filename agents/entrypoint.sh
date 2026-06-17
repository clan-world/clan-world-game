#!/usr/bin/env bash
# clan-world/agent:dev container entrypoint.
#
# Phase 1.2 of docs/plans/dockerize-elder-infra-v1.md.
#
# Runs as the `elder` non-root user (UID 1000). Calls the iptables egress
# lockdown via sudo (which is allowed only for /opt/clan-world/init-firewall.sh
# via /etc/sudoers.d/elder-firewall), starts the runner, then runs a foreground
# monitor loop that exits the container if any process dies. The runner owns
# tmux + claude launch so it can enforce memory-wipe recovery before any
# `claude --continue` happens.

set -euo pipefail

ELDER_N="${ELDER_N:?ELDER_N required (1..4)}"
SESSION_NAME="elder-${ELDER_N}"
TTYD_PORT="${TTYD_PORT:-7681}"

# Apply egress firewall. Requires CAP_NET_ADMIN on the container; without it,
# the iptables calls inside init-firewall.sh fail. We FAIL CLOSED by default —
# autonomous elders MUST run with egress restrictions. The operator can
# explicitly opt out of the firewall (for missing-cap local debugging or for
# dev containers without iptables modules in the kernel) by setting
# `ALLOW_UNRESTRICTED_EGRESS=1` in the container environment. The override is
# checked BEFORE invoking the firewall script — so debug operators don't get
# the firewall applied even when iptables would have succeeded.
if [[ "${ALLOW_UNRESTRICTED_EGRESS:-0}" = "1" ]]; then
  echo "[entrypoint] WARNING: ALLOW_UNRESTRICTED_EGRESS=1 — skipping init-firewall.sh entirely. Container will have UNRESTRICTED egress. DO NOT use in production." >&2
elif [[ -x /opt/clan-world/init-firewall.sh ]]; then
  if ! sudo /opt/clan-world/init-firewall.sh; then
    echo "[entrypoint] FATAL: init-firewall.sh failed (likely missing CAP_NET_ADMIN). Set ALLOW_UNRESTRICTED_EGRESS=1 to override for local debugging." >&2
    exit 3
  fi
else
  echo "[entrypoint] FATAL: /opt/clan-world/init-firewall.sh missing and ALLOW_UNRESTRICTED_EGRESS not set. Image misbuild?" >&2
  exit 3
fi

# Clear any session inherited from a previous entrypoint invocation in the same
# container. The runner will recreate it after its local invariants are checked.
tmux kill-session -t "${SESSION_NAME}" 2>/dev/null || true

# 1. Start elder-runner (background). It creates tmux and launches claude.
READY_FILE="${CLAN_WORLD_RUNNER_STATE_DIR:-/home/elder/.runner-state}/elder-runtime.ready"
RUNTIME_PID=""
if command -v tsx &>/dev/null && [[ -f /opt/elder-runtime/src/main.ts ]]; then
  rm -f "${READY_FILE}"
  tsx /opt/elder-runtime/src/main.ts &
  RUNTIME_PID=$!
  for i in $(seq 1 45); do
    sleep 1
    if [[ -f "${READY_FILE}" ]]; then
      echo "[entrypoint] elder-runner ready (file=${READY_FILE})"
      break
    fi
    if [[ $i -eq 45 ]]; then
      echo "[entrypoint] ERROR: elder-runner did not become ready in 45s — aborting" >&2
      exit 1
    fi
  done
else
  echo "[entrypoint] FATAL: elder-runner not found at /opt/elder-runtime/src/main.ts" >&2
  exit 1
fi

# 2. Start ttyd attached to the runner-created tmux session (background).
# READ-ONLY (no --writable): operator input goes through the /api/admin/* endpoint
# (Bundle 4 PR6), which goes through the runner's two-phase commit so receipts are
# logged. Allowing direct terminal input would bypass tickSendLog/tickReceiveLog
# accounting and break the runner's delivery confirmation. Super-swarm R1 codex
# 5.5 HIGH — see docs/reviews/pr576-synthesis.md.
if [[ "${ADMIN_INJECT_ENABLED:-0}" != "1" ]]; then
  echo "[entrypoint] WARNING: ttyd is read-only and ADMIN_INJECT_ENABLED!=1. Operator input has NO channel. Set ADMIN_INJECT_ENABLED=1 once /api/admin/inject-message is deployed to prod." >&2
fi
# `-t fontSize=11` is an xterm.js client option (ttyd passes -t/--client-option
# values straight through to the in-browser terminal). ttyd's default is 15px,
# which only fits a handful of lines in each of the 4 cockpit elder terminals.
# Dropping to 11px roughly doubles the visible rows/cols without becoming
# unreadable. NOTE: this is a ttyd *server* launch flag — it only takes effect
# after the elder containers are rebuilt/restarted (the running ttyd process
# does not pick up the new flag).
ttyd --port "${TTYD_PORT}" -t fontSize=11 tmux attach-session -t "${SESSION_NAME}" &
TTYD_PID=$!
echo "[entrypoint] ttyd started on port ${TTYD_PORT} (PID ${TTYD_PID})"

# 3. ttyd-refresh loop. Background tick that forces tmux to fully redraw
# every attached client every 2s, so a browser that (re)connects sees the
# live alt-screen frame instead of ttyd's stale replay buffer (which only
# contains the rename+color slash commands echoed before claude entered the
# alternate screen at session start).
#
# IMPORTANT: refresh-client takes a *client* target, not a session, and a
# bare `-S` refreshes ONLY the status line (per tmux(1)) — neither repaints
# the pane. We therefore enumerate the clients attached to this session and
# issue a full (no-flag) refresh-client to each, which re-emits the complete
# grid downstream to ttyd. When no browser is connected there are no clients
# and the inner loop is a no-op.
# Root cause docs: research/ttyd-reset-display-bug-2026-05-25.md.
while true; do
  while IFS= read -r _client; do
    [ -n "${_client}" ] && tmux refresh-client -t "${_client}" 2>/dev/null || true
  done < <(tmux list-clients -t "${SESSION_NAME}" -F '#{client_name}' 2>/dev/null)
  sleep 2
done &
REFRESH_PID=$!
echo "[entrypoint] ttyd-refresh loop started (PID ${REFRESH_PID})"

# 4. Foreground monitor loop — exit container if any process dies.
# compose restart: on-failure will restart the whole container.
while true; do
  if ! tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
    echo "[entrypoint] tmux session ${SESSION_NAME} died — exiting container" >&2
    exit 1
  fi
  if ! kill -0 "${TTYD_PID}" 2>/dev/null; then
    echo "[entrypoint] ttyd (PID ${TTYD_PID}) died — exiting container" >&2
    exit 1
  fi
  if [[ -n "${RUNTIME_PID}" ]] && ! kill -0 "${RUNTIME_PID}" 2>/dev/null; then
    echo "[entrypoint] elder-runner (PID ${RUNTIME_PID}) died — exiting container" >&2
    exit 1
  fi
  if [[ -n "${REFRESH_PID:-}" ]] && ! kill -0 "${REFRESH_PID}" 2>/dev/null; then
    echo "[entrypoint] WARNING: ttyd-refresh loop (PID ${REFRESH_PID}) died — display may show stale frame on reconnect" >&2
    REFRESH_PID=""
  fi
  sleep 5
done
