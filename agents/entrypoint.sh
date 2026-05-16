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
# the iptables calls inside init-firewall.sh fail. We log the failure but do
# NOT exit — a missing-cap dev container still needs to come up so the
# operator can debug. Production compose MUST set cap_add: [NET_ADMIN].
if [[ -x /opt/clan-world/init-firewall.sh ]]; then
  if ! sudo /opt/clan-world/init-firewall.sh; then
    echo "[entrypoint] WARNING: init-firewall.sh failed (likely missing CAP_NET_ADMIN). Continuing — egress NOT locked down." >&2
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
