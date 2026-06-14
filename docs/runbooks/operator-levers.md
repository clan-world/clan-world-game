# ClanWorld — Operator Levers (live-game survival runbook)

**Bottom line up front:** this is the single consolidated list of every lever an
operator pulls to keep a *live* ClanWorld realm alive — revive starved clans,
keep them warm through **winter** (the most-missed lever — clansmen die of
**cold**, not just hunger), unstick a frozen heartbeat, retune cadence, and
rebuild/re-index the stack after a re-fork. Each lever has an exact command.

This runbook **consolidates and cross-links** the deeper procedures; it does not
duplicate them. For the full destructive flows see:

- `docs/runbooks/full-game-reset.md` — fresh diamond + flush Convex + remint.
- `docs/runbooks/soft-game-reset.md` — mid-season revive + restock (no redeploy).
- `docs/runbooks/diamond-migration.md` — admin/owner recovery, season-end gas.
- `docs/runbooks/self-hosted-convex.md` — Convex deploy/env/indexer pipeline.
- `docs/runbooks/anvil-fork-dev-rpc.md` — the dev `anvil-fork` RPC.
- `docs/runbooks/fresh-vps-bootstrap.md` — full VPS bring-up (§14 troubleshooting).

## Conventions

Live prod is **Base Sepolia** (real chain). Dev is an `anvil-fork` of Base
Sepolia. All owner-only levers below are signed by the **deployer/owner**:

```bash
# REAL Base Sepolia deployer/owner key — NOT .env.local's placeholder.
# .env.local DEPLOYER_PRIVATE_KEY is a broken ~36-char varlock placeholder
# ("Failed to decode private key"). The real one-line 0x… key:
DEPLOYER_PRIVATE_KEY="$(cat ~/.secrets/clanworld-v3-deployer.key)"   # addr 0x02C4…267c7

DIAMOND=0x098fa5c2dc8372cde5c99db47365fa84b69f7af1     # live diamond (owner = 0x02C4…267c7)
LENS=0x18d313c03b140de91103a947827b4e6e60d329dc        # live lens
RPC_URL_PRIMARY="https://sepolia.base.org"             # or your Alchemy/Infura Base-Sepolia URL

# foundry isn't on a non-login / codex shell PATH — use absolute paths if `cast` is missing:
#   ~/.foundry/bin/cast   ~/.foundry/bin/forge
```

> **Env ordering gotcha:** if you also source `.env.local` for `RPC_URL_PRIMARY`
> / `CLAN_WORLD_CONTRACT_ADDRESS`, source it **FIRST**, then export the real
> deployer key **LAST** — sourcing `.env.local` after exporting the good key
> clobbers it with the placeholder. (memory `reference-clanworld-base-sepolia-deploy-gotchas`)

On the **dev `anvil-fork`**, you don't need the real key — the fork runs
`--auto-impersonate`, so sign as the owner with `--unlocked --from "$OWNER"`
(`OWNER=$(cast call $DIAMOND "owner()(address)" --rpc-url $RPC)`).

---

## 1. Revive a dead clan + restock its vault — INJECT BEFORE REVIVE

The single most important ordering rule: **inject resources BEFORE you revive.**
A revived clansman with an empty vault re-starves within 1–2 heartbeats, so
revive-then-inject just burns gas. (See `full-game-reset.md` §6 and
`anvil-fork-dev-rpc.md` §5.)

`injectClanResources` argument order is `(clanId, wood, iron, wheat, fish, gold, blueprint)`:

```bash
# 1) INJECT first. The amounts below give ~25 normal ticks of wheat + fish for a
#    4-clansman clan, plus a winter wood buffer (see §2 for the wood math).
cast send "$DIAMOND" \
  "injectClanResources(uint32,uint256,uint256,uint256,uint256,uint256,uint256)" \
  "$CLAN_ID" 60e18 0 100e18 10e18 0 0 \
  --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY"

# 2) THEN revive.
cast send "$DIAMOND" "reviveDeadClansmen(uint32)" "$CLAN_ID" \
  --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY"
```

Single-clansman variant: `reviveClansman(uint32 clansmanId)`.

**Upkeep per normal (non-winter) tick** (from `IClanWorld.sol` `ClanWorldConstants`):

| Resource | Per living clansman per tick |
|---|---|
| Wheat | `WHEAT_UPKEEP_PER_CLANSMAN` = `1e18` (1.0) |
| Fish  | `FISH_UPKEEP_PER_CLANSMAN`  = `1e17` (0.1) |

Insufficient wheat **or** fish → the clan starves; a clansman dies after the
starvation grace tick. Keep the vault ahead of upkeep.

---

## 2. WINTER COLD-DEATH — inject WOOD or clansmen freeze (the key lever)

**This is the most-missed lever.** During winter a clan needs **WOOD to stay
warm** — separate from, and in addition to, its food upkeep. If a clan has no
spare wood during a winter tick it takes **cold damage**, which first degrades
its wall and then **kills clansmen at random**. Injecting wheat/fish alone does
NOT prevent cold death — you must inject **WOOD**.

### Winter schedule (`ClanWorldConstants`, `LibSeason.sol`)

| Constant | Value | Meaning |
|---|---|---|
| `WINTER_START_TICK` | `110` | First winter opens at tick 110 (ticks 100–109 are pre-winter runway). |
| `WINTER_DURATION_TICKS` | `10` | Each winter lasts 10 ticks. |
| `WINTER_PERIOD_TICKS` | `110` | Winter recurs every 110 ticks. |

So winter windows are `[110,120)`, `[220,230)`, `[330,340)`, … each 10 ticks
long. Check live state with `isWinter()` and the world-state
`winterStartsAtTick` / `winterEndsAtTick` fields.

### Winter wood burn math (`LibSettlement.applyUpkeep`)

Per **winter tick**, a living clan burns:

```
woodNeeded = WINTER_WOOD_BURN_PER_BASE + livingClansmen × WINTER_WOOD_BURN_PER_CLANSMAN
```

| Constant | Value |
|---|---|
| `WINTER_WOOD_BURN_PER_BASE` | `1e18` (1.0 wood / tick, flat) |
| `WINTER_WOOD_BURN_PER_CLANSMAN` | `5e17` (0.5 wood / clansman / tick) |
| `WINTER_UPKEEP_MULTIPLIER_BPS` | `20000` = **2×** (wheat AND fish double in winter) |

**Per-clansman-per-winter-tick wood = 0.5**, plus a flat **1.0 wood/tick** per
clan base. Worked examples (full 10-tick winter):

| Living clansmen | Wood / winter tick | Wood / full 10-tick winter |
|---|---|---|
| 2 | 1.0 + 2×0.5 = **2.0** | **20** wood |
| 4 | 1.0 + 4×0.5 = **3.0** | **30** wood |
| 6 | 1.0 + 6×0.5 = **4.0** | **40** wood |

> **Inject ≥ `(1 + 0.5 × clansmen) × 10` wood per clan before each winter** to
> guarantee immunity for the whole window. For a 4-clansman clan that's **≥ 30e18
> wood**; round up for a safety margin (e.g. `60e18`). Remember winter ALSO
> doubles wheat+fish upkeep, so top up food to ~2× normal too.

### What happens when wood runs short

`LibSettlement.applyColdDamageConsequence`: each winter tick with insufficient
spendable wood increments `coldDamage` by 1. Then:

1. **Wall first:** every `COLD_DAMAGE_PER_WALL_DEGRADATION = 2` accumulated cold
   damage drops `wallLevel` by 1 (while `wallLevel > 0`).
2. **Clansman death:** once `wallLevel == 0`, every
   `COLD_DAMAGE_PER_CLANSMAN_DEATH = 2` accumulated cold damage kills a **random
   living clansman** (`killRandomClansmanFromCold`).

`coldDamage` **resets to 0** at winter end (the tick after the last winter tick).
Events to watch: `WinterStarted` / `WinterEnded`, `ClanColdShortage(clanId, tick,
woodShort)`, `WallDegradedByCold`, `ClansmanColdDeath`.

### Recovery from a winter freeze

Same ordering as §1 — inject (wood-heavy this time) **before** revive:

```bash
# Heavy wood + doubled food, then revive whatever froze to death.
cast send "$DIAMOND" \
  "injectClanResources(uint32,uint256,uint256,uint256,uint256,uint256,uint256)" \
  "$CLAN_ID" 100e18 0 200e18 20e18 0 0 \
  --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY"

cast send "$DIAMOND" "reviveDeadClansmen(uint32)" "$CLAN_ID" \
  --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY"
```

---

## 3. Season boundary — `finalizeSeason()` when the heartbeat freezes

When the world hits a season boundary, `heartbeat()` early-returns and **ticks
stop advancing** until `finalizeSeason()` is called. Symptom: heartbeat tx
fires/confirms but `getTickClock` / the on-chain tick stays flat. (Full detail:
`fresh-vps-bootstrap.md` **§14.4**; gas caveat in `diamond-migration.md`.)

```bash
cast send "$DIAMOND" "finalizeSeason()" \
  --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY"
```

> **Gas caveat:** the 4-clan demo finalizes at ~12M gas. With 8+ clans and long
> settlement backlogs, `finalizeSeason()` can exceed Base Sepolia's per-tx gas
> cap and become unrecoverable via a direct call — see `diamond-migration.md`.
> The prod heartbeat wrapper auto-calls `finalizeSeason()` on the stuck-at-
> season-end state (`fresh-vps-bootstrap.md` §14.4); this manual call is the
> backstop.

---

## 4. Heartbeat interval — `setHeartbeatIntervalSeconds()` (no redeploy)

The tick cadence is **runtime-settable** via `HeartbeatConfigFacet` — no
diamond cut / redeploy needed:

```bash
# Read current cadence:
cast call "$DIAMOND" "heartbeatIntervalSeconds()(uint64)" --rpc-url "$RPC_URL_PRIMARY"

# Set a new cadence (owner-only). e.g. 30s — slower cadence gives agents more
# think-time per tick (2026-06-13 hackathon set this to 30):
cast send "$DIAMOND" "setHeartbeatIntervalSeconds(uint64)" 30 \
  --rpc-url "$RPC_URL_PRIMARY" --private-key "$DEPLOYER_PRIVATE_KEY"
```

The off-chain heartbeat loop reschedules from `getWorldState().nextHeartbeatAtTs`,
so the new interval takes effect on the next scheduled beat.

---

## 5. Stack reset / re-fork (dev `anvil-fork`)

`make reset-anvil PROFILE=dev` tears down the fork volume and re-forks Base
Sepolia at `FORK_BLOCK_NUMBER`. Watch these two footguns:

- **`FORK_BLOCK_NUMBER` lives in `.env`, NOT `.env.local`** (line ~98; current
  value `42817400`). docker-compose auto-loads `.env` only. The
  `anvil-fork-dev-rpc.md` runbook still says `.env.local` in places — `.env` is
  correct. (memory `reference-clanworld-base-sepolia-deploy-gotchas`)
- **`FORK_BLOCK_NUMBER=0` forks at GENESIS (empty chain), NOT latest.** A `0`
  fork has no diamond ("contract does not have any code" at block ~3). To pick up
  the live diamond + any recent cut, pin a block **≥ the cut's block**, ideally
  the current tip:

```bash
# pick the current Base Sepolia tip, write it to .env, then re-fork:
TIP=$(cast block-number --rpc-url https://sepolia.base.org)
sed -i "s/^FORK_BLOCK_NUMBER=.*/FORK_BLOCK_NUMBER=$TIP/" .env
make reset-anvil PROFILE=dev
# or, to just pick up a fresh on-chain state without wiping the volume:
docker compose --profile dev up -d --force-recreate anvil-fork
```

A forked live diamond may inherit `worldPaused=true` and pre-existing clans —
**don't remint**; `unpauseWorld()` and reuse the inherited clan IDs (full flow:
`anvil-fork-dev-rpc.md` §5).

> **Disk leak note (2026-06-13):** anvil's `--state=/data/anvil-state.json` can't
> write the root-owned `clan-world_anvil_data` volume, so it spams 71MB dumps
> into its container tmp layer (filled 240GB) AND never persists (so restart
> re-forks). `--force-recreate anvil-fork` clears the leaked layer. Durable fix
> (deferred): chown `/data` to anvil's uid, or drop `--state`.

For prod, there is no re-fork — prod runs the real Base Sepolia diamond. A full
prod rebuild = new diamond deploy + Convex flush per `full-game-reset.md`.

---

## 6. Convex re-index after a re-fork / world rebuild

After the chain side changes (re-fork, new diamond, post-cut), the self-hosted
Convex indexer must be re-pointed and its **two** stale checkpoints reset, or the
in-container per-tick elder driver (`/opt/elder-runtime/src/main.ts`, baked from
`packages/runner/`) stays dark. Full env flow: `self-hosted-convex.md`.

Run from `apps/server`, **with the `.env.local` cloud pointer neutralized**
(`CONVEX_DEPLOYMENT` / `CONVEX_URL` / `CONVEX_SITE_URL` commented out — otherwise
the CLI silently targets the cloud project, not `:3210`) and self-hosted env
exported. Use `npx -y convex@1.39.1` (pinned):

```bash
cd apps/server
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat ../../agents/secrets/convex-admin.key)"

# (re)deploy functions + re-point the indexer at the right chain:
make -C ../.. deploy-convex
#   For an anvil-fork dev backend the indexer's RPC_URL_PRIMARY MUST be
#   http://anvil-fork:8545 (the fork), NOT prod — else tickClock never advances:
npx -y convex@1.39.1 env set RPC_URL_PRIMARY http://anvil-fork:8545

# (a) reset the event-indexer checkpoint to the new world's start block:
TIP=$(docker exec clan-world-anvil-fork-1 cast block-number --rpc-url http://localhost:8545)
npx -y convex@1.39.1 run ops:resetCheckpoint \
  "{\"secret\":\"$INDEXER_SECRET\",\"lastBlock\":$((TIP-100))}"

# (b) CLEAR the stale tickReceiveLog — THIS unblocks the per-tick elder driver.
#     Rows from the previous (higher-tick) world make lastReceivedTick sit in the
#     FUTURE of the rebuilt clock, so the runner skips every delivery
#     (aux.tick <= lastTickDelivered) until live tick passes it. Loop to
#     complete:true. minTick=0 wipes all stale receipts so the runner late-joins
#     cleanly (lastReceivedTick=null).
while true; do
  out=$(npx -y convex@1.39.1 run ops:clearStaleTickReceiveLog \
    "{\"secret\":\"$INDEXER_SECRET\",\"minTick\":0,\"batchSize\":2000}")
  echo "$out"
  echo "$out" | grep -q '"complete": true' && break
done
```

> **Why both resets:** `resetCheckpoint` fixes the *event* indexer (which clan
> state Convex reads). `clearStaleTickReceiveLog` fixes the *runner* delivery
> gate (whether elders get prompted at all). Resetting only the checkpoint leaves
> the elders mute even though the dashboard updates.

Verify the pipeline end-to-end per `self-hosted-convex.md` → "Verify The Tick
Pipeline End-To-End" (`tickClock` advancing, indexer polling the right chain,
`runnerEvents` not piling `ready_probe_timeout`, elder panes showing `tick: N`).

---

## 7. Elder re-orientation (fresh session, no poisoned memory)

When an elder's conversation has drifted, is stuck mid-tick, or is carrying
stale/poisoned continuity from a previous world, give it a clean boot:

1. **Force a FRESH Claude session** — set `CLAN_WORLD_CLAUDE_CONTINUE=never` so
   `agents/shared/run.sh` starts a brand-new session instead of `--continue`.
   (Plain `--continue` with no prior session also "works" but is the wrong tool —
   it resumes drift; `never` guarantees a clean slate.)

   ```bash
   # restart one elder fresh (clanworld-elder-N tmux session in its container):
   docker exec clan-world-elder-N tmux kill-session -t elder-N 2>/dev/null || true
   docker exec -e CLAN_WORLD_CLAUDE_CONTINUE=never clan-world-elder-N \
     tmux new-session -d -s elder-N -c /workspace './run.sh'
   ```

   (The runner can also override per-restart; the env var is the canonical knob.)

2. **Clear the poisoned `ANCIENT_WISDOM.md`** — the elder reads
   `/workspace/ANCIENT_WISDOM.md` (`RUNNER_WORKSPACE_DIR` default `/workspace`,
   `ANCIENT_WISDOM_PATH`) at session start. Stale wisdom from an old world
   re-poisons a fresh session. Truncate it (or restore the clean bootstrap copy
   from `agents/shared/elder-bootstrap/workspace-ANCIENT_WISDOM.md`):

   ```bash
   docker exec clan-world-elder-N sh -c ': > /workspace/ANCIENT_WISDOM.md'
   ```

3. **Send a plain operator message — NO "nonce".** Re-orient with an ordinary
   operator/steering message describing the current world state. Do not wrap it
   in a synthetic nonce/handshake token; a plain message is what the elder is
   primed to act on, and a fake nonce just confuses the boot context.

---

## Quick reference — which lever for which symptom

| Symptom | Lever |
|---|---|
| Clansmen starving (low wheat/fish) | §1 inject-then-revive |
| Clansmen dying in winter despite food | §2 inject **WOOD** (≥ `(1 + 0.5×clansmen)×10` per clan) |
| Heartbeat confirms but ticks flat | §3 `finalizeSeason()` |
| Cadence too fast/slow for agents | §4 `setHeartbeatIntervalSeconds()` |
| Dev fork drifted / wrong block | §5 re-fork (`.env FORK_BLOCK_NUMBER`, not 0) |
| Dashboard stale / elders mute after rebuild | §6 `resetCheckpoint` + `clearStaleTickReceiveLog` |
| Elder drifting / stuck / stale memory | §7 fresh session + clear ANCIENT_WISDOM |
