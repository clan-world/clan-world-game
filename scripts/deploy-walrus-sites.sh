#!/usr/bin/env bash
# Deploy the ClanWorld site to Walrus, with the free-mint app nested at /mint.
#
# The game (apps/web) is served at the site root; the mint app (apps/mint, built
# with base=/mint/) is nested under /mint. Both are SPAs, so ws-resources.json
# routes /mint/* -> /mint/index.html (more specific, matched first) and /* ->
# /index.html. Everything lands in ONE Walrus Site object so it's reachable at
# clanworld.wal.app and clanworld.wal.app/mint — no second SuiNS name needed.
#
# Required env:
#   VITE_CONVEX_URL, VITE_CLANWORLD_DEMO_MODE, VITE_CLAN_WORLD_CONTRACT_ADDRESS
#     -> for apps/web (pull from Vercel prod: `vercel env pull --environment=production`)
#   VITE_DYNAMIC_ENVIRONMENT_ID
#     -> for apps/mint (Dynamic dashboard)
# Requires: pnpm, site-builder (mainnet config at ~/.config/walrus/sites-config.yaml).
set -euo pipefail

# Fail fast if required build-time env vars are missing — an empty value would
# otherwise bake a broken site (mint wallet dead / game can't reach Convex).
: "${VITE_DYNAMIC_ENVIRONMENT_ID:?set VITE_DYNAMIC_ENVIRONMENT_ID before deploying (apps/mint)}"
: "${VITE_CONVEX_URL:?set VITE_CONVEX_URL before deploying (apps/web)}"

SITE_OBJECT="${SITE_OBJECT:-0x407f079c2f235a588546008550ce1f479fce8a0ad10525ab17802cc63adce125}"
EPOCHS="${EPOCHS:-5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMBINED="$(mktemp -d)/clanworld-site"
trap 'rm -rf "$(dirname "$COMBINED")"' EXIT

echo "[1/5] build game (apps/web)…"
pnpm --filter @clan-world/web build

echo "[2/5] build mint app (apps/mint, base=/mint/)…"
pnpm --filter @clan-world/mint build

echo "[3/5] assemble combined dist at $COMBINED…"
mkdir -p "$COMBINED"
cp -r "$ROOT/apps/web/dist/." "$COMBINED/"
rm -rf "$COMBINED/mint"
cp -r "$ROOT/apps/mint/dist" "$COMBINED/mint"

echo "[4/5] write combined ws-resources.json (/mint/* before /*)…"
cat > "$COMBINED/ws-resources.json" <<'JSON'
{
  "routes": {
    "/mint": "/mint/index.html",
    "/mint/*": "/mint/index.html",
    "/*": "/index.html"
  }
}
JSON

echo "[5/5] deploy to Walrus Site $SITE_OBJECT (--epochs $EPOCHS)…"
site-builder --config "$HOME/.config/walrus/sites-config.yaml" --context mainnet \
  deploy "$COMBINED" --object-id "$SITE_OBJECT" --epochs "$EPOCHS"

echo "Done. Game: https://clanworld.wal.app/   Mint: https://clanworld.wal.app/mint"
