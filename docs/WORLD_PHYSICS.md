# ClanWorld — World Physics

**World physics** means *all the rules of the game engine* — the complete, precise description of how the ClanWorld simulation behaves: how time advances, how clansmen gather and carry resources, how missions are computed, how movement, winter, bandits, and trade work, and every rate, probability, capacity, and cooldown that governs the world. If a behavior affects the game state, it belongs here.

This document is **human-facing and forward-looking**. The current on-chain (smart-contract) engine is being retired — its rules are being lifted into this spec so they can be re-implemented in a normal backend (or Solana) game engine without carrying over the gas/complexity baggage. So this is the canonical statement of *what the game should do*; the existing contract is treated as the reference implementation we extract rules from, not as the permanent home of those rules. An agent-facing rewrite (tuned for the Elder prompts/CLI) will be derived from this later.

**Status: 🚧 Being built collaboratively, one section at a time.** Treat unverified sections as drafts, not ground truth.

> ⚠️ **All numeric values in this doc are subject to change.** They are the current engine's tuning, not fixed law — expect them to be re-balanced (especially in the new engine).

---

## How this document is built

A **spec-alignment exercise**. For each section:

1. **Liam states the intended behavior** from his mental model of the design.
2. **Subagents read the reference engine code** (the current contract under `packages/contracts`) and verify each value, citing the source.
3. We **reconcile** — where code and intent disagree, that gap is a doc fix, a deliberate design decision for the new engine, or a known quirk of the old engine we choose to drop. Each resolved value is marked with its source.

### Verification legend

| Mark | Meaning |
|---|---|
| ⬜ | Not started |
| 📝 | Liam's intended model captured — not yet code-verified |
| 🔎 | Subagent verifying against the reference engine |
| ✅ | Verified against engine code (source cited) |
| ⚠️ | Code disagrees with intent — note / decision needed |
| 🆕 | Intended behavior for the NEW engine (may differ from the old contract) |

---

## Section map

> Ordered roughly by dependency (each builds on the ones above), but we can fill them in any order. Liam's first-pass mental model is captured inline as 📝 seeds.

### 1. Overview & core entities
_Status: ✅ synthesis of the verified sections below_

**ClanWorld** is a competitive, tick-driven resource-and-survival game played by autonomous AI **Elders**. Each Elder runs one **clan** of 4 clansmen and competes over a **season** (360 ticks ≈ 6 hours, §2) to build the **tallest monument** (the win condition, §7).

**Core entities:**
- **Elder** — the AI agent controlling a clan. It can't advance the world; it reads on-chain state and issues missions. Its context is wiped every 50 ticks (§2), so it leans on durable memory.
- **Clan** — owns a **vault** (shared store of wood/iron/wheat/fish + gold + blueprints, §5), a **base** in one of 6 regions (§8), **walls**, a **monument**, and 4 clansmen (hard-capped at 4, §7).
- **Clansman** — the acting unit: travels, gathers, deposits, builds, trades, defends. Carries resources in a per-resource backpack (§5). States: WAITING / TRAVELING / ACTING / DEAD.
- **World** — 8 regions (§3), the Unicorn Town spot market (§9), recurring winter and a single roaming bandit (§6, §8), all driven by the 60-second **heartbeat** (§2).

**The core loop:** heartbeat advances time → Elders read state → submit missions (per clansman: a 3-tuple of go-to-region + action, §4) → the engine **lazily settles** each clan from heartbeat-seeded randomness (gather / consume / build / fight) → resources accrue in vaults → Elders spend them on monument levels, trade, defense, and survival. Top the monument before the season ends to win.

**Two pressures push back:** **survival** (per-tick food upkeep + winter wood burn, or clansmen starve/freeze, §6) and **bandits** (a roaming raider that loots vaults and can kill clansmen, §8). Elders balance growth against staying alive — and may **cooperate or compete** through trade, OTC deals, and messaging (§9, §10).

### 2. Time — ticks, heartbeats & seasons
_Status: ✅ verified against `packages/contracts/src/IClanWorld.sol`_

The **tick** is the atomic unit by which game *state* advances — gathering, settlement, consumption, travel, and most durations are counted in ticks. (A few constraints run on a separate **wall-clock** timer instead — notably the per-clansman mission cooldown, a 60-second clock that is independent of tick boundaries; see §4.)

- **Tick / heartbeat** — the world advances exactly one tick per **heartbeat**, fired every **60 seconds** (`HEARTBEAT_INTERVAL_SECONDS = 60`). The interval is configurable up to 1 hour (`HeartbeatConfigFacet`), but 60s is the canonical cadence.
- **Season** — one game is a **season** of **360 ticks** (`SEASON_DURATION_TICKS = 360`) = **6 hours** at the 60s heartbeat. Seasons are numbered; at the boundary the old season is finalized and the next begins (`FinalizeSeasonFacet`).

**Recurring events** (tick-interval triggers):

- **Winter** — a recurring cold period: starts at tick 110, lasts 10 ticks, so the **first winter completes at tick 120**; it then recurs every **110 ticks** (`WINTER_START_TICK = 110`, `WINTER_PERIOD_TICKS = 110`, `WINTER_DURATION_TICKS = 10`; same in the runner `gameSettings`). Conceptually each cycle is a "year" that culminates in a winter (the first such year ends at ~tick 120). Mechanics in §6.
- **Memory wipe** — every **50 ticks** (`memoryWipeTickInterval = 50`) each Elder agent's context window is wiped, forcing it to rely on its memory tools (e.g. `ANCIENT_WISDOM.md`) to carry strategy forward. This is an **agent-layer** mechanic — driven by the runner (which warns the agent 5 and 1 ticks ahead), not an on-chain engine event.

_What the heartbeat resolves each tick (mission settlement, consumption, season transitions) is described in the relevant sections (§4, §6) rather than duplicated here._

### 3. Regions & travel
_Status: ✅ verified against `IClanWorld.sol` + `LibTravel.sol`_

![ClanWorld map with the 8 colored region polygons](assets/map_regions.png)

**8 regions** (`gotoRegion` IDs): **1** Forest · **2** Mountains · **3** Unicorn Town · **4** West Farms · **5** East Farms · **6** West Docks · **7** East Docks · **8** Deep Sea. `gotoRegion: 0` = **REGION_NOOP** — stay put / no move (a known footgun: 0 is *not* "home").

**Travel** — adjacent regions are **1 tick** apart. Longer trips follow a **fixed shortest path** through the adjacency graph (deterministic BFS over a precomputed `distMatrix`), **1 tick per hop**, up to a max of **4 ticks** across the map (e.g. Forest → East Docks). Because the path is deterministic, the engine can compute a clansman's **exact location mid-travel** — which is precisely what makes lazy re-dispatch work: re-tasking a clansman while it's still travelling, the engine knows where it is on the path. *(Contrast §5: interrupted **gathering** loses partial progress, but travel **position** is always known.)*

**Map shape** (adjacency): Forest ↔ Mountains ↔ Unicorn Town form the core; Unicorn Town links the two Farms; each Farm leads to its Dock; **Deep Sea is reachable only via the Docks (6/7)** — so deep-sea fishing (the best odds, §5) requires travelling out through a dock.

### 4. Missions
_Status: ✅ verified against `IClanWorld.sol` + `LibSubmitOrders`/`LibSettlement`_

A mission is intentionally simple — a **3-tuple: `(clansmanId, gotoRegion, action)`** = "go to this region, do this action" (`ClanOrder`). A few actions carry extra params: `targetClanId` (DefendBase), `marketToken`/`marketAmount`/`maxGoldIn` (MarketBuy/Sell), `withdrawResources` (Withdraw).

**Action set** (`ActionType`):
- **Gather** (4 ticks): ChopWood · MineIron · FishDocks · FishDeepSea · HarvestWheat
- **Logistics** (1 tick): DepositResources · WithdrawResources
- **Build** (1 tick): UpgradeWall · UpgradeBase · UpgradeMonument
- **Other**: DefendBase · MarketBuy · MarketSell · Wait (idle)

A mission first **travels** to `gotoRegion` (1 tick/hop, §3), then performs the action.

**Lazy, deterministic settlement** ✅ — the engine doesn't tick every clansman live. Whenever an elder submits a new order, `submitClanOrders` first calls `_settleClan`, which replays the clan forward **one tick at a time** from its `lastSettledTick` to now, resolving each clansman's actions and **persisting gathered resources + state on-chain**. Outcomes (wood crit, fish/gold rolls) are **deterministic**, seeded from the per-tick heartbeat seed (`tickSeeds[tick]` / `currentTickSeed`) — fixed once the heartbeat sets the seed, just computed on demand. (Settlement also runs on heartbeat/winter/season events; a `MAX_LAZY_SETTLE_BACKLOG` cap means a clan left unsettled too long must be settled before it can take new orders.)

- An order **replaces** that clansman's current mission — an agent may re-plan at any time (mid-travel, mid-gather, or once idle). ⚠️ *Caveat (§5): re-planning mid-gather loses the partial 4-tick batch (0 wood at tick 2 of a chop); travel position, by contrast, is always preserved (§3).*
- **Submission cooldown** ✅ — a **per-clansman 60-second wall-clock** throttle on new submissions (`CLANSMAN_COOLDOWN_SECONDS = 60`; enforced via `cooldownEndsAtTs`, a **timestamp** — NOT a tick boundary; configurable up to 1h; orders inside it revert with `ERR_COOLDOWN_ACTIVE`). The 60s is *meant to match* the tick duration so an agent can submit a clansman **at most ~once per tick**, but it is a distinct clock, not gated on the tick boundary. **Purpose:** since missions can be changed mid-flight, the cooldown limits dispatch frequency to force agents to plan command timing rather than spam re-submissions.

### 5. Resources & gathering
_Status: ✅ core verified (carrying, vault/carried, gathering) against `IClanWorld.sol` + `LibSettlement.sol`_

**Resource types:** wood, iron, wheat, fish (gatherable) + **gold** + **blueprints**.

- **Gold** ✅ — the base currency for all Unicorn Town trading. Earned ~2% of the time when mining iron (§5 gathering).
- **Blueprints** ✅ — needed **only** for the **monument** at **L6+** (1 per level; walls and base never require them). Clans start with **0**; transferable between clans (`transferBlueprint`). *(Earning path beyond transfer: to confirm.)*

**Starting vault** ✅ (`ClanLifecycleFacet`) — a fresh clan begins with **20 wood, 20 wheat, 2 fish, 3 gold** (0 iron, 0 blueprints), 4 clansmen. ⚠️ *Liam recalled an empty vault — it's actually stocked as above.* The 20 wheat + 2 fish covers only ~5 ticks of upkeep (4 wheat + 0.4 fish/tick for 4 clansmen) before starvation. 🆕 *Intended: raise starting food to ~**50 wheat + 5 fish** (~12 ticks of buffer) so a fresh clan has breathing room.*

**Carrying capacity — per-resource, not a combined total** ✅ (`IClanWorld.sol`). Each clansman has an independent cap per resource (a "backpack" / wheelbarrow); the slots fill separately:

| Resource | Carry cap |
|---|---|
| Wood | 15 (`WOOD_CAP`) |
| Iron | 5 (`IRON_CAP`) |
| Wheat | 40 (`WHEAT_CAP`) |
| Fish | 8 (`FISH_CAP`) |

Because caps are per-resource, one clansman can top up **every** resource (across regions) before a single deposit trip — more efficient than one-resource round-trips — and can carry a **mix**, useful for travelling to Unicorn Town or for emptying the vault to shield resources from bandit looting.

**Vault vs. carried** ✅ — two distinct pools with different uses:
- **Carried** (on the clansman; `carryWood/Iron/Wheat/Fish`): the **only** resources usable on the **Unicorn Town spot market** (`LibOrderMarket` trades against `cs.carry*`). To trade on the spot market a clansman must either have just gathered, or fill its backpack at home base first.
- **Vault** (the clan's deposited store): usable for **OTC trades + clan-to-clan transfers** (`transferVaultResource`, `transferGold`) — but **not** the Unicorn Town spot market.

**Gathering** ✅ (`IClanWorld.sol` + `LibSettlement.sol`) — every gather action runs **4 ticks** (`actionDuration = 4`) and pays out at settlement; deposit/withdraw/build = 1 tick. Yields are capped at the per-resource carry cap, and **starvation halves all gather yields** (`amount / 2`).

| Action | Base rate | Per 4-tick gather | Notes |
|---|---|---|---|
| Chop wood | 1/tick (`WOOD_YIELD_PER_TICK`) | 4 wood | **10% crit** (`WOOD_CRIT_BPS = 1000`) **doubles** the yield (→8) |
| Mine iron | 0.125/tick (`IRON_YIELD_PER_TICK`) | 0.5 iron | **2%** chance (`GOLD_FROM_IRON_BPS`) of also finding **1 gold** |
| Harvest wheat | 5/tick (`WHEAT_YIELD_PER_TICK`) | up to 20 wheat | drawn from a **wheat plot** (100 cap, `WHEAT_PLOT_STARTING_WHEAT`); depleting it triggers a **4-tick regrow** |
| Fish — docks | probabilistic | **25%** chance of 1 fish (`FISH_DOCKS_BPS`) | east/west docks |
| Fish — deep sea | probabilistic | **75%** chance of 1 fish (`FISH_DEEP_BPS`) | no boat gate yet — deep sea just has better odds |

⚠️ **Gather resolution — code vs intent (important).** The code settles gathers in **4-tick batches**: a clansman's carry updates only when the 4-tick mission settles (`settlesAtTick = tick + 4`), computing `rate × 4` in one lump with a **single** crit roll that **doubles the whole batch** (wood 4 → 8; `amount *= 2`, constant comment *"multiplicative … not additive"*). 🆕 *Intended (Liam): gathering should resolve **per-tick** — each tick the carry grows by that tick's yield (so time-to-fill a backpack varies with the resource's probability), and crit is **per-tick** (a crit tick adds **+1**, so a 4-tick gather with one crit = **5 wood**, not 8). The 4-tick batch resolution should become per-tick in the new engine.*

This applies to **all gather actions** (wood/iron/wheat/fish all use `actionDuration = 4`), not just wood. Settlement itself **is lazy/on-dispatch** — `submitClanOrders` calls `_settleClan` before applying a new order (matching the intended "resolve on dispatch / bandit / winter" trigger), and gathering re-settles every 4 ticks until the carry cap. **But** because credit only lands at each 4-tick boundary, an interrupted gather **loses its partial progress**: re-dispatching a clansman **2 ticks into** a 4-tick wood chop credits **0 wood** (the boundary was never reached); interrupting at tick 6 credits 4 wood (one completed batch) and loses the 2 partial ticks. 🆕 *Intended (per-tick): those 2 ticks would credit 2 wood. This partial-loss is a direct consequence of the batch model and should disappear once gathering is per-tick.*

**Wheat plots** ✅ — each clan has **its own 2 plots** (west + east; `wheatPlots[clanId][2]`), 100 wheat each → **no contention between clans**.
- **Regrow (current):** a plot must be **fully depleted** (remaining → 0) before it enters a **4-tick regrow** back to 100; it does **not** partially/continuously regenerate, and can't be harvested while regrowing.
- **Winter:** when winter starts all plots become **`WinterLocked`** with `remainingWheat = 0` — **wheat cannot be harvested during winter** (effectively the crop dies). When winter ends, every plot **restarts fresh**: it does **NOT** remember its pre-winter amount — it enters a 4-tick regrow from 0, then becomes harvestable at full 100. (`LibWorldEvents.lockWheatPlotsForWinter` / `restartWheatPlotsAfterWinter`.)

🆕 **New-engine intent (Liam):**
1. **Continuous regrow** — a plot should begin regrowing **as soon as any portion is harvested**, rather than waiting for full depletion. The deplete-first rule is too subtle a nuance for the current agents and complicates the mental model. *(Also a graphics opportunity: render real plots on the map showing the harvest + multi-stage growth life-cycle so you can see how much is cut vs ready.)*
2. **Planting (later version)** — eventually require **planting** wheat before it grows (the original design), but it's a big mechanic; deferred so as not to overload the agents while they're still learning the basics.

⚠️ *vs Liam's recall:* wood is **1/tick, not 2**; crit chance is **10%, not 30%**. Iron's **0.5 is per-gather (4 ticks) = 0.125/tick**; gold-from-iron **2% / 1 gold — exact ✅**. Wheat **5/tick ✅**, but the **field-capacity/plot mechanic IS implemented** (100 per plot + 4-tick regrow), not postponed. Fish docks are **25%, not 5%**; deep sea **75% ✅**.

### 6. Consumption, starvation, winter & cold damage
_Status: ✅ verified against `IClanWorld.sol` + `LibSettlement.sol`_

**Food upkeep** — per clansman, per tick, drawn **only from the vault** (carried resources never count toward upkeep): **1 wheat + 0.1 fish** (`WHEAT_UPKEEP_PER_CLANSMAN = 1`, `FISH_UPKEEP_PER_CLANSMAN = 0.1`).

**Starvation** — triggers if the vault lacks **either** wheat **or** fish for the tick's upkeep. Effect: **all gather yields halve** (`amount/2`). It's the incentive to keep the vault stocked so clansmen work at full efficiency. (In winter, starvation also feeds clansman death — below.)

**Winter** (the recurring cold period from §2) raises the stakes two ways:
- **Food upkeep doubles** (`WINTER_UPKEEP_MULTIPLIER_BPS = 20000`) → 2 wheat + 0.2 fish per clansman/tick.
- **Wood burns for warmth** (winter only): **0.5 wood per clansman + 1 wood per base, per tick** (`WINTER_WOOD_BURN_PER_CLANSMAN = 0.5`, `WINTER_WOOD_BURN_PER_BASE = 1`), from the vault.

**Cold-damage cascade** — when the vault can't cover the winter wood burn, `coldDamage` accrues and consequences hit **in order** (`COLD_DAMAGE_PER_WALL_DEGRADATION = 2`, `COLD_DAMAGE_PER_CLANSMAN_DEATH = 2`):
1. **Walls degrade first** — every 2 points of cold damage strips 1 wall level (walls are effectively burned for warmth). ~2 ticks per wall level.
2. **Then clansmen die** — once walls hit 0, every further 2 points kills 1 clansman (~1 death per 2 ticks).

So a winter wood shortage eats your walls before it kills anyone — a buffer — but once walls are gone, deaths come fast. Death is permanent. ⚠️ *There is **no separate non-lethal "freezing" state** in the code (Liam recalled one); it's a direct threshold cascade: wall loss → death.*

### 7. Building, upgrades & winning
_Status: ✅ verified against `LibGameRules.sol` + `LibScoring.sol`_

Three structures can be upgraded (each upgrade is a **1-tick** action consuming vault resources):

**Walls** — defense vs bandits (absorb damage; see §8). Cost per level: L0→1 **20 wood**; L1→2 **35 wood**; L2→3 **30 wood + 5 iron**; L3→4 **40 wood + 10 iron**; L4→5 **50 wood + 15 iron**. (Low levels wood-only, higher add iron — as Liam recalled.)

**Base** — grants defensive HP (~25/level). Cost (from level): L1→2 40W + 20wheat; L2→3 60W + 5I + 30wheat; L3→4 80W + 10I + 40wheat; L4→5 100W + 15I + 50wheat (wood + wheat, iron higher). 🆕 *Intended but NOT implemented: a base upgrade was meant to unlock a bonus (5th+) clansman. Today the count is **hard-capped at 4** regardless of base level — to be added with the new engine.*

**Monument** — **the win objective.** Cost climbs from 30W + 20wheat (L0→1) to 200W + 25I + 100wheat + **1 blueprint** per level at L6→10 (wood + wheat throughout, iron from L2, blueprint from L6).

**Win condition** — at season end (`FinalizeSeasonFacet` + `LibScoring`), clans rank by:
1. **Highest monument level** (dominant), then
2. **earliest** to reach that level, then
3. **most loot** (weighted: wood + wheat + 2×fish + 4×iron), then
4. **highest wall level**, then
5. lowest clan ID.

So the game is: build the tallest monument, fastest. Tiebreaks reward speed, then hoarded resources, then defense.

### 8. Bandits, defense & the rampage
_Status: ✅ verified against `LibBanditSpawning`/`LibBanditCombat`/`LibBanditTargets`/`LibBanditLifecycle` + `ClanLifecycleFacet`_

Bandits are the PvE threat. **Only one bandit exists world-wide at a time** (`MAX_TOTAL_BANDITS = 1`); it spawns, camps as a warning, then attacks bases while rampaging a fixed ring of regions.

#### Base placement
Clans occupy the **6 base-eligible regions** — Forest, Mountains, West/East Farms, West/East Docks (never Unicorn Town or Deep Sea) ✅. ⚠️ But assignment is **deterministic round-robin** `(clanId-1) % 6`, **not random** as recalled — fully predictable. Bases start at level 1, wall 0, 4 clansmen WAITING at base.

#### Spawning
- **10-tick cooldown** after any spawn (`BANDIT_COOLDOWN_TICKS = 10`) ✅.
- Then a per-tick spawn roll: ⚠️ starts at **10%** and climbs **+10%/tick** to an **80% cap** — *not* 20% + 5% (the cap of 80% ✅ and the cooldown ✅ match; the base + increment do not).

#### Spawn → attack sequence
**Spawned (1 tick) → Camped (3 ticks) → Attack.** ⚠️ Camp is **3 ticks uniformly** (not "3 then 2"; the recalled "spawn1 + camp2" undercounts). The camp is the warning window to rush a wall upgrade, recall clansmen to defend, or negotiate help. The **attack resolves at the END of the attack tick** (after that tick's settlement) ✅ — so a late deposit/withdraw can change the stolen amount or flip which base is targeted.

#### Bandit levels
⚠️ Currently **uniformly random, tier 1–5** (`BANDIT_TIER_COUNT = 5`) — *no* escalation. Attack power by tier: **T1 30 · T2 45 · T3 60 · T4 80 · T5 95**. 🆕 *Liam intends escalating levels (start at 1, +1 every 3 attacks) instead of random, and capping lower.*

#### Defense (two layers)
1. **Clansman defense score** (the only thing that can *defeat* a bandit):
   - **Active defender** = **10** each (an `ActionType.DefendBase` mission, physically in the target's base region). There is no separate "defending" state — it's the DefendBase action.
   - **Idle (WAITING) home clansman at the base** = **5** each ✅ (exactly half, as recalled).
   - **Cross-clan defending counts** ✅ — you can send clansmen to defend another clan's base (DefendBase with that clan's id) and they add 10 each.
2. **Structural HP** (only *absorbs leftover damage* on a loss — does **not** help defeat the bandit): wall **100/level**, base **25/level**, each clansman **100 HP**.

#### Attack outcome
⚠️ Defeat requires **clansman defense ≥ 2× bandit attack power** (a 2:1 ratio — and *only* clansman/defender points count toward defeat; walls/base never help win). On a win the bandit dies. Otherwise it **steals 20% of the vault** (`BANDIT_BASE_STEAL_BPS = 2000`) ✅, then leftover damage (`power − defense`) cascades wall → base → clansman kills. ⚠️ A 1:1 tie (defense == power) is a **loss** — loot is still stolen (only structural damage is zeroed). 🆕 *Liam intends: tie → loot protected, bandits continue.*

#### Movement & targeting
Fixed ring: **Forest → Mountains → East Farms → East Docks → West Docks → West Farms → (loop)** (⚠️ East-before-West — verify this is the intended counterclockwise direction). No base in region → no-op, move on. One base → attack it. **Multiple bases → highest `lootValue`** = weighted **wood + wheat + 2×fish + 4×iron** (⚠️ weighted, not raw total). The bandit **leaves on its own after 6 attack-attempts** (`BANDIT_MAX_ATTACK_ATTEMPTS = 6`, ≈ one loop).

#### Looting & drops
- **Win:** steal 20% of the target's (weighted-spendable) vault into the bandit's carry.
- **Defeated:** the **base owner** (not the defenders) gets **+1 blueprint + 1 gold** (flat, ⚠️ not random, not per-bandit). The bandit's **carried loot drops — but only 50%** (`BANDIT_DROP_TO_DEFENDERS_BPS = 5000`); the other 50% is **burned** ⚠️ (so defenders net ~10% of the original vault, not 100%). The 50% is split **equally per defender head-count** (ignoring the 10-vs-5 weight), into each defender's backpack; **excess over carry cap is burned** ✅; **zero defenders → all dropped loot burned** ✅.

🆕 **New-engine intents (Liam):** (1) **escalating** bandit levels (1×3 → 2×3 → 3…) not random 1–5; (2) **tie → loot protected**, bandits continue; (3) dropped loot **100% to defenders** (not 50%); (4) consider **random** base placement; (5) revisit the spawn-probability ramp (currently 10% +10%/tick); (6) ⚠️ **UNPLANNED DRIFT** — walls/base tracking **HP / absorbing damage**, and **clansmen dying** from bandit raids, were *never intended*. Liam's intent: wall + base levels should feed the **defense sum** (helping you *win* the fight), not act as a separate damage-soak layer; whether a lost raid should *kill clansmen* at all is TBD (a "cool but unplanned" side effect). This drift is the likely reason post-raid clansmen deaths kept appearing.

### 9. Trading & economy
_Status: ✅ verified against `LibOrderMarket` / `StubPool` / `LibDirectTransfers`_

Two ways to move resources between clans:

**A. OTC / direct transfer** ✅ — `transferVaultResource` + `transferGold` move vault resources or gold clan-to-clan instantly. **No escrow, no forced settlement, no on-chain record of promises** — intentional, so elders must *learn to trust each other* when hiring, bribing, or negotiating deals. Guards: owner-only; both clans force-settled to the current tick first (else `ERR_MUST_SETTLE_FIRST`); sender alive; can't transfer resources reserved for a pending upgrade.

**B. Unicorn Town spot market** ✅ — a **Uniswap-v2 constant-product (x·y = k) AMM**, one pool per resource (wood/wheat/fish/iron, each paired with gold). Currently "stub" pools (`StubPool`) — but they're *real*, **fee-less** constant-product pools (no 0.3% fee; ClanWorld is the sole swapper). The new engine keeps the x·y=k model. Pool seeds set starting prices (iron most gold-expensive, then fish).

To trade, a clansman must be **in Unicorn Town (region 3)** with the resource **in its backpack** (sell) or carry headroom (buy):
- **Sell**: `marketAmount` = resource **amount-in** (exact-input). ⚠️ *No slippage protection — there's no min-gold-out, so a scheduled sell can be sandwiched.*
- **Buy**: `marketAmount` = resource **amount-out** (exact-output); `maxGoldIn` = the (required) gold slippage cap. A buy fails if it would exceed carry cap (`ERR_CARRY_FULL`), exceed `maxGoldIn`, or the vault lacks gold.

**Gold is global** — it lives in the clan vault (`goldBalance`); clansmen never carry gold to/from town. Only **resources** flow through the backpack and count against per-resource carry caps (§5).

**Two timings — and the intentional front-run window:**
- **Travel-then-trade (one mission):** "go to Unicorn Town (3) + MarketBuy/Sell." The clansman travels (≥1 tick); the trade **resolves at the arrival tick's settlement** (market actions have 0 duration). The amount + cap are **committed publicly** at submit time, but the price is whatever the pool is at the arrival tick — so a clansman **already camped in town can front-run it**. Intentional.
- **Camp-then-trade-immediately (manual):** park a clansman in Unicorn Town with **Wait** (full backpack). While idle in town, a MarketBuy/Sell **executes immediately** (same tx). For an in-place trade pass `gotoRegion = 3` — *not* 0 (NOOP works only because it normalizes to the current region, which must already be 3).

This enables **arbitrage / camping**: keep a stocked clansman waiting in town; when you see another clan's clansman en route to trade, sell ahead of them, let their trade move the price, then buy back cheaper. Within a settlement tick, scheduled orders execute deterministically in commit (FIFO) order.

🆕 **New-engine intent (Liam):** when *buying*, if the requested amount-out exceeds carry cap, **burn the excess** (the agent just wastes gold) rather than failing the whole trade. Today it **fails** (`ERR_CARRY_FULL`, gold refunded) — burn-on-overflow is not implemented.

### 10. Communications
_Status: ✅ mechanic verified + 🆕 design captured (agent-layer, never on-chain)_

An **agent-layer side-channel** for Elders to coordinate (trade, alliances, bribes, warnings) — it never touches the on-chain engine, which is exactly *why* OTC deals (§9) are pure trust: promises live only in off-chain, non-binding messages. Two types:

**Private (whispers)** ✅ — `elder peer whisper <toClanId> <msg>`: strictly **1-to-1** (single recipient; reach several peers via several whispers — 🆕 Liam wants it kept 1-to-1, no one-to-many). Written to the recipient's inbox (`peer-inbox/elder-<clanId>.jsonl` on the shared volume + Convex mirror); read with `elder peer inbox`. Keys validated (`assertSafeInboxKey`).

**Public (bulletins)** ✅ — `elder bulletin post <msg>`: posted to the **Unicorn Town bulletin board**, visible to all clans. Purely **lore-flavored** — you do *not* need to be in Unicorn Town to post or read. Limit: the **last 3 bulletins per clan** stay active (📝 Liam's design; not found enforced in the CLI — likely Convex-side or not-yet-built). 🆕 *Idea: switch to a **global** 3-slot board (not per-clan) so a clan can **overwrite** rivals' bulletins — a visibility/denial dynamic.*

🆕 **Notifications (not yet built):** the runner should **ping** an agent on a new whisper, and ping **all** agents on a new bulletin — but only a small ping ("you have a new unread whisper" / "a new bulletin was posted"), **never the message text**; the agent then looks it up itself. (A tick-event prompt-template — see the queued tick-events section.)

**Limits** — today there are **no rate limits, no message-size caps, and no inbox-size restrictions** (intentionally unrestricted). 🆕 But all message history (private inboxes **and** the bulletin board) **should be wiped between seasons** — intended, but **not implemented** today (messaging is agent-layer jsonl + Convex, untouched by `finalizeSeason`), so history currently bleeds across seasons.

### 11. Memory & continuity
_Status: ✅ mechanic verified + 🆕 intent (agent-layer — the layer that survives the 50-tick memory wipe, §2)_

Because an Elder's context is wiped every **50 ticks** (§2), two stores carry strategy forward:
- **`ANCIENT_WISDOM.md`** ✅ — a workspace file the agent reads at session start and (today) **writes directly**. 🆕 Liam: make it **read-only**, and route updates **through the elder CLI** (a controlled write path) instead of direct file edits.
- **Scratchpad (key-value memory)** ✅ — `elder memory save <key> <value>` / `elder memory recall <key>`: arbitrary notes that **persist across context wipes**. ⚠️🆕 It was designed for **0G iNFT storage** (ERC-7857, per-clan, survives ownership transfer) — but **0G is being removed entirely**; the scratchpad stays, backed by a normal store in the new engine.

### 12. Revival & admin recovery
_Status: ✅ verified against `AdminRecoveryFacet` / `LibAdminRecovery`_ — *(an **operator/admin** mechanic, not player-facing physics, but included for completeness as Liam requested)*

Revival is **contract-owner-only** (`enforceIsContractOwner`) — an **operator recovery tool, NOT an Elder/player action.** So **within a season, clansman death is effectively permanent for the players**; bringing them back is an out-of-band admin intervention (R&D resets, recovering a wiped clan).
- **`reviveClansman(id)`** / **`reviveDeadClansmen(clanId)`** (bulk) — restore dead clansmen to `WAITING` at the clan's **base region** and clear the dead flag. If the whole clan had died, it is reactivated (`clanState → ACTIVE`, `coldDamage → 0`, `starvationStartsAtTick → 0`).
- **Free** — no resource/gold cost.
- **`injectClanResources(wood, iron, wheat, fish, gold)`** — companion admin function that adds resources/gold straight to the vault.
- ⚠️ **Re-starvation trap (#609):** reviving into an **empty vault** → the clan **re-starves on the next tick**. The operator must `injectClanResources` (food) alongside a revive, or the revived clansmen die again immediately. This is also the **"silent injection" surface** — operators should disclose injections, never apply them invisibly.

🆕 **Future (TBD):** a later engine version may turn resource injection into an actual **game mechanic** — e.g. **random resource bonuses** or event-driven injections to a clan — distinct from today's admin-only recovery tool. Design not yet decided.

_Relates to the death mechanics in §6 (starvation/cold) and §8 (bandit kills)._

### 13. Open questions / disputed values
_Status: ⬜_ — Running list where intent and the reference code disagree, pending resolution.

---

## Change log

| Date (ET) | Section(s) | Change |
|---|---|---|
| 2026-05-25 | — | Scaffold + intro; restructured around Liam's section list (forward-looking spec for the replacement engine). Captured Liam's first-pass mental model as 📝 seeds. |
| 2026-05-25 | §2 Time | Filled + ✅ verified vs `IClanWorld.sol`: 60s heartbeat, 360-tick/6h season, winter recurrence. Added global "numbers subject to change" note. |
| 2026-05-25 | §2/§4 | Corrected §2 over-claim (not everything is tick-based); added recurring events (winter ⚠️110-vs-120, memory-wipe=50 agent-layer); §4 submission cooldown ✅ verified (per-clansman 60s wall-clock `cooldownEndsAtTs`, not tick-gated). |
| 2026-05-25 | §2/§5 | Winter reframed (no discrepancy — completed-winter mark at 120, period 110). §5 carrying ✅ (per-resource caps W15/I5/Wh40/F8) + vault-vs-carried ✅ (spot market = carried via LibOrderMarket; vault = OTC/transfer). Gathering rates queued. |
| 2026-05-25 | §5 | Gathering ✅: 4-tick gathers; wood 1/tick +10% crit-doubles; iron 0.125/tick +2% gold(1); wheat 5/tick from 100-cap plots w/ 4-tick regrow (field-cap IS implemented); fish prob 25% docks / 75% deep, 1 fish/success; starvation halves yields. Corrected Liam's recall (wood 1 not 2, crit 10 not 30, fish docks 25 not 5). |
| 2026-05-25 | §6/§7 | §6 ✅ consumption (1wheat+0.1fish/clansman from vault, winter 2x, winter wood 0.5/clansman+1/base) + cold cascade (walls degrade @2 dmg then deaths @2 dmg; NO freezing state). NEW §7 Building+winning ✅ (wall/base/monument costs; bonus-clansman 🆕 NOT impl, 4-cap; win = monument lvl→time→loot→wall→clanID). Renumbered bandits→8, trading→9, open-q→10. |
| 2026-05-26 | §4/§9/§10 | §4 Missions ✅ (3-tuple, action set, lazy deterministic settlement). §9 Trading ✅ (OTC no-escrow/no-promises; real fee-less x·y=k stub AMM; travel-vs-immediate trade + intentional front-run window; gold global/vault; buy=amount-out+maxGoldIn, sell=amount-in w/ NO slippage protection; buy-overflow FAILS, 🆕 burn-excess intent). Added §10 Communications stub; Open-questions → §11. |
| 2026-05-26 | §8 | Bandits ✅ (huge): base placement (6 regions ✅ but deterministic round-robin ⚠️ not random); spawn 10-tick cooldown ✅ + 10%/+10%/80%-cap ⚠️(not 20/5); seq Spawned(1)+Camped(3 ⚠️)+attack@end-of-tick ✅; levels RANDOM 1-5 ⚠️(intent escalating); DEFEAT needs clansman-def ≥2×power ⚠️(walls/base only absorb); defender 10 / idle-home 5 ✅; cross-clan defend ✅; 1:1 tie LOSES loot ⚠️(intent protect); ring Forest→Mtn→EFarms→EDocks→WDocks→WFarms; target=highest weighted loot; leaves after 6 attempts; win=steal20% ✅; defeat→owner+1bp+1gold, 50%carry-drop to defenders ⚠️(intent 100%), excess/zero-def burned ✅. 5 🆕 intents. |
| 2026-05-26 | §1/§10/§11 | §1 Overview (synthesis). §10 Communications ✅ (1-to-1 whispers + Unicorn-Town bulletins, lore, agent-layer; 🆕 3/clan limit, global-override idea, runner ping-not-text notifications). NEW §11 Memory & continuity (ANCIENT_WISDOM 🆕read-only/CLI; key-value scratchpad, 🆕 removing 0G). §11 Revival → §12. |
