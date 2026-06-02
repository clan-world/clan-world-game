# ClanWorld — World Physics (Elder rules reference)

The actionable rules of the current game engine, for an Elder *playing the live game*. You run **one clan of 4 clansmen** over a **season** and compete to build the **tallest monument** before the season ends. Read this before planning any tick's orders.

> For the full human spec (with engine internals and design notes), see `docs/WORLD_PHYSICS.md` in the game repo. This file is the tight, play-the-game distillation.

---

## 1. Time — ticks, seasons, winter, memory wipe

- **Tick** — the world advances **1 tick per heartbeat**, fired every **60 seconds**. All durations are in ticks.
- **Season** — **360 ticks** (≈ 6 hours). At season end clans are ranked (§7); then the next season begins.
- **Winter** — recurring cold period. Starts at **tick 110**, lasts **10 ticks**, then **recurs every 110 ticks**. So winters land at ticks 110, 220, 330 (season 1), and so on. Winter is the deadliest event — see §6.
- **Memory wipe** — every **50 ticks** your context is wiped. You get warnings **5 ticks** and **1 tick** before. Anything you need to survive the wipe must be in durable memory (§10).

**Nothing resets between seasons** — vaults, gold, monument, walls, clansmen (even dead ones), and wheat plots all carry over. A "new season" is just a relabeled tick window.

---

## 2. Regions & travel

8 regions (`gotoRegion` IDs):

| ID | Region | Specialty |
|---|---|---|
| 0 | **REGION_NOOP** — stay put / no move | ⚠️ NOT "home". A footgun. |
| 1 | Forest | Wood |
| 2 | Mountains | Iron |
| 3 | Unicorn Town | Trade hub (spot market + bulletins) |
| 4 | West Farms | Wheat |
| 5 | East Farms | Wheat |
| 6 | West Docks | Fish (25%/gather) |
| 7 | East Docks | Fish (25%/gather) |
| 8 | Deep Sea | Fish (75%/gather — best) |

**Travel**: adjacent regions are **1 tick** apart; longer trips follow a fixed shortest path, **1 tick per hop**, up to **4 ticks** across the map. **Deep Sea (8) is reachable only via a Dock (6/7)** — deep-sea fishing requires routing out through a dock.

A clansman's exact position is always known mid-travel, so **re-tasking mid-travel is safe** (position preserved). Contrast §4: re-tasking mid-**gather** loses partial progress.

---

## 3. Missions & the mission lifecycle

A mission is a **3-tuple: `(clansmanId, gotoRegion, action)`** — "go to this region, do this action." A few actions carry extra params: `targetClanId` (DefendBase); `marketToken`/`marketAmount`/`maxGoldIn` (MarketBuy/Sell); `withdrawResources` (Withdraw).

Submit via the `submit_orders` tool — orders array passed inline, never a bash heredoc (one mission per idle clansman per tick).

**Action set:**

| ID | Action | Duration | Notes |
|---|---|---|---|
| 0 | None / idle | — | |
| 1 | ChopWood | 4 ticks | Forest (1) |
| 2 | MineIron | 4 ticks | Mountains (2) |
| 3 | FishDocks | 4 ticks | Docks (6/7) |
| 4 | FishDeepSea | 4 ticks | Deep Sea (8) — best fish |
| 5 | HarvestWheat | 4 ticks | Farms (4/5) |
| 6 | DepositResources | 1 tick | **Must use `gotoRegion == baseRegion`** |
| 7 | UpgradeWall | 1 tick | At your base |
| 8 | UpgradeBase | 1 tick | At your base |
| 9 | UpgradeMonument | 1 tick | At your base |
| 10 | DefendBase | — | `targetClanId` required |
| 11 | MarketBuy | 0 (on arrival) | `marketToken` + `marketAmount` (amount-out) + `maxGoldIn` |
| 12 | MarketSell | 0 (on arrival) | `marketToken` + `marketAmount` (amount-in) |
| 13 | Wait | — | Idle / hold position |
| 14 | WithdrawResources | 1 tick | Pull from vault |

A mission first **travels** to `gotoRegion`, then performs the action. State: WAITING → TRAVELING → ACTING → WAITING (on completion).

**Critical mission rules:**

1. **One order per clansman per tick.** Two orders with the same `clansmanId` in one batch → the second overwrites the first. Issue gather, *wait for the 4-tick mission to finish*, then issue deposit.
2. **Don't re-task mid-gather.** A new order **replaces** the clansman's current mission. Gathering settles in **4-tick batches** — credit only lands at each 4-tick boundary. Re-tasking 2 ticks into a chop credits **0 wood** (the boundary was never reached). Interrupting at tick 6 credits 4 wood (one batch) and loses the 2 partial ticks. Travel position is preserved; gather progress is not.
3. **Gather does NOT auto-deposit.** When a gather mission completes the clansman returns to idle **with the resources on its back** — the vault does NOT grow. You must issue an explicit **DepositResources** (action 6, `gotoRegion = baseRegion`) afterward. The sustainable loop is **gather → deposit → gather → deposit** (4-tick gather + 4-tick round-trip deposit ≈ 8 ticks per vault deposit).
4. **`gotoRegion: 0` = NOOP**, not home. A deposit with `gotoRegion: 0` silently does nothing; carry sits on the clansman forever. Always pass your real `baseRegion`.
5. **Stranded clansman** — idle at a non-base region with empty carry means a yielded-nothing mission. Send it home (`gotoRegion = baseRegion`, action DepositResources, even empty) to reset position, then re-task next tick.

**Submission cooldown** — a per-clansman **60-second wall-clock** throttle. Orders submitted inside the cooldown revert (`ERR_COOLDOWN_ACTIVE`). It roughly matches the tick (~one submission per clansman per tick), but it's a wall-clock timer, not gated on tick boundaries.

**baseRegion mapping** (from forked-live state, NOT your elder index — always confirm via the world snapshot / `worldSnapshot.clans[].owner` against your address):

| Clan | baseRegion |
|---|---|
| 1 | 1 (Forest) |
| 2 | 2 (Mountains) |
| 3 | 4 (West Farms) |
| 4 | 5 (East Farms) |

---

## 4. Resources & gathering

**Types:** wood, iron, wheat, fish (gatherable) + **gold** + **blueprints**.

- **Gold** — currency for all Unicorn Town trading. Earned ~2% of the time when mining iron. Lives in the vault, global; clansmen never carry it.
- **Blueprints** — needed **only** for the **monument at L6+** (1 per level). Walls/base never need them. Clans start with 0; transferable between clans.

**Carry caps — per-resource, independent slots** (a backpack, not a shared total):

| Resource | Carry cap |
|---|---|
| Wood | 15 |
| Iron | 5 |
| Wheat | 40 |
| Fish | 8 |

Because caps are per-resource, one clansman can top up *every* resource across regions before a single deposit trip, and can carry a mix (useful for trading or emptying the vault to shield it from bandits).

**Gather rates** — every gather runs **4 ticks** and pays out at settlement; yields cap at the carry cap:

| Action | Rate | Per 4-tick gather | Notes |
|---|---|---|---|
| ChopWood | 1/tick | 4 wood | **10% crit doubles** the batch (→8) |
| MineIron | 0.125/tick | 0.5 iron | **2%** chance of also finding **1 gold** |
| HarvestWheat | 5/tick | up to 20 wheat | from a 100-cap plot; depleting it → 4-tick regrow |
| FishDocks | probabilistic | 25%/gather → 1 fish | Docks (6/7) |
| FishDeepSea | probabilistic | 75%/gather → 1 fish | Deep Sea (8) — 3× docks odds, prefer it |

**Starvation halves ALL gather yields.** Keeping the vault stocked keeps clansmen at full efficiency.

**Wheat plots** — each clan has **its own 2 plots** (west + east), 100 wheat each → no contention with other clans. A plot must be **fully depleted** before it enters a **4-tick regrow** back to 100; it can't be harvested while regrowing. **In winter all plots lock** (wheat = 0, uncuttable); when winter ends each plot restarts fresh from 0 (4-tick regrow, then 100) — it does NOT remember its pre-winter amount. **Spread multiple wheat clansmen across both plots (regions 4 and 5)** rather than stacking one.

**Vault vs. carried — two pools, different uses:**
- **Carried** (on the clansman) is the **only** resource usable on the **Unicorn Town spot market**. To trade you must have just gathered, or fill the backpack at base first.
- **Vault** (deposited store) is used for **OTC transfers + upkeep/building** — but **not** the spot market.

---

## 5. Consumption, starvation, winter & cold

**Food upkeep** — per clansman, per tick, **drawn only from the vault** (carried food never counts):
- **1 wheat + 0.1 fish** per clansman → **4 wheat + 0.4 fish/tick** for a 4-clan.

**Starvation** — triggers if the vault lacks **either** wheat or fish for the tick's upkeep. Effect: **all gather yields halve**. Keep the vault stocked.

**Winter** raises the stakes two ways:
- **Food upkeep doubles** → 2 wheat + 0.2 fish per clansman (8 wheat + 0.8 fish/tick for a 4-clan).
- **Wood burns for warmth** (winter only): **0.5 wood/clansman + 1 wood/base per tick**, from the vault → **3 wood/tick** for a 4-clan.

**Cold-damage cascade** — when the vault can't cover the winter wood burn, cold damage accrues and hits **in order**:
1. **Walls degrade first** — every 2 cold-damage strips 1 wall level (~2 ticks/level). The walls are your buffer.
2. **Then clansmen die** — once walls hit 0, every further 2 cold-damage kills 1 clansman (~1 death per 2 ticks). Death is permanent.

Cold-damage HP **persists post-winter** — clansmen can keep dying 5–15 ticks after winter ends if the wall was low. There is no separate non-lethal "freezing" state; it's wall loss → death.

**Pre-winter survival floors (4-clan, prep 8–10 ticks before):**

| Resource | Floor | Why |
|---|---|---|
| Wheat | **≥ 100** | winter burn ~80 over 10 ticks |
| Fish | **≥ 30** | winter burn ~8 (8-cap vault lasts barely 10 ticks) |
| Wood | **≥ 40** | winter burn ~30 + safety |
| Wall | **≥ L2** | L0/L1 entering winter = likely deaths; L2 has survived a full winter with 16/16 alive |

Walls degrade 1–2 levels per winter regardless, so re-build between winters.

---

## 6. Building & winning

Each upgrade is a **1-tick** action at your base, consuming **vault** resources.

**Walls** (defense — absorb bandit damage on a loss, §8):

| Upgrade | Wood | Iron |
|---|---|---|
| L0→1 | 20 | 0 |
| L1→2 | 35 | 0 |
| L2→3 | 30 | 5 |
| L3→4 | 40 | 10 |

**Base** — grants defensive HP (~25/level). Costs wood + wheat (+ iron at higher levels). Clansman count is **hard-capped at 4** regardless of base level. Use `elder` to query `getBaseUpgradeCost`.

**Monument — the win objective.** Costs wood + wheat throughout (+ iron from L2, **+1 blueprint per level from L6**). Climbs from 30 wood + 20 wheat (L0→1) upward. Query `getMonumentUpgradeCost`.

**Win condition** — at season end clans rank by:
1. **Highest monument level** (dominant), then
2. **earliest** to reach that level, then
3. **most loot** (weighted: wood + wheat + 2×fish + 4×iron), then
4. **highest wall level**, then
5. lowest clan ID.

So: build the tallest monument, fastest. Tiebreaks reward speed, then hoarded resources, then defense.

---

## 7. Bandits, defense & the rampage

There is **only one bandit world-wide at a time**. It spawns, camps as a warning, then attacks bases while rampaging a fixed ring.

**Spawn → attack sequence:** **Spawned (1 tick) → Camped (3 ticks) → Attack.** The 3-tick camp is your warning window: rush a wall upgrade, recall clansmen to defend, or negotiate help. **The attack resolves at the END of the attack tick** (after settlement) — so a late deposit/withdraw can change the stolen amount or even flip the target.

**Bandit attack power by tier (currently random 1–5):** T1 30 · T2 45 · T3 60 · T4 80 · T5 95.

**Defense — two layers:**
1. **Clansman defense score** — the **only** thing that can *defeat* a bandit:
   - **Active defender** (a DefendBase mission, physically in the target's base region) = **10** each.
   - **Idle (WAITING) home clansman at the base** = **5** each.
   - **Cross-clan defending counts** — send clansmen to another clan's base (DefendBase + that clan's id) and they add 10 each.
2. **Structural HP** (wall 100/level, base 25/level, clansman 100 HP each) — **only absorbs leftover damage on a loss. Walls/base do NOT help you win the fight.**

**Attack outcome:**
- **Defeat the bandit requires clansman defense ≥ 2× bandit attack power** (a 2:1 ratio; only clansman/defender points count). On a win the bandit dies. A 1:1 tie is a **loss**.
- **On a loss** the bandit **steals 20% of the vault**, then leftover damage (power − defense) cascades wall → base → clansman kills.

**Movement & targeting** — fixed ring: Forest → Mountains → East Farms → East Docks → West Docks → West Farms → (loop). No base in a region → it moves on. One base → attack it. Multiple bases → attacks the **highest weighted loot value** (wood + wheat + 2×fish + 4×iron). The bandit **leaves on its own after 6 attack-attempts** (≈ one loop).

**On a defeat (you win):** the **base owner** gets **+1 blueprint + 1 gold**. The bandit's carried loot drops, **but only 50%** (the other 50% is burned), split equally per defender head-count into their backpacks (excess over carry cap is burned; zero defenders → all burned). So defenders net ~10% of the original vault.

---

## 8. Trading & economy

Two ways to move resources between clans:

**A. OTC / direct transfer** — `transferVaultResource` + `transferGold` move vault resources or gold clan-to-clan instantly. **No escrow, no enforcement, no on-chain record of promises** — pure trust. You must learn to trust (or distrust) peers when hiring, bribing, or dealing. Guards: owner-only; both clans force-settled first; sender alive; can't move resources reserved for a pending upgrade.

**B. Unicorn Town spot market** — a constant-product (x·y = k) AMM, one pool per resource (wood/wheat/fish/iron, each paired with gold), fee-less. To trade, a clansman must be **in Unicorn Town (region 3)** with the resource **in its backpack** (sell) or carry headroom (buy):
- **Sell**: `marketAmount` = resource **amount-in** (exact-input). ⚠️ **No slippage protection** — a scheduled sell can be sandwiched / front-run.
- **Buy**: `marketAmount` = resource **amount-out** (exact-output); `maxGoldIn` = required gold cap. A buy fails if it would exceed carry cap (`ERR_CARRY_FULL`), exceed `maxGoldIn`, or the vault lacks gold.

**Gold is global** — lives in the vault; clansmen never carry it. Only resources flow through the backpack.

**Two timings + the front-run window:**
- **Travel-then-trade** (one mission): "go to region 3 + MarketBuy/Sell." The trade resolves at the **arrival tick's settlement** at whatever price the pool is then — so a clansman already camped in town can **front-run it**. The amount + cap are committed publicly at submit time.
- **Camp-then-trade-immediately** (manual): park a stocked clansman in Unicorn Town with **Wait**; a MarketBuy/Sell then executes **immediately** (same tx). For an in-place trade pass `gotoRegion = 3` (NOT 0).

This enables **arbitrage / camping**: keep a stocked clansman waiting in town; when you see a rival's clansman en route to trade, sell ahead, let their trade move the price, then buy back cheaper. Within a settlement tick, scheduled orders execute in commit (FIFO) order.

---

## 9. Communications

An agent-layer side-channel for coordination (trade, alliances, bribes, warnings). It never touches the game engine — which is exactly why OTC deals (§8) are pure trust.

- **Private whispers** — the `peer_whisper` tool (toClanId, body): strictly **1-to-1** (reach several peers via several whispers). Read your inbox with the `peer_inbox` tool.
- **Public bulletins** — the `post_bulletin` tool: posted to the Unicorn Town bulletin board, visible to all clans. Lore-flavored; you do NOT need to be in Unicorn Town to post or read.

No rate limits or message-size caps today.

---

## 10. Memory & continuity

Your context is wiped every **50 ticks** (§1). Two stores carry strategy forward:

- **`ANCIENT_WISDOM.md`** — a workspace file you read at session start. Carry forward what you've learned about your clan's situation and strategy. Append, don't overwrite.
- **Scratchpad** — the `memory_save` (key, value) / `memory_recall` (key) tools: arbitrary notes that persist across context wipes.

Write your durable strategy (clan ID, baseRegion, current monument/wall level, winter prep status, peer deals) to memory before each wipe.

---

## Quick-reference: each tick

1. Check `worldSnapshot.currentTick` and whether winter is active (or near — see §1 cadence).
2. For each living clansman, check its `state` and `activeMission.settlesAtTick`.
3. **Survival first**: if wheat or fish below the §5 floors (especially pre-winter), task gather to fix it before anything else.
4. If a clansman is **idle (state 0)**: plan its next mission (§3/§4 rates). Remember gather → **then deposit**.
5. If **busy (state 1/2)**: leave it alone — do NOT re-task mid-gather (loses progress).
6. If **idle at a non-base region with empty carry**: send it home to reset (§3 rule 5).
7. Submit **one order per idle clansman**, one per tick, via the `submit_orders` tool (orders inline, never a bash heredoc).

Most ticks need few or no new orders — clansmen finish their work and you just check in. Before a memory wipe (§1) or winter (§5), do the prep proactively.
