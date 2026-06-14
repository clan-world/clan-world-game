#!/usr/bin/env bash
# smoke-elder-memwal.sh — run INSIDE an Elder container to verify its Walrus
# Memory (MemWal) MCP wiring BEFORE trusting the live demo.
#
#   docker compose exec elder-1 /opt/clan-world/shared/scripts/walrus/smoke-elder-memwal.sh
#
# Checks 1-3 are automated. #4 is a manual check in the Elder's Claude session.
# The #1 demo-day risk is check 3 (egress): the Elder is network-sandboxed, and
# the MemWal MCP must reach the PUBLIC relayer — it works on the host but fails
# silently in-container if the egress allow-list omits relayer.memory.walrus.xyz.
set -uo pipefail
fail=0
RELAYER_HOST="relayer.memory.walrus.xyz"
CREDS="${HOME}/.memwal/credentials.json"

echo "[1/4] memwal-mcp on PATH..."
if command -v memwal-mcp >/dev/null 2>&1; then
  echo "  OK: $(command -v memwal-mcp)"
else
  echo "  FAIL: memwal-mcp not on PATH (Dockerfile must install @mysten-incubation/memwal-mcp)"; fail=1
fi

echo "[2/4] per-Elder credentials present + readable..."
if [ -r "$CREDS" ]; then
  acct=$(node -e "process.stdout.write(require('$CREDS').accountId||'')" 2>/dev/null \
        || python3 -c "import json;print(json.load(open('$CREDS'))['accountId'])" 2>/dev/null)
  echo "  OK: accountId=${acct:-<unparsed>}  (ELDER_N=${ELDER_N:-?})"
  echo "      ^ confirm this accountId is DISTINCT per Elder — identical creds across"
  echo "        containers collapses all Elders into one MemWal identity."
else
  echo "  FAIL: $CREDS missing/unreadable (mount per-Elder credentials.json here)"; fail=1
fi

echo "[3/4] egress to ${RELAYER_HOST} (THE #1 demo-day risk)..."
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://${RELAYER_HOST}/health" 2>/dev/null || echo "000")
if [ "$code" != "000" ]; then
  echo "  OK: relayer reachable over HTTPS (HTTP $code)"
else
  echo "  FAIL: ${RELAYER_HOST} UNREACHABLE from this container."
  echo "        → add ${RELAYER_HOST} to the Elder egress allow-list (docker/caddy lane)."
  fail=1
fi

echo "[4/4] MANUAL: in the Elder's Claude session, confirm tools"
echo "      mcp__memwal__memwal_remember / mcp__memwal__memwal_recall are visible,"
echo "      then run one tagged remember -> recall round-trip."

if [ "$fail" -eq 0 ]; then
  echo "SMOKE PASS (checks 1-3) — proceed to the manual round-trip."
else
  echo "SMOKE FAIL — fix the FAIL line(s) above before the demo."
fi
exit "$fail"
