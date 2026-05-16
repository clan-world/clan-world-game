#!/usr/bin/env bash
# clan-world/agent:dev container entrypoint.
#
# Phase 1.2 of docs/plans/dockerize-elder-infra-v1.md.
#
# Runs as the `elder` non-root user (UID 1000). Calls the iptables egress
# lockdown via sudo (which is allowed only for /opt/clan-world/init-firewall.sh
# via /etc/sudoers.d/elder-firewall), creates a named tmux session, starts
# ttyd against it, starts the elder-runtime supervisor, then runs a foreground
# monitor loop that exits the container if any process dies.

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

# 1. Create named tmux session running run.sh (detached, working dir /workspace)
tmux new-session -d -s "${SESSION_NAME}" -c /workspace "/opt/clan-world/shared/run.sh"
echo "[entrypoint] tmux session ${SESSION_NAME} created"

# 2. Start ttyd attached to that session (background)
ttyd --port "${TTYD_PORT}" --writable tmux attach-session -t "${SESSION_NAME}" &
TTYD_PID=$!
echo "[entrypoint] ttyd started on port ${TTYD_PORT} (PID ${TTYD_PID})"

# 3. Start elder-runtime supervisor (background)
RUNTIME_PID=""
if command -v tsx &>/dev/null && [[ -f /opt/elder-runtime/src/main.ts ]]; then
  tsx /opt/elder-runtime/src/main.ts &
  RUNTIME_PID=$!
  # Wait up to 10s for supervisor to stay alive
  for i in $(seq 1 10); do
    sleep 1
    if kill -0 "${RUNTIME_PID}" 2>/dev/null; then
      echo "[entrypoint] elder-runtime started (PID ${RUNTIME_PID})"
      break
    fi
    if [[ $i -eq 10 ]]; then
      echo "[entrypoint] ERROR: elder-runtime (PID ${RUNTIME_PID}) died within 10s — aborting container" >&2
      exit 1
    fi
  done
else
  echo "[entrypoint] WARNING: elder-runtime not found — running without supervisor" >&2
fi

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
    echo "[entrypoint] elder-runtime (PID ${RUNTIME_PID}) died — exiting container" >&2
    exit 1
  fi
  sleep 5
done
