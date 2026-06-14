# REVIVE DEMO — May 6 2026 (post-pause)

The v2 demo state was paused on 2026-05-05 ~19:54 ET to save Anthropic
+ Convex compute + Alchemy RPC quota overnight. Run these steps before
the demo tomorrow to bring the game back to a live, ticking state.

## What's frozen

- **Diamond contract** `0xBE8E3b991480E2f67eCF0C955063E2d897fCb173` on Base Sepolia (chain immutable, no action needed)
- **Tag**: `demo-2026-05-06` (HEAD of main: `7d85968`)
- **Convex deployment**: `dev:oceanic-hound-951` (paused: `CLANWORLD_USE_REAL_INDEXER=false`, crons not registered)
- **Vercel**: alias `demo.clanworld.com` → production deploy of merged-#29 main (TODO: verify alias still pointing here when reviving)
- **Heartbeat loop**: stopped (`pkill -f clanworld-heartbeat-loop`)
- **Runner**: tmux session `clanworld-runner` killed
- **Elder REPLs**: 4 tmux sessions killed (`elder-1..4`)

## Revive sequence

### 1. Re-enable Convex indexer crons + redeploy

```bash
cd ~/code/omnipass-world/clan-world-v2/apps/server
npx convex env set CLANWORLD_USE_REAL_INDEXER true
npx convex dev --once --typecheck=disable
```

This re-registers the `real-indexer-snapshot-refresh` (every 5s) and
`real-indexer-log-poller` (every 3s) crons on the dev deployment. The
cockpit will start reflecting fresh on-chain state once these run.

### 2. Start a fresh season (if desired)

If the demo wants a fresh tick=0 start, redeploy the diamond. But if
the existing diamond at tick ~178 is OK to demo, skip this — just
proceed to step 3.

To start a fresh season ON THE EXISTING DIAMOND: not possible without
redeploy (clan state is shared across seasons; a fresh season just
resets ranking). To start AT TICK 0: redeploy. See
`packages/contracts/script/Deploy.s.sol` and the codex-redeploy prompt
template at `/tmp/codex-redeploy-prompt.md` (or recreate).

### 3. Start the heartbeat loop

```bash
setsid nohup ~/bin/clanworld-heartbeat-loop > /dev/null 2>&1 < /dev/null &
disown
sleep 5
tail -3 /tmp/clanworld-heartbeat.log
```

Should see `heartbeat OK gasUsed ... tx=...` within 60s.

### 4. Start the runner

```bash
# IMPORTANT: clear the elder marker files BEFORE starting the runner.
# The runner won't deliver tick events to elders if marker files have
# stale tick numbers from a previous run (the duplicate-tick check trips).
rm -f ~/.world/clanworld-runner/state/elder-*-last-tick.txt

cd ~/code/omnipass-world/clan-world-v2/packages/runner
tmux new-session -d -s clanworld-runner -c "$PWD" \
  "set -a; source ~/code/omnipass-world/clan-world-v2/.env.local; set +a; \
   export RUNNER_PRIVATE_KEY=\"\$DEPLOYER_PRIVATE_KEY\"; \
   pnpm start 2>&1 | tee /tmp/clanworld-runner.log"

# Verify
sleep 12
tmux capture-pane -t clanworld-runner -p | grep -E "runner|tick|heartbeat"
```

### 5. Start the 4 elder REPLs

```bash
for n in 1 2 3 4; do
  tmux new-session -d -s elder-$n -c ~/clan-world/elder-$n "exec ~/clan-world/elder-$n/run.sh"
done

# Verify all 4 came up
sleep 12
for n in 1 2 3 4; do
  echo "=== elder-$n ==="
  tmux capture-pane -t elder-$n -p | tail -5
done
```

### 6. Verify game live

```bash
set -a; source ~/code/omnipass-world/clan-world-v2/.env.local; set +a

# Chain tick advancing
cast call 0xBE8E3b991480E2f67eCF0C955063E2d897fCb173 \
  "getWorldSnapshot()((uint64,uint64,uint64,bool,uint64,uint64,bool,uint64,uint64,uint32,bytes32,(uint32,uint64,uint32,address)[]))" \
  --rpc-url "$RPC_URL_PRIMARY" | head -1 | head -c 80

# Watch a couple of heartbeats land
tail -F /tmp/clanworld-heartbeat.log

# Watch elders react
for n in 1 2 3 4; do
  tmux capture-pane -t elder-$n -p | grep -oE "TICK [0-9]+ Started" | tail -1
done
```

Expect all 4 elders at the same/adjacent tick within ~2 minutes.

## Known issues (carried over)

- **Heartbeat loop death pattern** — fixed by dropping `set -euo pipefail` from `~/bin/clanworld-heartbeat-loop`. Loop now survives transient cast failures (rate-limit reverts during heartbeat throttle). See memory `feedback_bash_pipefail_grep_set_e_loop_death.md`.
- **Runner duplicate-tick trap** — runner won't deliver to elders if `~/.world/clanworld-runner/state/elder-*-last-tick.txt` markers contain stale ticks > current chain tick. Always clear before runner start (step 5 above does this).
- **Runner heartbeat reverts when loop is also running** — both runner and heartbeat-loop send `heartbeat()` with the deployer key. Whichever lands second reverts due to rate-limit. Harmless but noisy. For a clean log, can skip starting the loop (step 4) — the runner will heartbeat alone — but loop is recommended as redundancy in case runner crashes.

## Post-demo cleanup

After the demo:
- Stop everything via the same `pkill` / `tmux kill-session` commands above.
- All future development is in `clan-world-v3` repo (separate, isolated). This repo (`clan-world-v2`) is frozen at `demo-2026-05-06`.
