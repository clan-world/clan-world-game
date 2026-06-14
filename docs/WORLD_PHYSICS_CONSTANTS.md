# ClanWorld — World Physics Constants

The **tuning table** for ClanWorld: every adjustable number in the game engine, in one place. This is the companion to [`WORLD_PHYSICS.md`](./WORLD_PHYSICS.md) — that doc explains *how* each mechanic works; this one is the dense lookup of *what value* it currently uses. Sections appear in the **same order** as `WORLD_PHYSICS.md`.

- **"Current value"** = the value the **present on-chain engine** runs today (verified against `packages/contracts/src/IClanWorld.sol`, `packages/contracts/src/diamond/lib/LibGameRules.sol`, `LibBanditCombat.sol`, `LibBanditSpawning.sol`, `LibScoring.sol`, `LibGameRules.sol`, the deploy script `DeployDiamond.s.sol`, and the runner `gameSettings` / `templateLoader.ts`).
- Values are shown as **plain units** (e.g. `15 wood`, not `15e18`; the contract stores everything 18-decimal fixed-point).
- ⚠️ flags a value where the **current engine disagrees with intent**; 🆕 flags an **intended new-engine value** that differs from what's coded today. Where current ≠ intended, **both** are listed.
- ⚠️ **All numbers are tuning, not law** — expect rebalancing in the new engine (per `WORLD_PHYSICS.md`).

---

## 1. Overview & core entities

| Constant | Current value | Meaning |
|---|---|---|
| Clansmen per clan | 4 (hard-cap) | Every clan has exactly 4 clansmen; loop `for i < 4` in `ClanLifecycleFacet`. 🆕 base-upgrade bonus clansman (5th+) is intended but NOT built. |
| `MAX_CLANS` | 12 | Max clans in a world (`LibGameRules`). |
| Clansman states | 4 | `WAITING · TRAVELING · ACTING · DEAD` (`ClansmanState` enum). |
| Resource types | 6 | wood · iron · wheat · fish + gold + blueprints. |

## 2. Time — ticks, heartbeats & seasons

| Constant | Current value | Meaning |
|---|---|---|
| `HEARTBEAT_INTERVAL_SECONDS` | 60 | Wall-clock seconds per heartbeat = 1 tick. Configurable up to 1h; 60s canonical. |
| `SEASON_DURATION_TICKS` | 360 | Ticks per season = 6h at 60s/tick. |
| `WINTER_START_TICK` | 110 | First winter opens at tick 110 (first winter completes at 120). |
| `WINTER_DURATION_TICKS` | 10 | Winter lasts 10 ticks. |
| `WINTER_PERIOD_TICKS` | 110 | Winter recurs every 110 ticks ("year" length). |
| `memoryWipeTickInterval` | 50 | Agent context wiped every 50 ticks (runner `gameSettings`, agent-layer not on-chain). |
| `MAX_LAZY_SETTLE_BACKLOG` | 200 | Max ticks a clan can be unsettled before it must be settled to take a new order (`LibGameRules`). |
| Cross-season reset | none (current) | ⚠️ Nothing resets at season rollover — vaults/gold/monuments/walls/dead clansmen/wheat plots all carry over. 🆕 Intended: fresh game each season. |

## 3. Regions & travel

| Constant | Current value | Meaning |
|---|---|---|
| `REGION_NOOP` | 0 | Stay put / no move (footgun: 0 is NOT "home"). |
| `REGION_FOREST` | 1 | Forest. |
| `REGION_MOUNTAINS` | 2 | Mountains. |
| `REGION_UNICORN_TOWN` | 3 | Unicorn Town (spot market; never a base region). |
| `REGION_WEST_FARMS` | 4 | West Farms. |
| `REGION_EAST_FARMS` | 5 | East Farms. |
| `REGION_WEST_DOCKS` | 6 | West Docks. |
| `REGION_EAST_DOCKS` | 7 | East Docks. |
| `REGION_DEEP_SEA` | 8 | Deep Sea (reachable only via Docks 6/7; never a base region). |
| Adjacent travel | 1 tick | Each hop along the adjacency graph = 1 tick. |
| Max path length | 4 ticks | Longest shortest-path across the map (`distMatrix` in `LibOrderTravel`, e.g. Forest → East Docks). |

## 4. Missions

| Constant | Current value | Meaning |
|---|---|---|
| `CLANSMAN_COOLDOWN_SECONDS` | 60 | Per-clansman wall-clock submission throttle (`cooldownEndsAtTs` timestamp, not tick-gated; configurable up to 1h). |
| Gather `actionDuration` | 4 ticks | ChopWood · MineIron · FishDocks · FishDeepSea · HarvestWheat. |
| Deposit/Withdraw duration | 1 tick | DepositResources · WithdrawResources. |
| Build duration | 1 tick | UpgradeWall · UpgradeBase · UpgradeMonument (`DEPOSIT_/BUILDING_DURATION_TICKS`). |
| Market action duration | 1 tick | MarketBuy · MarketSell (resolves at arrival-tick settlement). |
| Wait / None / DefendBase | 0 ticks | No action-duration delay. |

**`ActionType` enum IDs:** `0 None · 1 ChopWood · 2 MineIron · 3 FishDocks · 4 FishDeepSea · 5 HarvestWheat · 6 DepositResources · 7 UpgradeWall · 8 UpgradeBase · 9 UpgradeMonument · 10 DefendBase · 11 MarketBuy · 12 MarketSell · 13 Wait · 14 WithdrawResources`

## 5. Resources & gathering

**Carry caps (per-resource backpack):**

| Constant | Current value | Meaning |
|---|---|---|
| `WOOD_CAP` | 15 wood | Per-clansman wood carry cap. |
| `IRON_CAP` | 5 iron | Per-clansman iron carry cap. |
| `WHEAT_CAP` | 40 wheat | Per-clansman wheat carry cap. |
| `FISH_CAP` | 8 fish | Per-clansman fish carry cap. |

**Yields (per tick; batch = ×4 over the 4-tick gather):**

| Constant | Current value | Meaning |
|---|---|---|
| `WOOD_YIELD_PER_TICK` | 1 wood | Base wood/tick → 4 per gather. |
| `WOOD_CRIT_BPS` | 1000 (10%) | Crit chance; ⚠️ current crit **doubles the whole batch** (4→8). 🆕 intended per-tick +1 (4-tick w/ 1 crit = 5). |
| `IRON_YIELD_PER_TICK` | 0.125 iron | = `IRON_BASE_YIELD` 0.5 / 4 → 0.5 per gather. |
| `GOLD_FROM_IRON_BPS` | 200 (2%) | Chance a mine-iron also finds gold. |
| `GOLD_FROM_IRON_AMOUNT` | 1 gold | Gold found on a successful iron-gold roll. |
| `WHEAT_YIELD_PER_TICK` | 5 wheat | → up to 20 per gather (drawn from plot). |
| `FISH_YIELD_PER_TICK` | 0.25 fish | = 1 fish / 4 ticks (probabilistic; see below). |
| `FISH_DOCKS_BPS` | 2500 (25%) | Per-success fish chance at docks. |
| `FISH_DEEP_BPS` | 7500 (75%) | Per-success fish chance in deep sea (best odds; no boat gate). |
| Starvation penalty | yield / 2 | All gather yields halve while starving (`amount/2`). |

**Wheat plots:**

| Constant | Current value | Meaning |
|---|---|---|
| `WHEAT_PLOT_STARTING_WHEAT` | 100 wheat | Per-plot capacity; each clan owns 2 plots (west+east), no cross-clan contention. |
| `WHEAT_PLOT_REGROW_TICKS` | 4 ticks | Regrow time after a plot is fully depleted. ⚠️ current: must hit 0 first. 🆕 intended: continuous regrow on partial harvest. |

**Starting vault (per fresh clan, `ClanLifecycleFacet`):**

| Constant | Current value | Meaning |
|---|---|---|
| Starting wood | 20 wood | |
| Starting wheat | 20 wheat | ⚠️ ~5 ticks of upkeep only. 🆕 intended 50 wheat. |
| Starting fish | 2 fish | 🆕 intended 10 fish. |
| Starting gold | 3 gold | 🆕 intended 3 gold (unchanged). |
| Starting iron / blueprints | 0 / 0 | 🆕 starting wood/iron TBD in new engine. |
| Re-applied on rollover? | no | ⚠️ Not re-stocked at season rollover today. |

🆕 **Intended new-engine season-start vault:** 3 gold + 50 wheat + 10 fish (wood/iron TBD).

## 6. Consumption, starvation, winter & cold damage

| Constant | Current value | Meaning |
|---|---|---|
| `WHEAT_UPKEEP_PER_CLANSMAN` | 1 wheat | Per clansman/tick, from vault only. |
| `FISH_UPKEEP_PER_CLANSMAN` | 0.1 fish | Per clansman/tick, from vault only. |
| Starvation trigger | missing wheat OR fish | Lacking either food for the tick's upkeep → starvation (halves gather yields). |
| `WINTER_UPKEEP_MULTIPLIER_BPS` | 20000 (2×) | Food upkeep doubles in winter (2 wheat + 0.2 fish/clansman/tick). |
| `WINTER_WOOD_BURN_PER_CLANSMAN` | 0.5 wood | Winter-only wood burn per clansman/tick, from vault. |
| `WINTER_WOOD_BURN_PER_BASE` | 1 wood | Winter-only wood burn per base/tick, from vault. |
| `COLD_DAMAGE_PER_WALL_DEGRADATION` | 2 | Cold dmg per wall-level stripped (walls degrade first; ~2 ticks/level). |
| `COLD_DAMAGE_PER_CLANSMAN_DEATH` | 2 | Cold dmg per clansman death once walls hit 0 (~1 death/2 ticks). |
| `WALL_HP_PER_LEVEL` | 100 | Structural HP per wall level (`LibBanditCombat`). |
| `BASE_HP_PER_LEVEL` | 25 | Structural HP per base level. |
| `CLANSMAN_HP` | 100 | HP per clansman. |

*(No separate non-lethal "freezing" state exists — the cascade goes wall-loss → death directly.)*

## 7. Building, upgrades & winning

**Wall upgrade cost** (`LibGameRules.wallUpgradeCost`, from current level):

| Level | Current value | Meaning |
|---|---|---|
| L0→1 | 20 wood | |
| L1→2 | 35 wood | |
| L2→3 | 30 wood + 5 iron | iron enters at L2+. |
| L3→4 | 40 wood + 10 iron | |
| L4→5 | 50 wood + 15 iron | |

**Base upgrade cost** (`baseUpgradeCost`, from current level):

| Level | Current value | Meaning |
|---|---|---|
| L1→2 | 40 wood + 20 wheat | |
| L2→3 | 60 wood + 5 iron + 30 wheat | |
| L3→4 | 80 wood + 10 iron + 40 wheat | |
| L4→5 | 100 wood + 15 iron + 50 wheat | 🆕 base upgrade was meant to unlock a 5th clansman — NOT implemented. |

**Monument upgrade cost** (`monumentUpgradeCost`, from current level — the win objective):

| Level | Current value | Meaning |
|---|---|---|
| L0→1 | 30 wood + 20 wheat | |
| L1→2 | 50 wood + 30 wheat | |
| L2→3 | 70 wood + 5 iron + 40 wheat | iron from L2. |
| L3→4 | 90 wood + 10 iron + 50 wheat | |
| L4→5 | 120 wood + 15 iron + 60 wheat | |
| L5→6 | 150 wood + 20 iron + 80 wheat | |
| L6→10 | 200 wood + 25 iron + 100 wheat + 1 blueprint | blueprint required per level from L6. |
| `MONUMENT_MAX_LEVEL` | 10 | Highest monument level. |

**Win ranking** (`LibScoring`, identical to season-end finalize):

| Tiebreak order | Current value | Meaning |
|---|---|---|
| 1. Monument level | highest | Dominant ranking key. |
| 2. Time to reach it | earliest | `monumentReachedAtTick` (lower wins). |
| 3. Loot value | highest | weighted: **wood + wheat + 2×fish + 4×iron** (`lootValue`). |
| 4. Wall level | highest | |
| 5. Clan ID | lowest | Final tiebreak. |

## 8. Bandits, defense & the rampage

| Constant | Current value | Meaning |
|---|---|---|
| `MAX_TOTAL_BANDITS` | 1 | Only one bandit exists world-wide at a time. |
| `BANDIT_COOLDOWN_TICKS` | 10 | Cooldown after any spawn before next spawn eligible. |
| Spawn base probability | 10% (first roll) | ⚠️ Starts 10%, climbs +10%/tick (`BANDIT_SPAWN_PROBABILITY_INCREMENT_BPS = 1000`) — not 20%+5%. 🆕 revisit ramp. |
| `BANDIT_SPAWN_MAX_PROBABILITY_BPS` | 8000 (80%) | Spawn probability cap. |
| `BANDIT_CAMP_TICKS` | 3 | Camped duration before attack. ⚠️ uniformly 3 (not "3 then 2"). |
| Spawned→Camped delay | +1 tick | Spawned state lasts 1 tick before camping (`LibBanditLifecycle`). |
| `BANDIT_TIER_COUNT` | 5 | Tier count. ⚠️ tier is **uniformly random 1–5**, no escalation. 🆕 intended escalating (1×3 → 2×3 …). |
| Attack power by tier | T1 30 · T2 45 · T3 60 · T4 80 · T5 95 | `getBanditAttackPower` (`LibBanditSpawning`). |
| Defeat ratio | ≥ 2× attack power | ⚠️ Defeat needs clansman defense ≥ 2× bandit power; only clansman/defender points count. A 1:1 tie LOSES. 🆕 intended tie → loot protected. |
| `DEFEND_BASE_DEFENSE` | 10 | Defense points per active DefendBase defender in target region. |
| `WAITING_HOME_DEFENSE` | 5 | Defense points per idle (WAITING) clansman at its own base. |
| `BANDIT_BASE_STEAL_BPS` | 2000 (20%) | Fraction of (weighted-spendable) vault stolen on a successful raid. |
| `BANDIT_DROP_TO_DEFENDERS_BPS` | 5000 (50%) | ⚠️ On bandit defeat, only 50% of carried loot drops to defenders; other 50% burned. 🆕 intended 100% to defenders. |
| `BANDIT_MAX_ATTACK_ATTEMPTS` | 6 | Bandit leaves on its own after 6 attack-attempts (≈ one loop). |
| Base placement | `(clanId-1) % 6` | ⚠️ Deterministic round-robin over 6 base-eligible regions, not random. 🆕 consider random. |
| Defeat reward | +1 blueprint + 1 gold | ⚠️ Flat (not random/per-bandit), to the **base owner** not defenders. |

**Movement ring:** Forest → Mountains → East Farms → East Docks → West Docks → West Farms → (loop). Target on multi-base region = highest `lootValue` (weighted). 🆕 New-engine intents also include folding wall+base into the defense SUM (so they help *win*) and deciding whether raids should kill clansmen at all (current clansman-death is unplanned drift).

## 9. Trading & economy

| Constant | Current value | Meaning |
|---|---|---|
| AMM model | constant-product x·y=k | Uniswap-v2-style, one pool per resource paired with gold (`StubPool`). |
| Swap fee | 0% (fee-less) | No 0.3% fee; ClanWorld is sole swapper. |
| Wood/Gold pool seed | 1000 wood / 500 gold | `INITIAL_WOOD_POOL_SEED` / `INITIAL_GOLD_SEED_FOR_WOOD`. |
| Wheat/Gold pool seed | 1000 wheat / 700 gold | `INITIAL_WHEAT_POOL_SEED` / `INITIAL_GOLD_SEED_FOR_WHEAT`. |
| Fish/Gold pool seed | 500 fish / 600 gold | `INITIAL_FISH_POOL_SEED` / `INITIAL_GOLD_SEED_FOR_FISH`. |
| Iron/Gold pool seed | 250 iron / 800 gold | `INITIAL_IRON_POOL_SEED` / `INITIAL_GOLD_SEED_FOR_IRON` (iron most gold-expensive). |
| Sell slippage protection | none | ⚠️ No min-gold-out — sells are sandwichable (intentional arbitrage surface today). |
| Buy slippage cap | `maxGoldIn` (required) | Buy = exact-output (`marketAmount` = amount-out); fails on `ERR_CARRY_FULL` / exceeding `maxGoldIn` / insufficient gold. 🆕 intended: burn carry-overflow instead of failing. |

*Spot market trades against carried resources only; OTC/transfers use vault. Gold is global (vault `goldBalance`), never carried.*

## 10. Communications

| Constant | Current value | Meaning |
|---|---|---|
| Whisper recipients | 1-to-1 | Strictly single-recipient (`elder peer whisper`). 🆕 kept 1-to-1, no one-to-many. |
| Message rate limit | none | ⚠️ No rate limits today (intentionally unrestricted). |
| Message-size cap | none | ⚠️ No size caps today. |
| Inbox-size limit | none | ⚠️ No inbox-size restriction today. |
| Bulletins per clan | "3" (Liam's design) | ⚠️ Last-3-per-clan is intended design but **not found enforced** in the CLI (Convex-side or unbuilt). 🆕 idea: global 3-slot board. |
| Between-season wipe | none | ⚠️ Message history (inboxes + bulletins) NOT wiped at season end — bleeds across seasons. 🆕 intended to wipe. |
| New-message notifications | none | 🆕 intended runner pings on new whisper/bulletin (ping only, never the text) — not built. |

## 11. Memory & continuity

| Constant | Current value | Meaning |
|---|---|---|
| `memoryWipeTickInterval` | 50 | Elder context wiped every 50 ticks (same value as §2; agent-layer). |
| `ANCIENT_WISDOM.md` | agent-writable | Workspace file read at session start. 🆕 intended read-only, updated via elder CLI only. |
| Key-value scratchpad | persists across wipes | `elder memory save/recall`; file-backed via `FileMemoryStore` at `~/.world/clanworld-runner/state/elder-{N}-memory.json`. Convex `memoryEntries` is a separate cockpit mirror — flushing Convex does NOT reset the scratchpad. |

## 12. Revival & admin recovery

| Constant | Current value | Meaning |
|---|---|---|
| Revive authority | contract-owner only | `reviveClansman` / `reviveDeadClansmen` — operator-only, NOT a player action; death is permanent in-season for players. |
| Revive cost | free | No resource/gold cost. |
| Revive landing | base region, WAITING | Restores dead clansmen at clan base; clears dead flag; reactivates clan (coldDamage→0, starvationStartsAtTick→0). |
| `injectClanResources` args | wood, iron, wheat, fish, gold | Adds resources/gold straight to vault. ⚠️ revive into empty vault re-starves next tick (#609) — inject food alongside. |

## 13. Tick events & prompt templates (agent-runner layer)

Trigger offsets computed in `packages/runner/src/templateLoader.ts` (`selectTemplates`):

| Template | Trigger | Meaning |
|---|---|---|
| `00_game_start` | tick == 0 | Kickstart the agent. |
| `05_pre_memory_wipe_5ticks` | 5 ticks before wipe | ⚠️ 5 ticks (Liam recalled 10). |
| `06_pre_memory_wipe_1tick` | 1 tick before wipe | |
| `07_post_memory_wipe` | first tick after wipe | tick % `memoryWipeTickInterval` == 0 (tick > 0). |
| `10_pre_winter_10ticks` | `winterStartTick - tick == 10` | 10 ticks before winter. |
| `11_winter_started` | tick == `winterStartTick` | |
| `12_winter_ended` | tick == `winterStartTick + winterDurationTicks` | |
| `20_bandits_appeared` | bandit spawn event | The camp warning. |
| `21_bandits_attacking` | bandit ATTACKING event | |
| `22_post_bandit_attack` | after raid resolves | Won or lost. |
| `99_clansmen_revived_and_resources_injected` | operator revive/inject event | The no-silent-injection disclosure ping. |

*Templates are event/tick-derived; several can fire on one tick; missing files are skipped. 🆕 Liam's intended new-whisper / new-bulletin notification pings slot in here (ping only, never the message text).*

---

## Change log

| Date (ET) | Change |
|---|---|
| 2026-05-26 | Initial constants reference compiled from `WORLD_PHYSICS.md` (v1) + verified against `IClanWorld.sol`, `LibGameRules.sol`, `LibBanditCombat.sol`, `LibBanditSpawning.sol`, `LibScoring.sol`, `DeployDiamond.s.sol`, runner `templateLoader.ts`. Sections match `WORLD_PHYSICS.md` order. |
