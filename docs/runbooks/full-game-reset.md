# Clan World — Full Game Reset Runbook

Use this when we want a totally fresh live realm: new Base Sepolia diamond, backup diamond, empty Convex state, regenerated contract artifacts, restarted heartbeat/runner/Elder sessions, and a fresh frontend deploy.

> **Considering a less invasive reset?** If the diamond ABI hasn't changed and you only need to revive dead clansmen + restock vaults mid-season, use `docs/runbooks/soft-game-reset.md` instead. That's faster and preserves clan IDs / owner addresses / season number.

This is the "do the whole reset now" checklist. For deeper setup details, see:

- `docs/runbooks/fresh-vps-bootstrap.md`
- `docs/runbooks/base-sepolia-deployment.md`
- `docs/runbooks/diamond-migration.md`
- `docs/guides/stream-ops.md`

## Reset Inputs

Record these before touching live state:

```bash
export RPC_URL_PRIMARY="https://base-sepolia.infura.io/v3/<key>"
export SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=<key>"
export DEPLOYER_PRIVATE_KEY="0x..."
export INDEXER_SECRET="..."
export WEBHOOK_SHARED_SECRET="..."
```

The active reset on 2026-05-11 used Infura for Base Sepolia and Helius for Solana reads.

## 0. Preflight

1. Work from a clean checkout on `main`.
2. Confirm `pnpm install --frozen-lockfile`, `forge build`, and `pnpm typecheck` are green.
3. Confirm these CLIs are authenticated or available: `forge`, `cast`, `pnpm`, `npx convex`, `vercel`, `tmux`, `jq`, `curl`.
4. Check deployer and elder wallet balances on Base Sepolia.
5. Confirm Convex deployment slug and app URLs.
6. Save the current active diamond, lens, deploy block, and git commit in the reset notes.
7. Confirm whether the live Elder Claude Code sessions have account capacity.
   If they are at the monthly usage limit, pause the game loop after reset and
   run only the read-only terminals until capacity resets.

## 1. Stop Live Writers

Stop anything that can send deployer-wallet txs or write stale state while the reset is underway:

```bash
tmux kill-session -t clanworld-heartbeat 2>/dev/null || true
tmux kill-session -t clanworld-runner 2>/dev/null || true
tmux kill-session -t clanworld-finalize 2>/dev/null || true

for n in 1 2 3 4; do
  tmux kill-session -t "elder-$n" 2>/dev/null || true
  tmux kill-session -t "clanworld-elder-$n" 2>/dev/null || true
done
```

Disable Convex cron writers before flushing or waiting. Deploy the functions
after changing these envs so cron registration reflects the paused state:

```bash
cd apps/server
npx convex env set CLANWORLD_USE_REAL_INDEXER false --prod
npx convex env set CLANWORLD_USE_FAKE_HEARTBEAT false --prod
npx convex env set CLANWORLD_RESET_LOCK true --prod
npx convex deploy --prod
```

Wait at least one heartbeat interval after stopping heartbeat before deploying,
or confirm `getWorldState().nextHeartbeatAtTs` is safely in the past, so any
in-flight nonce settles.

## 2. Deploy Active And Backup Diamonds

Deploy the active diamond:

```bash
cd packages/contracts
forge build
forge script script/Deploy.s.sol \
  --rpc-url "$RPC_URL_PRIMARY" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --slow
```

Before broadcasting, check deployable bytecode sizes. `--disable-code-size-limit`
only helps local simulation; Base Sepolia still rejects oversized deployed
libraries/facets under EIP-170.

```bash
cd packages/contracts
forge build --sizes
```

Save:

- Diamond address
- Lens address
- Deploy transaction hash
- Deploy block number
- Facet addresses

Then run the same deploy command again for the backup diamond and save the same values. Do not point Convex or the frontend at the backup unless the active diamond fails.

Learning from the 2026-05-11 reset: the deploy blocker was
`LibBanditLifecycle`, not the diamond proxy. It exceeded EIP-170 as a deployed
library. Split oversized libraries/facets before broadcasting; do not rely on
`--disable-code-size-limit`.

## 3. Wire Local Env

Update local runtime env files:

```bash
export CLAN_WORLD_CONTRACT_ADDRESS="0x<active-diamond>"
export CLAN_WORLD_LENS_ADDRESS="0x<active-lens>"
export INDEXER_START_BLOCK="<active-deploy-block>"

# Root runtime env
perl -0pi -e 's/^RPC_URL_PRIMARY=.*/RPC_URL_PRIMARY=$ENV{RPC_URL_PRIMARY}/m' .env.local
perl -0pi -e 's/^SOLANA_RPC_URL=.*/SOLANA_RPC_URL=$ENV{SOLANA_RPC_URL}/m' .env.local
perl -0pi -e 's/^CLAN_WORLD_CONTRACT_ADDRESS=.*/CLAN_WORLD_CONTRACT_ADDRESS=$ENV{CLAN_WORLD_CONTRACT_ADDRESS}/m' .env.local
perl -0pi -e 's/^CLAN_WORLD_LENS_ADDRESS=.*/CLAN_WORLD_LENS_ADDRESS=$ENV{CLAN_WORLD_LENS_ADDRESS}/m' .env.local

# Elder runtime dirs, if present
for n in 1 2 3 4; do
  test -f "$HOME/clan-world/elder-$n/.env" || continue
  perl -0pi -e 's/^RPC_URL_PRIMARY=.*/RPC_URL_PRIMARY=$ENV{RPC_URL_PRIMARY}/m' "$HOME/clan-world/elder-$n/.env"
  perl -0pi -e 's/^CLAN_WORLD_CONTRACT_ADDRESS=.*/CLAN_WORLD_CONTRACT_ADDRESS=$ENV{CLAN_WORLD_CONTRACT_ADDRESS}/m' "$HOME/clan-world/elder-$n/.env"
done
```

If an env key is missing, add it rather than leaving an old default in place.

## 4. Regenerate Artifacts And Types

Refresh contract outputs and TypeScript generated files after the deploy source is final:

```bash
pnpm gen:contract-abi
pnpm gen:chainclient-abi
pnpm --filter @clan-world/server codegen
pnpm typecheck
```

Commit any generated ABI/type changes before redeploying the app.

## 5. Reconfigure And Flush Convex

Set Convex env values together. Use `--prod` only for the production
deployment; for the current V3 dev deployment (`valuable-kudu-985`), omit
`--prod`.

```bash
cd apps/server
npx convex env set RPC_URL_PRIMARY "$RPC_URL_PRIMARY" --prod
npx convex env set SOLANA_RPC_URL "$SOLANA_RPC_URL" --prod
npx convex env set CLAN_WORLD_CONTRACT_ADDRESS "$CLAN_WORLD_CONTRACT_ADDRESS" --prod
npx convex env set CLAN_WORLD_LENS_ADDRESS "$CLAN_WORLD_LENS_ADDRESS" --prod
npx convex env set INDEXER_START_BLOCK "$INDEXER_START_BLOCK" --prod
npx convex env set CLANWORLD_USE_REAL_INDEXER false --prod
npx convex env set CLANWORLD_USE_FAKE_HEARTBEAT false --prod
npx convex env set CLANWORLD_RESET_LOCK true --prod
npx convex env set WEBHOOK_SHARED_SECRET "$WEBHOOK_SHARED_SECRET" --prod
npx convex deploy --prod
```

Flush all game/indexer state for the old realm. At minimum clear:

- `worldSnapshot`
- `chainEvents`
- `tickHistory`
- `eventCheckpoint`
- `clanView`
- `marketState`
- `banditView`
- `pricePoint`
- `goldQuote`
- `goldQuoteSample`
- `kickstartTokens`
- `kickstartWatchedTokens`
- `agentLogs`
- `memoryEntries`
- `bulletins`
- `memoryEvents`
- `whispers`
- `orchEvents`
- `humanSteeringMessages`

Then trigger one indexer refresh or wait for the first heartbeat webhook.

If the deployed backend includes `ops:flushGameState`, loop it until `complete`
is `true`, then reset the checkpoint once:

```bash
while true; do
  out=$(npx convex run ops:flushGameState \
    '{"secret":"'"$INDEXER_SECRET"'","batchSize":400}' \
    --prod)
  echo "$out"
  echo "$out" | grep -q '"complete": true' && break
done

npx convex run ops:resetCheckpoint '{"secret":"'"$INDEXER_SECRET"'","lastBlock":'"$INDEXER_START_BLOCK"'}' --prod
```

`ops:flushGameState` is capped at 400 rows per table and 9,000 total deletes
per mutation on purpose, to stay inside Convex mutation limits. It returns
`deletedAny` plus `complete`; `complete` can become true on the same call that
deletes the final rows. Expect old append-only views to require many passes.

If `clanView` has a large historical backlog, use the targeted per-clan purge
helper in parallel and include all historical clan ids, not only the fresh four:

```bash
for clan_id in 1 2 3 4 5 6 7 8; do
  (
    while true; do
      out=$(npx convex run ops:flushClanViewForClan \
        '{"secret":"'"$INDEXER_SECRET"'","clanId":'"$clan_id"',"batchSize":500}' \
        --prod)
      echo "$out"
      echo "$out" | grep -q '"complete": true' && break
    done
  ) &
done
wait
```

After the flush is complete, reset the checkpoint, unlock the indexer, redeploy
functions so crons are registered with the final env, and force one snapshot:

```bash
npx convex run ops:resetCheckpoint '{"secret":"'"$INDEXER_SECRET"'","lastBlock":'"$INDEXER_START_BLOCK"'}' --prod
npx convex env set CLANWORLD_USE_REAL_INDEXER true --prod
npx convex env set CLANWORLD_RESET_LOCK false --prod
npx convex deploy --prod
npx convex run indexer:refreshSnapshot '{}' --prod
```

If `indexer:refreshSnapshot` times out in `commitSnapshot`, check whether it is
probing stale clan ids. The 2026-05-11 reset fixed this by reading
`getClanIds()` first and refreshing only live clans.

## 6. Mint Four Clans

Derive or load the four elder addresses, then mint one clan per elder:

```bash
for owner in "$ELDER_1_ADDRESS" "$ELDER_2_ADDRESS" "$ELDER_3_ADDRESS" "$ELDER_4_ADDRESS"; do
  cast send "$CLAN_WORLD_CONTRACT_ADDRESS" "mintClan(address)" "$owner" \
    --rpc-url "$RPC_URL_PRIMARY" \
    --private-key "$DEPLOYER_PRIVATE_KEY"
done
```

> **Replay/fork revive ordering:** On a forked or replayed diamond, clans may already exist and their clansmen may already be dead. If so, inject enough wheat + fish **before** calling `reviveDeadClansmen`; an empty vault lets the next heartbeat starve revived clansmen again within 1-2 ticks.

```bash
for clan_id in 1 2 3 4; do
  cast send "$CLAN_WORLD_CONTRACT_ADDRESS" "injectClanResources(uint32,uint256,uint256,uint256,uint256,uint256,uint256)" \
    "$clan_id" 0 0 100e18 10e18 0 0 \
    --rpc-url "$RPC_URL_PRIMARY" \
    --private-key "$DEPLOYER_PRIVATE_KEY"
  cast send "$CLAN_WORLD_CONTRACT_ADDRESS" "reviveDeadClansmen(uint32)" "$clan_id" \
    --rpc-url "$RPC_URL_PRIMARY" \
    --private-key "$DEPLOYER_PRIVATE_KEY"
done
```

If the demo needs clansmen immediately, spawn the expected starting units after minting:

```bash
for clan_id in 1 2 3 4; do
  for i in 1 2 3 4; do
    cast send "$CLAN_WORLD_CONTRACT_ADDRESS" "spawnClansman(uint32,uint32)" "$clan_id" "$i" \
      --rpc-url "$RPC_URL_PRIMARY" \
      --private-key "$DEPLOYER_PRIVATE_KEY"
  done
done
```

Verify:

```bash
cast call "$CLAN_WORLD_CONTRACT_ADDRESS" "getClanIds()(uint32[])" --rpc-url "$RPC_URL_PRIMARY"
```

## 7. Restart Heartbeat, Runner, Elders, And TTYD

Restart heartbeat:

```bash
tmux new-session -d -s clanworld-heartbeat -c "$PWD" \
  'bash scripts/start-heartbeat-loop.sh 2>&1 | tee -a /tmp/clanworld-heartbeat.log'
```

Restart runner and four Elder sessions using the current package scripts or host wrappers. Confirm each new process reads the new `.env.local` / elder `.env` values.

For TTYD in the public cockpit, match Caddy, not only `port-for`. As of the
2026-05-11 host config, `https://cockpit.clan-world.com/elder-N-tty/` proxies
to:

| Elder | Public path | Local upstream |
|---|---|---|
| 1 | `/elder-1-tty/` | `127.0.0.1:38790` |
| 2 | `/elder-2-tty/` | `127.0.0.1:38791` |
| 3 | `/elder-3-tty/` | `127.0.0.1:38792` |
| 4 | `/elder-4-tty/` | `127.0.0.1:38793` |

Start read-only terminal mirrors:

```bash
for n in 1 2 3 4; do
  tmux has-session -t "elder-$n" 2>/dev/null ||
    tmux new-session -d -s "elder-$n" -c "$HOME/clan-world/elder-$n" './run.sh'

  tmux kill-session -t "ttyd-elder-$n" 2>/dev/null || true
  port=$((38789+n))
  tmux new-session -d -s "ttyd-elder-$n" \
    "/home/claude/bin/ttyd -p $port \
      -I /home/claude/clan-world/ttyd/index.html \
      -t fontSize=11 -t cursorStyle=bar \
      tmux attach-session -t elder-$n \
      2>&1 | tee -a /tmp/clanworld-ttyd-elder-$n.log"
done
```

Verify both local Caddy and public Cloudflare routes. A direct TTYD `200` is
not enough if Caddy points at a different port.

```bash
ss -ltnp | grep -E '3879[0-3]'
for path in elder-1-tty elder-2-tty elder-3-tty elder-4-tty; do
  curl -I -H 'Host: cockpit.clan-world.com' "http://127.0.0.1:18080/$path/"
  curl -I "https://cockpit.clan-world.com/$path/"
done
```

If public cockpit returns `502 Bad Gateway`, inspect Caddy logs. The common
reset failure is `dial tcp 127.0.0.1:3879N: connect: connection refused`,
which means TTYD is either down or listening on the wrong port.

Clear old runner/Elder inbox artifacts before the first tick if they contain stale situation blocks, old diamond addresses, or old clan IDs.

## 7.5. Pause And Unpause

Use pause mode when contracts/Convex are reset but Elder Claude sessions cannot
act yet, such as a monthly usage-limit window. This freezes writers while still
allowing read-only cockpit terminals.

Pause game advancement and Convex writers:

```bash
tmux kill-session -t clanworld-heartbeat 2>/dev/null || true
tmux kill-session -t clanworld-runner 2>/dev/null || true

cd apps/server
npx convex env set CLANWORLD_USE_REAL_INDEXER false --prod
npx convex env set CLANWORLD_USE_FAKE_HEARTBEAT false --prod
npx convex env set CLANWORLD_RESET_LOCK true --prod
npx convex deploy --prod
```

Optional hard pause of terminals too:

```bash
for n in 1 2 3 4; do
  tmux kill-session -t "ttyd-elder-$n" 2>/dev/null || true
  tmux kill-session -t "elder-$n" 2>/dev/null || true
done
```

If you want to inspect stuck agents in the app while paused, keep or restart
only `elder-N` and `ttyd-elder-N`; do not start `clanworld-runner` or
`clanworld-heartbeat`.

Unpause:

```bash
cd apps/server
npx convex env set CLANWORLD_RESET_LOCK false --prod
npx convex env set CLANWORLD_USE_REAL_INDEXER true --prod
npx convex env set CLANWORLD_USE_FAKE_HEARTBEAT false --prod
npx convex deploy --prod
npx convex run indexer:refreshSnapshot '{}' --prod

cd ../..
tmux new-session -d -s clanworld-heartbeat -c "$PWD" \
  'bash scripts/start-heartbeat-loop.sh 2>&1 | tee -a /tmp/clanworld-heartbeat.log'
tmux new-session -d -s clanworld-runner -c "$PWD" \
  'pnpm --filter @clan-world/heartbeat start 2>&1 | tee -a /tmp/clanworld-runner.log'
```

After unpausing, verify `getSnapshot:getSnapshot` advances and runner logs show
new observed ticks.

## 8. Deploy Web App

Deploy the frontend after Convex has the new env and fresh state:

```bash
pnpm build
vercel --prod
```

If any Vercel project env var points directly at the diamond or lens, update it before deploying. The main game frontend should normally read the realm through Convex.

If the monorepo build is blocked by Android-only release env such as
`CLAN_WORLD_MAP_URL`, build the web app directly and deploy the static output:

```bash
pnpm --filter @clan-world/web build
cd apps/web
vercel deploy dist --prod --yes
```

## 9. Smoke Tests

Verify all of these before calling the reset complete:

```bash
cast code "$CLAN_WORLD_CONTRACT_ADDRESS" --rpc-url "$RPC_URL_PRIMARY"
cast call "$CLAN_WORLD_CONTRACT_ADDRESS" "owner()(address)" --rpc-url "$RPC_URL_PRIMARY"
cast call "$CLAN_WORLD_CONTRACT_ADDRESS" "getClanIds()(uint32[])" --rpc-url "$RPC_URL_PRIMARY"
tail -n 80 /tmp/clanworld-heartbeat.log
tmux ls
```

Also verify in the app:

- New tick number advances.
- Four clans exist.
- Four Elder agents are alive and assigned to the new clans.
- Convex world snapshot references the new diamond.
- TTYD terminals are reachable.

## 10. Post-Reset Notes

After the live reset, update this section or a dated reset report with:

- Active diamond and lens
- Backup diamond and lens
- Deploy block numbers
- Git commit and release tag
- Convex deployment slug
- Vercel production URL
- Any commands that differed from this runbook
- Any failures, rate limits, missing env vars, or process names discovered during the run
