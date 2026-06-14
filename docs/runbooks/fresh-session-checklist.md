# Fresh-session checklist — ClanWorld

**BLUF:** Run this at the start of every working session before you trust the
live game. It answers, in order: *what's running?*, *is any container running
stale code?*, *⛽ is every wallet funded?* (the thing that froze the game), *are
the on-chain values correct?*, *is Convex in sync with the chain?*, *is the
anvil fork sane?*, and *what might silently not be on latest?*

Every command below was validated against the live dockerized dev stack. The
canonical fresh-fork reset + its gotchas live in the memory note
`reference-clanworld-dockerized-fresh-fork-reset`; this checklist is the
read-only verification pass that sits in front of it.

## Conventions

```bash
# Live diamond on Base Sepolia (also present on the dev fork, which inherits it).
DIAMOND=0x098fa5c2dc8372cde5c99db47365fa84b69f7af1

# In DEV, on-chain reads go through the anvil-fork container. The fork's internal
# RPC is http://localhost:8545 *from inside the container*.
fork() { docker exec clan-world-anvil-fork-1 cast "$@" --rpc-url http://localhost:8545; }

# In PROD, read live Base Sepolia directly.
PROD_RPC=https://sepolia.base.org
```

---

## 1. What's running?

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.CreatedAt}}' | grep clan-world
```

Expect (dev profile): `clan-world-convex-backend-1`, `clan-world-heartbeat-1`,
`clan-world-elder-1` .. `clan-world-elder-4`, `clan-world-caddy-1`, and
**dev-only** `clan-world-anvil-fork-1`. All should be `Up ... (healthy)`.

- If an elder is missing, **`docker compose start elder-1 elder-2 elder-3 elder-4`**
  — NOT `up`. The `clanworld/agents:dev` image is often missing from the content
  store, so `up` tries to pull and fails; `start` restarts the existing stopped
  container without the image.
- Confirm each elder's TUI is alive: `docker exec clan-world-elder-1 tmux capture-pane -t 0 -p | tail -3`.

---

## 2. Image freshness / stale-image check

The footgun: a container keeps running an **old image** after its source
changed, so you debug behavior that the code no longer has. Compare each
container's image creation time against the last commit to its source dir; **FAIL
if the image is older than its source.**

```bash
for svc in heartbeat:packages/heartbeat \
           elder-1:agents \
           convex-backend:apps/server; do
  name="clan-world-${svc%%:*}-1"; src="${svc##*:}"
  img_created=$(docker inspect "$name" --format '{{.Created}}' 2>/dev/null)
  src_commit=$(git log -1 --format='%h %ci' -- "$src")
  printf '%-28s image=%s\n  source %-22s %s\n' "$name" "$img_created" "$src" "$src_commit"
done
```

(`packages/heartbeat` and `agents` are `build:` services; `packages/runner` and
`apps/server` also ship code into containers — extend the loop as needed.) If a
build service's image predates its last source commit, rebuild + recreate, e.g.
`docker compose build heartbeat && docker compose --profile dev up -d --force-recreate heartbeat`.

> Elders run from the prebuilt `clanworld/agents:dev` image. If that image is
> missing from the content store you cannot rebuild it casually — see the
> fresh-fork memory note for the rebuild-from-clean-worktree procedure.

---

## 3. ⛽ Gas-balance sweep across ALL wallets — CRITICAL

**This is what froze the game.** A revert-flood drained the heartbeat runner to
~0 ETH; with no gas it could not pay for `heartbeat()`, so every tx reverted with
**empty `0x` data** (insufficient funds) even though an `eth_call` simulation
*succeeded*. Sim-succeeds + tx-reverts-empty == out of gas. Check balances FIRST,
before deep-debugging any revert. (Root cause: `reference-clanworld-652-heartbeat-flapping-rootcause`.)

```bash
RUNNER=0xBC34eB46EF3Ad429C3Bcef049dc8ccca6f786cc7   # heartbeat runner wallet

echo "heartbeat runner:"
fork balance "$RUNNER" --ether

echo "elder wallets:"
for n in 1 2 3 4; do
  f="agents/secrets/elder-wallet-${n}.key"
  addr=$(fork wallet address "$(tr -d '[:space:]' < "$f")")
  printf '  elder-%s %s  %s ETH\n' "$n" "$addr" "$(fork balance "$addr" --ether)"
done
```

Live elder wallet addresses (derived from `agents/secrets/elder-wallet-N.key`):

| Wallet | Address |
|---|---|
| heartbeat runner | `0xBC34eB46EF3Ad429C3Bcef049dc8ccca6f786cc7` |
| elder-1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| elder-2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| elder-3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |
| elder-4 | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` |

**Gas floor (fail the checklist below this):** runner < ~1 ETH on the fork, or
any elder < ~1 ETH. On the fork these are funded generously (runner ~1000 ETH,
elders ~100 ETH each) precisely so a revert-flood can't starve them between
re-funds.

**Top up on the fork** (1000 ETH; this should be a permanent fork-bootstrap step):

```bash
fork rpc anvil_setBalance "$RUNNER" 0x3635C9ADC5DEA00000   # 1000 ETH
# elders:
fork rpc anvil_setBalance 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 0x56BC75E2D63100000  # 100 ETH
```

**On Base Sepolia (prod)** there is no `anvil_setBalance` — the runner + elder
wallets must be topped up with real testnet ETH from the faucet/funding wallet.
Check the same balances against `--rpc-url "$PROD_RPC"` and fund before they run
dry. **Sui wallets** (for Walrus Memory, once live) get the same sweep — confirm
they hold enough SUI to pay storage/gas; until Walrus lands, memory is
file-backed and needs no on-chain SUI.

---

## 4. On-chain values

```bash
fork chain-id                                              # expect 84532
fork call "$DIAMOND" 'heartbeatIntervalSeconds()(uint64)'  # expect 30
fork call "$DIAMOND" 'clansmanCooldownSeconds()(uint64)'   # expect 60 (distinct from heartbeat!)
fork call "$DIAMOND" 'getWorldState()((uint64,uint64,uint64,bool,uint64,uint64,uint64,uint64,uint16,bytes32,uint32,bool,uint64,uint64,uint64,bool,uint64))'
```

`getWorldState()` tuple fields, in order: `currentTick, seasonStartTick,
seasonEndTick, seasonFinalized, currentSeasonNumber, nextHeartbeatAtTick,
nextHeartbeatAtTs, nextBanditSpawnEligibleTick, currentBanditSpawnChanceBps,
currentTickSeed, activeBanditId, winterActive, winterStartsAtTick,
winterEndsAtTick, nextCommitSequence, worldPaused, pausedAtTs`.

- **`worldPaused`** (16th field) must be `false` for a live game.
- **`heartbeatIntervalSeconds` == 30**, NOT 60. (60s is the *clansman submission
  cooldown*, a different lever — don't confuse them.)
- **Gather yields are 2x** (doubled WOOD/IRON/WHEAT/FISH). These are inlined
  constants in `LibSettlement`, not a runtime getter — spot-check via a view sim
  (`DerivedViewsFacet`) or by reading recent settlement events.

---

## 5. Convex ↔ chain sync

The self-hosted Convex backend (`clan-world-convex-backend-1`) indexes chain
logs. Verify its high-water block is keeping up with the chain head.

```bash
# Chain head (dev fork):
fork block-number

# Convex eventCheckpoint + tickReceiveLog — run via the self-hosted backend.
# The running backend's INDEXER_SECRET differs from .env; get the real one with
#   npx convex env get INDEXER_SECRET
# (export CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY from
#  agents/secrets/convex-admin.key first). Then read the checkpoint table.

# Indexer health from the backend logs:
docker logs --since 5m clan-world-convex-backend-1 2>&1 | grep -iE 'indexer|checkpoint|error' | tail
```

- `eventCheckpoint` block should trail `fork block-number` by only a few blocks
  (the poller runs every 3s; intra-tick latency ~30s on Base Sepolia posture).
- `tickReceiveLog` should show a recent tick per elder. A stale entry means an
  elder isn't being driven — watch its TUI (`tmux capture-pane`) before flushing
  anything.
- See `apps/server/convex/INDEXER.md` for the cron details and
  `runbooks/self-hosted-convex.md` for the `.env.local`-hijacks-to-cloud gotcha.

---

## 6. Anvil fork sanity (dev)

```bash
fork chain-id                 # 84532
fork block-number             # should be advancing across runs
docker logs --since 2m clan-world-anvil-fork-1 2>&1 | grep -iE 'fork|401|429|reorg' | tail
```

- **Re-fork hazard:** the entrypoint persists `/data/anvil-state.json`, so a
  plain restart RESUMES the old (possibly diverged) state instead of re-forking.
  To get a genuinely fresh fork you must clear the volume
  (`docker volume rm clan-world_anvil_data`) — see the fresh-fork memory note.
- **`FORK_BLOCK_NUMBER` semantics:** `0` means **genesis, NOT latest**. Set it to
  the current Base Sepolia tip (`cast block-number --rpc-url "$PROD_RPC"`) so the
  fork's genesis `block.timestamp` ≈ wall-clock.
- **`/data` leak:** the anvil state file has previously ballooned to 240 GB — check
  the volume isn't leaking disk.

---

## 7. "What might not be latest?" sweep

A final pass over everything that can silently drift behind `main`/`dev`:

- [ ] **Code:** `git -C <deployed worktree> status` + which branch/commit is checked out.
- [ ] **Docker images:** all `build:` services rebuilt since their last source change (§2).
- [ ] **Convex deployed functions/schema:** the self-hosted backend has the latest
      `apps/server/convex` deployed (note: `convex deploy` hijacks to CLOUD via
      `.env.local` — use `make deploy-convex`).
- [ ] **ABI / contract artifacts:** the diamond ABI the runner/UI use matches the
      deployed facets (handcoded-ABI drift hazard).
- [ ] **Vercel / dev-UI build-time env:** `VITE_*` vars (contract address, Convex
      URL) baked at build time are current.
- [ ] **`.env` / Convex env:** `.env` (FORK_BLOCK_NUMBER, contract address) and the
      backend's exported env (`INDEXER_SECRET`) match reality.
- [ ] **Elder prompt / skill overlays:** elders are running the intended
      personality + skill set (image-baked vs bind-mounted split).

---

## If a check fails

| Symptom | Likely cause | Fix |
|---|---|---|
| Heartbeat unhealthy, no ticks landing | Runner out of gas (§3) | `anvil_setBalance` the runner (fork) / fund it (prod). |
| Heartbeat hot-looping `rate-limited; retrying after 0ms` | Fork clock vs wall-clock (§6) + runner drained | Top up runner; see `heartbeat-runner.md`. |
| Elder not reacting to ticks | Stale `tickReceiveLog` / driver not waking it | Watch the elder TUI; check Convex driver logs. |
| Container running old behavior | Stale image (§2) | Rebuild + `--force-recreate`. |
| Fork clock diverged / wrong tip | Resumed old `/data` state (§6) | Clear the anvil volume + re-fork at tip. |
