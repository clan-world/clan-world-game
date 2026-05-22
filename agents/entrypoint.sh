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
# `ALLOW_UNRESTRICTED_EGRESS=1` in the container environment.
if [[ -x /opt/clan-world/init-firewall.sh ]]; then
  if ! sudo /opt/clan-world/init-firewall.sh; then
    if [[ "${ALLOW_UNRESTRICTED_EGRESS:-0}" = "1" ]]; then
      echo "[entrypoint] WARNING: init-firewall.sh failed but ALLOW_UNRESTRICTED_EGRESS=1 — continuing without egress lockdown. DO NOT use in production." >&2
    else
      echo "[entrypoint] FATAL: init-firewall.sh failed (likely missing CAP_NET_ADMIN). Set ALLOW_UNRESTRICTED_EGRESS=1 to override for local debugging." >&2
      exit 3
    fi
  fi
else
  # No firewall script available at all — same fail-closed posture.
  if [[ "${ALLOW_UNRESTRICTED_EGRESS:-0}" = "1" ]]; then
    echo "[entrypoint] WARNING: /opt/clan-world/init-firewall.sh missing but ALLOW_UNRESTRICTED_EGRESS=1 — continuing without egress lockdown." >&2
  else
    echo "[entrypoint] FATAL: /opt/clan-world/init-firewall.sh missing and ALLOW_UNRESTRICTED_EGRESS not set. Image misbuild?" >&2
    exit 3
  fi
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
