#!/usr/bin/env bash
# clan-world/agent:dev container entrypoint.
#
# Phase 1.2 of docs/plans/dockerize-elder-infra-v1.md.
#
# Runs as the `elder` non-root user (UID 1000). Calls the iptables egress
# lockdown via sudo (which is allowed only for /opt/clan-world/init-firewall.sh
# via /etc/sudoers.d/elder-firewall), then hands off to the canonical run.sh
# from the bind-mounted shared tree at /opt/clan-world/shared/run.sh.

set -euo pipefail

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

# Start elder-runtime supervisor in background (Phase 1.9, issue #352).
# tsx + source are copied into /opt/elder-runtime/ by the Dockerfile.
# tini (PID 1) will reap it if it exits; we log failure but don't abort container.
if command -v tsx &>/dev/null && [[ -f /opt/elder-runtime/src/main.ts ]]; then
  tsx /opt/elder-runtime/src/main.ts &
  RUNTIME_PID=$!
  # Wait up to 10s for process to stay alive
  for i in $(seq 1 10); do
    sleep 1
    if kill -0 "$RUNTIME_PID" 2>/dev/null; then
      echo "[entrypoint] elder-runtime started (PID $RUNTIME_PID)"
      break
    fi
    if [[ $i -eq 10 ]]; then
      echo "[entrypoint] ERROR: elder-runtime (PID $RUNTIME_PID) died within 10s — aborting container" >&2
      exit 1
    fi
  done
else
  echo "[entrypoint] elder-runtime not found at /opt/elder-runtime/src/main.ts — skipping (Phase 1.9 not built)" >&2
fi

# Hand off to run.sh from the shared bind-mount. run.sh is owned by Phase 1.7
# (issue #350); for v1, if the mount is missing we fall back to an interactive
# bash so the operator can introspect.
if [[ -x /opt/clan-world/shared/run.sh ]]; then
  exec /opt/clan-world/shared/run.sh
else
  echo "[entrypoint] /opt/clan-world/shared/run.sh not found — Phase 1.7 not yet wired. Dropping to interactive bash." >&2
  exec /bin/bash
fi
