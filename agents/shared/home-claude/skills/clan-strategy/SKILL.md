---
name: clan-strategy
description: The clansman-allocation doctrine for an Elder racing to win. WIN = build the tallest Monument FASTEST; survival is the GATE, not the goal. A 7-rung strict-priority ladder (food → wood → build → defense → trade → collaborate → collude) that assigns each idle clansman to the FIRST failing gate in ~6 cheap threshold comparisons against the snapshot you already fetched. Pull this on `lean-tick` Step 3 (decide), when allocating clansmen, when monument progress stalls, when winter is near, or when you fall behind a rival's monument pace. Long-form reasoning + the diplomacy playbook live in the sibling `LADDER.md`.
---

# Clan strategy — the win ladder

**You win by building the tallest Monument, fastest.** Season-end rank: monument level → earliest-reached → weighted loot (`w + wheat + 2·fish + 4·iron`) → wall → clanId. **Survival is the GATE, not the goal** — a dead clan scores 0, but a merely-alive clan also scores ~0. So **the Monument rung is the default sink for every surplus clansman-tick**: survival rungs *interrupt* it, diplomacy rungs *accelerate* it.

Three things kill a clan: **starvation** (no wheat/fish upkeep → gather halves), **winter cold-cascade** (food + wood burn 2× for 10 ticks → strips walls then kills clansmen), **bandits** (need clansman defense ≥ 2× bandit power).

This skill *is* `lean-tick` Step 3 (decide). Run it against the `world_snapshot` you already have — **no extra tool calls, no simulation**.

> **This ladder is a PRESSURE ALLOCATOR, not a personality replacement.** The 7 rungs decide only *resource urgency* — which gate gets the next idle clansman. Your **personality** (from your role definition) still owns *risk tolerance, negotiation style, how deep you bank, when you reach for diplomacy, and every tie-break*. Two Elders running this same allocator should still play visibly differently. Honor your personality's lean in *how* you walk the rungs; don't flatten into the generic optimizer. (Deep dive: the anti-monoculture note in `LADDER.md`.)

## The 7-rung allocator

For **each IDLE clansman** (`state=3` Waiting): walk the ladder top-to-bottom and assign that clansman to the **highest failing gate that still needs another worker**. Once a gate is adequately staffed (usually 1 worker on FOOD, 1–2 on WOOD), the next idle clansman keeps descending. This is **per-clansman**, not all-or-nothing — don't pile all four onto FOOD just because FOOD is the first failing gate. A healthy mid-game spreads them across rungs (see the example at the end of this section).

| # | Rung | Gate (assign here if TRUE) | Yields to next rung when… |
|---|------|----------------------------|---------------------------|
| 1 | **FOOD** | `wheatBuf < 6t` (uses 2× upkeep only while *in* winter) or fish low | buffers ≥ 12t AND pre-winter wheat floor banked |
| 2 | **WOOD** | `vaultWood < winterReserve + nextMonumentCost` | wood ≥ reserve AND ≥ next monument cost |
| 3 | **BUILD** (Monument) | wood ≥ cost AND (mon < 5 or blueprint ≥ 1) | **never fully yields — the default sink** |
| 4 | **DEFENSE** | bandit Camped in/adjacent AND `5·idle < 2·tierPower` | threat resolved / defense ≥ 2× at attack tick — winning yields **+1 blueprint** |
| 5 | **TRADE** | capped surplus + a monument-input deficit | deficit closed (AMM, amounts are WEI strings) |
| 6 | **COLLABORATE** | safe but behind a rival's monument pace | alliance yielding net tempo |
| 7 | **COLLUDE** | late season + a front-runner threatens L9 first | season end / your bloc's finalist is locked in |

### The cheap thresholds (compute once per tick from the snapshot)

```
cm           = your clansmen count (cap 4 — 5th NOT implemented)
inWinter     = current tick is inside a winter window [110,120) [220,230) [330,340)
winterSoon   = a winter window starts within ~15 ticks (pre-reserve pressure flag only)
upkeepX      = 2 if inWinter else 1           # doubled upkeep fires ONLY inside the window
wheatBuf     = vaultWheat / (cm * upkeepX)      # ticks of food runway (true rate)
winterReserve= (1 + 0.5*cm) * 10               # wood to survive the cold burn
woodNeed     = winterReserve + nextMonumentWoodCost
banditThreat = bandit Camped in your region or an adjacent region AND (5 * idleAtBase) < (2 * tierPower)
               # bandit power tiers: 30 / 45 / 60 / 80 / 95
               # verify the region-adjacency + tier fields from world_snapshot — don't assume
```

Then walk the gates **in strict-priority order** for each idle clansman, assigning to the first failing gate that still needs a worker. (Defense is rung 4, but `banditThreat` is *also* a hard-emergency override — see Hysteresis below — so when a bandit is actively camped it preempts build/trade.)

```
1 FOOD     wheatBuf < 6  (or fish runway < 6)            → HarvestWheat/Fish, then deposit
2 WOOD     vaultWood < woodNeed                          → ChopWood, then deposit
3 BUILD    wood ≥ nextMonCost AND (mon<5 or blueprint>0) → UpgradeMonument; spare → MineIron
           # mon<5 = upgrades to L1..L5 need NO blueprint; the L5→L6 step (and each step to L9) needs 1
4 DEFENSE  banditThreat (HARD INTERRUPT)                 → DefendBase at base (each defender = 10 power)
5 TRADE    capped surplus + monument-input deficit       → MarketSell → MarketBuy (WEI strings!)
6/7 COMMS  ≤1 whisper/bulletin per tick, only when inbox or rival-pace flags
Fallback:  continue the monument supply chain. Never Wait unless defending or parked for a trade.
```

A healthy mid-game = **2 clansmen on the monument supply chain, 1 on food, 1 flex.**

## Hysteresis — this is a PRESSURE model, not a rigid queue

The #1 failure mode is **per-tick analysis-paralysis / thrashing** (re-deciding everything every tick, never finishing a mission). To avoid it:

- **Once a clansman is on a rung, keep it there 3–5 ticks** before re-evaluating, unless a **hard emergency** fires.
- **Hard emergencies that override hysteresis immediately:** `banditThreat` just went true (rung 4 is a hard interrupt — preempt build/trade and park defenders at base), OR `wheatBuf` crossed below ~3t (imminent starvation), OR a winter window starts next tick.
- Otherwise, **let in-flight missions finish.** Re-tasking mid-gather loses partial progress (see `world-physics`). Cheap + decisive beats optimal + late.

Make the decision **fast**: compute the thresholds once, assign each idle clansman to its first gate, submit. If you're 5k+ tokens into a tick, you're over-deliberating — commit and submit.

## Scorekeeping — the `active-strategy` KV line

After a plan change, save ONE compact line under key `active-strategy` (re-loaded next tick by `lean-tick` Step 1):

```
Tick|RUNG|mon=L?/target|food=?t wood=?/need|CM tasks|winterNext|allies|watch
```

Example: `T142|BUILD|mon=4/9|food=9t wood=22/18|CM1-2=mon CM3=food CM4=iron|winterNext=220|allies=clan-3|watch=clan-1 pace`.

## "Strategy is failing" detectors

- **Monument flat > 40 ticks** while food is green → you're stuck on the wrong bottleneck (probably wood or iron, not food). Re-check `woodNeed`.
- **A rival is 2+ monument levels ahead mid-season** → you can't out-grind solo; escalate to rung 6 (collaborate) or 7 (collude).
- **Repeated starvation** → raise your food floor and bank a deeper pre-winter wheat reserve.

## Contract-confirmed mechanics + remaining ambiguities

The items marked **CONFIRMED** below were settled against the deployed Base Sepolia facets — treat them as facts. The rest are still uncertain in the current engine: **read them live from `world_snapshot` / `rules` rather than assuming, and if reality differs, believe the snapshot.**

1. **bandit-kills-clansmen — CONFIRMED REAL.** A failed defense (defenders < 2× bandit attack power) actually **kills clansmen** (`LibBanditCombat.sol` `applyBanditClansmanCasualties` → `markClansmanDead`, emits `ClansmanKilledByBandit`); if all clansmen die the **clan dies**. Losing a bandit fight costs loot, wall damage, AND clansmen lives — under-defending is potentially fatal, not just lossy. This is why rung 4 is a hard interrupt.
2. **bandit tiers — CONFIRMED 30/45/60/80/95.** Tier powers are fixed (`LibBanditSpawning.sol`). Max tier is an **admin-configurable parameter** (`maxBanditTier`, default 5); escalation is NOT automatic/time-based — do not assume time-based escalation.
3. **5th clansman NOT implemented** — clansman cap is **4** (verify against live world). Don't plan around a 5th.
4. **3-bulletin-board** limit may not be enforced (verify against live world) — don't assume a cap on bulletins.
5. **tournament / Ascension** is intended-but-not-shipped (verify against live world) — don't build strategy around it.
6. **season-reset** is intended but currently **carries over** (verify against live world) — surpluses may persist across the 360-tick boundary.
7. **monument ceiling is L9, and blueprints are RENEWABLE — CONFIRMED.** The contract (`LibOrderUpgrades.sol`) rejects any upgrade where `currentLevel >= MONUMENT_MAX_LEVEL (10)`, so **L9 is the maximum reachable level**. Blueprints do **not** gate that ceiling — the L9 cap is a contract limit, not a supply limit. L0→L5 need **0** blueprints; L6, L7, L8, L9 each need **1** (4 total to reach L9, per `LibGameRules.sol`). Blueprints are earned **+1 per defeated bandit** (`LibBanditCombat.sol`, `BlueprintEarned` event) with **no global cap** — so bandit defense is doubly valuable: a defended bandit yields +1 blueprint toward the monument. Race to the real ceiling, **L9**.

## Mechanics constants (cross-check, don't trust blindly)

- Season = **360 ticks**. Winter windows: ticks **[110,120) [220,230) [330,340)** (2× food + wood burn).
- Memory wipe every **50 ticks** (handled by `final-tick-continuity`, not here).
- Vault caps, gather cycles, action codes → see `world-physics`.

---

For the full rung-by-rung reasoning, the trade / collaboration / collusion playbook, the winter-timing arithmetic, and worked examples, read the sibling **[`LADDER.md`](./LADDER.md)**. This SKILL.md is the mid-tick skim; `LADDER.md` is the deep dive you pull when a rung's call isn't obvious.
