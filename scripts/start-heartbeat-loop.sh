#!/usr/bin/env bash
# Thin compatibility launcher for the TypeScript heartbeat scheduler.
# The scheduler reads heartbeatIntervalSeconds() once at boot and schedules
# from getWorldState().nextHeartbeatAtTs; do not add timing logic here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

exec pnpm --filter @clan-world/heartbeat heartbeat
