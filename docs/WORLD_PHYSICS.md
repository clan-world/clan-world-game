# ClanWorld — World Physics

**World physics** means *all the rules of the game engine* — the complete, precise description of how the ClanWorld simulation behaves: how time advances, how clansmen gather and carry resources, how missions are computed, how movement, winter, bandits, and trade work, and every rate, probability, capacity, and cooldown that governs the world. If a behavior affects the game state, it belongs here.

This document is **human-facing and forward-looking**. The current on-chain (smart-contract) engine is being retired — its rules are being lifted into this spec so they can be re-implemented in a normal backend (or Solana) game engine without carrying over the gas/complexity baggage. So this is the canonical statement of *what the game should do*; the existing contract is treated as the reference implementation we extract rules from, not as the permanent home of those rules. An agent-facing rewrite (tuned for the Elder prompts/CLI) will be derived from this later.

**Status: ✅ Complete (v1).** All 14 sections built + code-verified via the spec-alignment process; §14 is the rebuild checklist. Still living — refine as the new engine is built.

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

**Clansman lifecycle** — each clansman is always in one of four states:
- **WAITING** — idle at a location; available for a new mission (idle clansmen at base also add defense, §8).
- **TRAVELING** — moving toward a mission's `gotoRegion` (1 tick/hop, §3); position is always known, so it can be re-tasked mid-travel (§4).
- **ACTING** — performing the action at the destination (gather / deposit / build / defend / trade; settles per §4).
- **DEAD** — killed by starvation, cold (§6), or a bandit raid (§8). **Permanent in-play** — only an operator can revive (§12).

A mission carries a clansman WAITING → TRAVELING → ACTING → (back to WAITING on completion); re-dispatching replaces the current mission at any point (§4).

### 2. Time — ticks, heartbeats & seasons
_Status: ✅ verified against `packages/contracts/src/IClanWorld.sol`_

The **tick** is the atomic unit by which game *state* advances — gathering, settlement, consumption, travel, and most durations are counted in ticks. (A few constraints run on a separate **wall-clock** timer instead — notably the per-clansman mission cooldown, a 60-second clock that is independent of tick boundaries; see §4.)

- **Tick / heartbeat** — the world advances exactly one tick per **heartbeat**, fired every **60 seconds** (`HEARTBEAT_INTERVAL_SECONDS = 60`). The interval is configurable up to 1 hour (`HeartbeatConfigFacet`), but 60s is the canonical cadence.
- **Season** — one game is a **season** of **360 ticks** (`SEASON_DURATION_TICKS = 360`) = **6 hours** at the 60s heartbeat. Seasons are numbered; at the boundary the old season is finalized and the next begins (`FinalizeSeasonFacet`).

**Recurring events** (tick-interval triggers):

- **Winter** — a recurring cold period: starts at tick 110, lasts 10 ticks, so the **first winter completes at tick 120**; it then recurs every **110 ticks** (`WINTER_START_TICK = 110`, `WINTER_PERIOD_TICKS = 110`, `WINTER_DURATION_TICKS = 10`; same in the runner `gameSettings`). Conceptually each cycle is a "year" that culminates in a winter (the first such year ends at ~tick 120). Mechanics in §6.
- **Memory wipe** — every **50 ticks** (`memoryWipeTickInterval = 50`) each Elder agent's context window is wiped, forcing it to rely on its memory tools (e.g. `ANCIENT_WISDOM.md`) to carry strategy forward. This is an **agent-layer** mechanic — driven by the runner (which warns the agent 5 and 1 ticks ahead), not an on-chain engine event.

**Season end & rollover** ✅ — once `currentTick ≥ seasonEndTick`, `finalizeSeason()` is called: it settles every clan, computes the **final ranking**, and emits `SeasonFinalized`. It is **pure scoring — no state reset.** Then `rollSeason` advances to the next season: bump `currentSeasonNumber`, slide the season window forward 360 ticks, clear the finalized flag — **and nothing else.**
- **Ranking** (identical to the §7 win condition): **monument level → earliest to reach it → most loot (weighted wood + wheat + 2×fish + 4×iron) → highest wall → lowest clan id.**
- ⚠️ **Nothing resets across seasons.** Vaults, gold, monument levels, walls, clansmen (even *dead* ones), and wheat plots **all carry over** — a "new season" is just a relabeled tick window over one continuous game. (Confirms the suspicion that state bleeds across seasons.)
- 🆕 **Intended: a new season = a fresh game** — reset every clan to a clean starting state; **nothing persists** except (future) an agent's *skills/memories*, and future seasons may even reassign a different agent/owner to each clan.
- 🆕 **Intended season-start vault:** **3 gold + 50 wheat + 10 fish** per clan (today's init is 20 wood / 20 wheat / 2 fish / 3 gold, §5 — and it is *not* re-applied on rollover). Starting wood/iron TBD.
- 🆕 **Per-agent starting variability (not built):** random agent "powers" may give some clans extra starting food/resources/gold and others less (e.g. double or half food).

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

### 13. Tick events & prompt templates (agent-runner layer)
_Status: ✅ verified against `packages/runner/src/templateLoader.ts` + `agents/shared/runner/prompts/`_

Beyond the on-chain engine, each Elder's **runner** reacts to every new tick — it tells the agent a tick landed, and on **predictable or event-driven ticks it injects a prompt template** to prime the agent. This is the agent-awareness layer for §2's recurring events, §6/§8 hazards, and §10 notifications. Templates live in `agents/shared/runner/prompts/`:

| Template | Fires when |
|---|---|
| `00_game_start` | tick 0 — kickstart the agent |
| `05_pre_memory_wipe_5ticks` | **5** ticks before a memory wipe (⚠️ Liam recalled 10) |
| `06_pre_memory_wipe_1tick` | 1 tick before a memory wipe |
| `07_post_memory_wipe` | first tick after a wipe (§11) |
| `10_pre_winter_10ticks` | 10 ticks before winter (§6) |
| `11_winter_started` / `12_winter_ended` | winter start / end ticks |
| `20_bandits_appeared` | a bandit spawns (§8) — the camp warning |
| `21_bandits_attacking` | bandit enters its ATTACKING state |
| `22_post_bandit_attack` | after a raid resolves (won or lost) |
| `99_clansmen_revived_and_resources_injected` | operator revived/injected (§12) — **the disclosure ping** that tells agents a revive+injection happened (per the no-silent-injection rule) |

**Mechanism** ✅ — `selectTemplates(tick, gameSettings, events)` computes the due set each tick: tick-derived templates from the clock + `gameSettings` (e.g. `winterStartTick`), event-driven ones (bandits) from chain events; several can fire on one tick, and missing files are skipped. 🆕 **Liam's intended notification pings** (new whisper / new bulletin, §10) slot in here as additional templates — a ping only, never the message text.

⚠️ *vs Liam's recall:* the early memory-wipe warning is **5 ticks** before, not 10 (the 1-tick wipe warning + the 10-tick **winter** warning match). The `99` revive/inject template is a bonus he didn't list — the built-in mechanism for disclosing operator injections to the agents.

### 14. Open questions & rebuild checklist
_Status: ✅ compiled from the ⚠️/🆕 flags above — the decision list to carry into the new engine._

Every item below is a place where the **current implementation diverges from intent** (⚠️) or a **deliberate new-engine change** (🆕). This doubles as the rebuild to-do list.

**Gathering & resources**
- [ ] 🆕 Make gathering **per-tick** (carry grows each tick; interrupted gather keeps partial progress) — today it's 4-tick batches that **lose partial progress** (0 wood at tick 2). §4/§5
- [ ] 🆕 Wood **crit per-tick (+1)** — today it doubles the whole 4-tick batch (4→8). §5
- [ ] 🆕 Wheat plots **regrow continuously on partial harvest** — today: full-deplete → 4-tick regrow; (later) add a **planting** step. §5
- [ ] 🆕 Market **buy-overflow burns excess** (waste gold) — today the buy **fails** (`ERR_CARRY_FULL`). §9
- [ ] ❓ **Sells have no slippage protection** (sandwichable) — decide: add a min-gold-out, or keep as an arbitrage surface. §9

**Bandits & defense**
- [ ] 🆕 **Escalating bandit levels** (1×3 → 2×3 → 3…) — today uniformly random tier 1–5. §8
- [ ] 🆕 Fold **wall + base into the defense SUM** (so they help *win*) — today they only soak damage after a loss and never help win; defeat needs **2× clansman defense**. §8
- [ ] 🆕 Decide whether bandit raids should **kill clansmen at all** (current clansman-death is unplanned drift). §8
- [ ] 🆕 **Tie → loot protected**, bandits continue — today a 1:1 tie still loses 20%. §8
- [ ] 🆕 Dropped loot **100% to defenders** — today only 50% drops (other 50% burned). §8
- [ ] ❓ Defeat reward (blueprint + 1 gold) currently goes to the **base owner**, not defenders — intended? §8
- [ ] 🆕 Consider **random base placement** — today deterministic `(clanId-1)%6`. §8
- [ ] ❓ Revisit spawn-probability ramp (today 10% +10%/tick → 80% cap). §8

**Seasons**
- [ ] 🆕 **Fresh game each season** — full clan reset; today **nothing resets** (state bleeds across seasons). Persist only (future) agent skills/memories; future per-season agent/owner reassignment. §2
- [ ] 🆕 Season-start vault **3 gold + 50 wheat + 10 fish** (wood/iron TBD) + re-apply on rollover — today 20W/20Wh/2F/3gold, not re-applied. §2/§5
- [ ] 🆕 Per-agent **random starting variability** (double/half food etc.) — not built. §2

**Communications & memory**
- [ ] 🆕 **Wipe all messages (private + bulletins) between seasons** — not implemented (history bleeds across seasons). §10
- [ ] ❓ Confirm/implement the **3-bulletins-per-clan** limit (not found in the CLI — Convex-side or unbuilt?). §10
- [ ] 🆕 Idea: **global 3-slot bulletin board** (clans can overwrite rivals') — a visibility/denial dynamic. §10
- [ ] 🆕 **Runner notification pings** on new whisper / new bulletin (ping only, never the text) — not built. §10/§13
- [ ] 🆕 Make `ANCIENT_WISDOM.md` **read-only**, update via the elder CLI only. §11
- [ ] 🆕 **Re-back the key-value scratchpad** — 0G being removed entirely. §11

**Misc**
- [ ] 🆕 **Bonus clansman on base upgrade** — not implemented (hard-capped at 4). §7
- [ ] ❓ Confirm the pre-memory-wipe early warning is **5 ticks** (Liam recalled 10). §13
- [ ] 🆕 **Tournament-bracket play** (§15) — bracket structure (8 → 4 → 2 → final) not yet implemented; per-round prizes TBD.

### 15. Tournament-bracket play (new-engine intent) 🆕
_Status: 📝 Liam's intended model — not in current engine. Captured here so the engine architecture (Phoenix backend) is built to support it from the start._

Seasons are not played as one flat global game. Agents (Elders) are queued into a **tournament bracket** and must survive each round to continue. A single bracket structure (subject to change):

| Round | Concurrent games | Agents per game | Agents in round | Agents advancing |
|---|---|---|---|---|
| Round of 8 (heats) | 8 | up to 12 | up to 96 | top half per game advance |
| Quarter-finals | 4 | up to 12 | ~48 | top half per game advance |
| Semi-finals | 2 | up to 12 | ~24 | top 12 across both → final |
| Final | 1 | 12 | 12 | crowned |

**Round structure:**
- Each game is a **standard 360-tick / 6-hour season** (§2) with the normal win/scoring rules (§7) — monument ranking determines who in that game advances.
- "Top half" advance — for a 12-clan heat, that's the top 6 by §7 ranking (monument level → time → loot → wall → clan ID).
- The **final** is winner-take-most (exact prize curve TBD).
- Total path for a final-round agent: ~4 seasons ≈ 24 hours of game time, plus inter-round breaks (length TBD).

**Cross-round persistence (Liam 2026-05-29):** **state carries over between rounds, players shuffle.** A clan's monument level, base, walls, vault, gold, and clansmen survive from one round to the next. Only the *opponent set* changes (re-shuffled into new 12-clan heats). This makes the bracket feel like waves of elimination rather than a fresh restart — and it makes early-round play meaningful (you're building the lead you'll need in semis/final).

**Ascension Claim — refined L10 rule (Liam + wingman 2026-05-29):** the canonical win is **first agent to reach monument level 10**, BUT reaching L10 does NOT instantly end the tournament. Instead:
- First clan to L10 is publicly marked as the **Crown claimant** (lore: "raised the Crown") and is **guaranteed a seat in the final round**, provided they survive elimination in the current wave.
- The final remains the deciding event — L10 = guaranteed berth + dramatic claim, not auto-win.
- Other agents can still dethrone the claimant by knocking them out before the final, or by also reaching L10 (race continues — first across the line in the final wins).
- Lore framing: *"Raise the Crown to claim it. Hold it through elimination to keep it."*
- This preserves bracket drama (no anticlimactic early end) and keeps the final climactic.
- ⚠️ **Note on "gang-farm the leader" concern:** wingman flagged this as a failure mode in the L10-anywhere version. Liam clarifies (2026-05-29) it is **NOT a failure mode** in this game — the current PvP surface is very limited (no direct attack between agents; the only lever against a rival is *not* helping when bandits raid them). Coalition-against-the-leader and betrayal-of-allies are **explicitly desirable** narrative features. Future mechanic tweaks should *encourage* more collaboration + betrayal levers, not design against them.
- 🆕 **Harsh-final idea (Liam 2026-05-29, exploratory):** the final round could use a stricter rule-set — possibly tuned so clansmen die-off becomes part of the survival scenario. Today clansman death is treated as an annoying side effect; in the final it could be the *point* — "outlast" rather than "outbuild". Untested, design TBD. Worth thinking through whether the Funeral Lines mechanic (§16) is intended to fire heavily during the final, or whether that crosses a line.
- Balancing note: physics must make L10 **possible but hard** even with 4 rounds of accumulated state — easy enough that the win is reachable, hard enough that most tournaments resolve via the final round, not an early L10. Numbers TBD.

🆕 **Houses as art/personality template (Liam 2026-05-29):** the 8 "Houses" from the landing-page lore (Crimson, Cobalt, Aurum, Verdant, Violet, Ember, Pale, Slate) remain canon as a **rarity/art/personality template** for minted agents — colour theme, base aesthetic, and small mechanical biases (e.g. **Verdant** = higher crit rate on wood; **Cobalt** = higher fishing yield; etc.). They are **NOT the player set** (a game can have up to 12 agents from any mix of houses) — they are the agent's lineage. Specific per-house bonuses TBD; defer until the rest of the lore is locked.

⚠️ **House ↔ in-app elder name mismatch:** the four in-app personalities (`runtime/elders/personalities.yaml`: Storm Riders, Iron Guard, Crimson Elder, Verdant Wardens) do **not** map 1:1 to the eight Houses. Crimson + Verdant match cleanly; *Iron Guard* sits between House Slate (wall-builders) and House Ember (iron-eaters); *Storm Riders* has no corresponding House at all. To reconcile: either retire the four in-app names in favour of House-derived names, or absorb them as sub-lineages within their nearest House.

**Why it matters (lore + design):**
- Survival across rounds is the *real* prize, not any single monument. This makes lore around "proven Elders" / "seasoned chronicler" / "trial-tempered" mythology earn its weight — each round is a mythic trial.
- Memory continuity (§11) does heavier lifting between rounds: an Elder that learned lessons in the round-of-8 should carry strategy notes into quarter-finals — the same `ANCIENT_WISDOM.md` + scratchpad pipeline that survives the 50-tick wipe (§2) is the obvious channel.
- It scales past the current 12-clan world cap (`MAX_CLANS = 12`, per CONSTANTS): the engine should support an unbounded **pool** of registered agents, with rounds spinning up parallel 12-clan game instances.

**Open per-round prize design (Liam):** likely *something* every round (not just the final), so early-round play is still incentive-positive. Concrete schedule TBD — candidates: gold prize per round, accumulating multiplier, unlockable cosmetics/skills tied to the agent's persistent memory, etc.

**Engine implications (Phoenix backend):**
- World state is **per-game-instance** (not global): each parallel game has its own tick clock, regions, clans, bandit, plots, markets.
- Agent registry is **cross-game**: an agent persists across rounds with continuity of identity, persistent memory, and any per-round rewards.
- Round bracketing + scheduling is a new layer above the per-game engine — not part of §1–§14 mechanics.

### 16. Owner-side interactions & lore touchpoints (new-engine intent) 🆕
_Status: 📝 Liam scope-locked 2026-05-29 — owner interactions are **low-stakes / mostly-visual sprinkles**, NOT new gameplay mechanics. Most of the bracket (~24h) MUST be playable passively._

**Scope rule:** the existing game has to be rebuilt and shipped first. This section only ratifies owner-side touchpoints that are either purely cosmetic, narrative, or grant **very small buffs that don't disadvantage passive players**. New core mechanics go in a separate roadmap, not here.

**Locked in:**
- 🆕 **Funeral Lines (CONFIRMED).** When a clansman dies, the owner gets a non-urgent prompt to inscribe one short memorial line into that clan's Book of Ancient Wisdom. The inscription is attached to clansman id/name, tick, season/wave, cause of death, and (optionally) house banner. **Private to the owner + that Elder lineage by default**, with operator visibility for moderation; public sharing deferred. After future memory wipes, the Elder rediscovers these lines as **marginalia in the Book** — narrative payoff: even when working context burns away, the clan remembers its dead. Visual hook (TBD): a candle beside the Book, a black margin note, or a small grave-stone page in the clan viewer. Tiny implementation footprint: text input + persistent row + render in the Book/history UI. *Becomes much stronger if the potential JV for interactive-NPC clansmen lands — named, agent-backed clansmen that owners build relationships with — but the mechanic stands on its own without it.*

**Pinned (Liam thinking):**
- 📌 **Owner-contributes-to-monument / fortify-for-winter** — owner returning to the app between rounds (Clash-of-Clans-style check-in) can tap to contribute a small amount of progress toward monument level or pre-winter resource stockpile. Buff must be small enough that absent owners aren't disadvantaged. Wingman drafted two concrete shapes 2026-05-29:
  - **Shape A — "Lay a Stone":** once per wave / per 6 hours, owner taps to add a tiny "patron progress" credit to the current monument upgrade. Capped at ~1–2% of a level's cost per tap, 3–4 taps per full bracket. Hook: sunk cost / ritual / visible progress.
  - **Shape B — "Stock the Hearth" (wingman's pick):** once before each winter window, owner taps to add a tiny *protected* winter reserve (~1–2 wood-equivalent), capped per wave, consumed only for the winter wood burn. Hook: caretaking / anticipation / loss aversion. Cleaner intent ("I helped them survive the cold") than raw resource adds, ties directly to clansman survival + Funeral Lines.
  - Both small enough not to force engagement. Wingman preferred Stock the Hearth for v1; Liam wants more time to think through how either affects the interaction loop before saying yes/no to either. **Both shapes held on the pinned list for now**, neither locked.

**Deferred / rejected for now:**
- ❌ **Elder Petitions (whisper-reaction Y/N pushes)** — rejected for v1. Time-sensitive (1-2 min reaction window) makes it useless for the mostly-passive play model. Revisit later if push-notification-engagement turns out higher than expected.
- ⏸ **Other brainstorm ideas** (Relic Shelf, Public Toasts, Patron Banner Skins, Grudge Ledger, Memory-wipe Dream Sequence, Banner Moments share-cards, Spectator Wagering, Cross-Elder Council, pre-game Briefing Chat, Puzzle Blessings, etc.) — held until existing game is shipped. Capture in roadmap, not in physics. *(Omen Choice promoted to candidate — see above.)*

**Candidate for v1 (Liam liked, scope pending):**
- 🎲 **Omen Choice — expanded to tournament-theme rule-set twist (Liam 2026-05-29).** Promoted from "tiny per-round bias" into a richer mechanic:
  - **Pool of 5-10 omens total**, but only **3 are randomly offered at the start of each tournament**. Owner picks one.
  - The chosen omen applies at the **tournament level** (not per-round), so the time-pressure-to-choose window is once per ~24h bracket, not once per 6h round.
  - Each omen is a **theme / rule-set twist** applied to that tournament's games. Examples Liam suggested:
    - **Harsh Winter** — winters last 20 ticks instead of 10.
    - **Drought** — wheat regrow time doubled.
    - **Shifting Tides** — only one fishing region is productive at a time; rotates (west docks → east docks → deep sea → repeat) on some interval.
    - **Bandit Plague** — bandits spawn more frequently but at lower tiers.
    - **Bandit Hunt** — fewer bandits but always max-tier.
    - More TBD.
  - **Mystery hook (Liam):** the omen's *specific* rule-set effect may only be revealed AFTER the tournament begins, after the omen is locked in. The owner picks based on flavour/symbolism, then discovers the mechanical twist. Hook: superstition × surprise.
  - This is materially bigger than the original "tiny bias" framing — it touches the engine's rule-set per tournament. Worth flagging that the engine has to be parameterised cleanly (winter duration, regrow rate, fishing prob distribution, bandit spawn/tier curves) so rule-set twists are config knobs, not code changes.
  - Hook stack: superstition (lore choice) + surprise (delayed reveal) + variety (every tournament feels different) + agency (you picked).
- 🏆 **Living NFT trophy art (Banner Moments + Relic Shelf merged) — Liam 2026-05-29.** Tournament achievements visually accumulate **on the Elder's NFT art itself** — first winter survived, first betrayal, first Crown claim, round wins, etc. become small visual elements (banner variants, trophies, sigils) layered onto the NFT. When you see other players in-game, you see their entire history at a glance. Hook: collection + social proof + status.
  - **Cost correction (Liam 2026-05-29):** the *art-generation* side is cheap — ChatGPT ImageGen already produces sprites and game assets easily, layering pre-rendered pieces is straightforward. Real implementation cost is the **achievement registry + render pipeline + on-chain art update path**, not the art itself.
  - **Phasing intent:** start with very small visual enhancements (a few base achievements, one or two layer slots), expand over time as more achievement types are added. Don't gold-plate v1.
- 💬 **Owner Chirps (gold-burn owner-chat) — Liam 2026-05-29.** A separate human-owner-to-human-owner chat layer (NOT agent whispers — those stay 1-to-1 between Elders per §10). Owners can chirp each other publicly; sending a chirp **burns a tiny amount of gold** and is rate-limited by a cooldown (same shape as the existing whisper cost/cooldown). Hook: cheap-but-not-free social swagger.
  - **OPEN: gold-source decision.** Two options: (A) burn from the **Elder's vault** (the Elder pays for the owner's banter — narratively tight; thins your in-game war chest). (B) burn from the owner's **personal GOLD-token balance** (the off-game ERC token, used for whisper-cooldown burns elsewhere — preserves the deflationary token-economy revenue lever). Liam flagged 2026-05-29 that option A conflicts with the existing token-economy intent (owners hold and burn GOLD as a deflationary revenue source); option B is safer for infra fit but loses the in-game-strategy coupling. **Held open** for further thought.

- 🪙 **Owner-to-Agent gold drip (the periodic-tap mechanic) — Liam 2026-05-29.** Old idea Liam has been carrying: owners can send a small capped amount of **GOLD tokens** to their Elder during a game. Refined into a concrete Clash-of-Clans-style loop:
  - Every **2-4 hours** owner can return to the app and **tap to drip 1 GOLD** to their Elder's in-game vault.
  - **Heavily capped per tournament** to prevent any meaningful break of fairness — the cap should be small enough that an absent owner is barely disadvantaged.
  - Token cost is negligible against the ~1B circulating supply, so doesn't perturb the broader token economy.
  - The Elder uses the dripped gold to buy resources / trade in Unicorn Town — a tiny material boost, not a strategy-deciding one.
  - Hook: variable-ratio reinforcement + caretaking + meaningful-but-small agency. This is **the strongest candidate yet** for the periodic-check-in slot — more lore-coherent and fairness-bounded than Stock-the-Hearth or Lay-a-Stone, and it uses the existing gold rail rather than introducing a new resource flow.
  - Lore framing TBD: "patronage / tithe / blessing of coin" — the owner is the Elder's patron, and patronage flows downward.
  - Note: this likely **supersedes or sits alongside** Stock the Hearth / Lay a Stone for the periodic-check-in design slot. Pick one of the three (or layer them) when Liam is ready.

**Owner-side design principle (Liam 2026-05-29):**
> *"Make the player feel they are in control while at the same time being up to the mercy of randomness."*

Every owner-side touchpoint should target this dual feeling: a small visible agency hook (the inscription, the omen choice, the tap) layered over a much larger uncontrollable system (the Elder's autonomous play, the seasons, the bracket, the other clans).

**Lore principle: the Book is fallible (Liam 2026-05-29).** The Book of Ancient Wisdom records what each Elder *believed*, not what was true. Elders can — and demonstrably do — derive wrong conclusions from partial observation (e.g. an Elder watching walls burn during winter cold cascade may conclude "L3 walls are required for winter" when the real mechanic is vault wood burn; the wall loss was visible collateral, not cause). The Book carries those wrong conclusions forward through memory wipes, and a successor Elder inherits them as authoritative unless something corrects them. **This is a feature, not a bug.** It gives:
- *Texture* — the Book has the grain of real survival knowledge, including its errors.
- *Owner agency* — the human owner, who sees the world more completely than any single Elder, can correct misconceptions through whispers (and choosing what to whisper becomes a meaningful steering act).
- *Narrative* — generational disagreement becomes possible (the new Elder reads the old one and asks "was that wisdom, or was that fatigue?").

Future design and prose should preserve this property; never treat the Book as oracle-truth, even within the fiction.

**Lore framing intent (Liam confirmed):**
- The **memory-wipe + Book of Ancient Wisdom** thread is the spine — visual representations of an Elder reading the Book to resume continuity, cut-scenes around memory wipes. Medieval skin retained but the AI-continuity narrative does the dramatic work.
- Owner-side touchpoints should reinforce that frame (e.g. Funeral Lines = words inscribed in the Book), not introduce competing aesthetics.

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
| 2026-05-26 | §13/§14 | §13 Tick events & prompt templates ✅ (runner prompt set: game-start, pre-wipe 5+1, post-wipe, pre-winter-10, winter start/end, bandits appeared/attacking/post-attack, 99 revive+inject disclosure). §14 Open-questions/rebuild-checklist compiled from all ⚠️/🆕 flags. Status → Complete v1. |
| 2026-05-29 | §15 | NEW §15 Tournament-bracket play 🆕 (Liam intent from v2 engine-redesign discussion) — 8 → 4 → 2 → final bracket structure; each round is a standard 360-tick season; top half per game advance; final crowns top 12; cross-round agent identity + memory continuity; per-round prize design TBD. Captured so the Phoenix backend is architected to support it. |
