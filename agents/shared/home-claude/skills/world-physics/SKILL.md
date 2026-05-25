---
name: world-physics
description: Hard-won tactical reference for clan-world game physics — gather/consume/winter rates, mission mechanics, deposit rules, action+region IDs, and the bug patterns that cost ticks. Use whenever you're (a) planning a mission, (b) thinking about a tick's orders, (c) about to call elder clan submit-orders, (d) reasoning about starvation/winter, (e) considering wall/base/monument upgrades, (f) about to chain operations on the same clansman. Synthesized 2026-05-25 by the orchestrator from the four elders' ANCIENT_WISDOM files after the first winter cycle. Reflects the actual on-chain `ClanWorldConstants` library and the bug patterns each elder discovered the hard way.
---

# World physics — tactical reference

This skill is the synthesized lessons from the four elders' first winter cycle (ticks 654-670). Each rule here cost at least one wasted mission cycle to discover. Read it before any tick-action reasoning.

## I. Hard-won mission rules (DO NOT VIOLATE)

### Rule 1 — One order per clansman per tick

The contract enforces this. If you submit two `ClanOrder` entries with the same `clansmanId` in the same batch, the **second overwrites the first**. So:

- ❌ `[(1, region=4, action=HarvestWheat), (1, region=4, action=DepositResources)]` — clansman 1 ends up depositing with empty carry; the harvest order is gone.
- ✅ Issue gather order, **wait for the 4-tick mission to complete**, then issue the deposit order.

### Rule 2 — Do NOT reissue mid-mission

Each ClanOrder submission **resets** that clansman's current mission. If a clansman is on a 4-tick MineIron mission and you reissue MineIron at tick+2:

- The mission timer resets to 0.
- The 2 ticks of progress (and ~0.25 iron in carry) are lost.
- Net result: clansman never finishes, vault never grows.

Issue once. Wait until `state == 0` (idle, mission complete). Then issue next.

### Rule 3 — DepositResources requires the correct base region

`action=6 (DepositResources)` only works if `gotoRegion == your clan's baseRegion`. Two failure modes:

- ❌ `gotoRegion: 0` — that's `REGION_NOOP`, the deposit silently does nothing, carry sits in the clansman forever.
- ❌ `gotoRegion: <other region>` — clansman travels but doesn't deposit (depositing requires home).

Always look up your clan's `baseRegion` from the worldSnapshot. Clan 1's base = 1 (Forest), Clan 2's = 2 (Mountains), Clan 3's = 4 (West Farms), Clan 4's = 5 (East Farms). This mapping is from forked-live state, NOT 1:1 to elder index.

### Rule 4 — Stranded clansmen need to go home first

A clansman at `state=0` (idle) sitting at a non-base region with `carry=(0,0,0,0)` is **stranded** — they finished a mission that yielded nothing (e.g. plot depleted, cooldown gate). Issuing a new gather mission at their current region often does nothing because the cooldown is still active OR the local resource is exhausted.

Fix: send them home via `gotoRegion=baseRegion, action=6 (DepositResources)` even with empty carry — this resets their position. Next tick after settle, issue a fresh gather mission.

### Rule 5 — Verify clan ID against the on-chain owner mapping

The container `ELDER_N` env is **not necessarily** your `CLAN_ID`. On-chain clan ownership got re-shuffled during a forked-live cutover. Always:

1. On session start, look up your `CLAN_ID` env var.
2. Cross-reference with `worldSnapshot.clans[].owner` against your elder address.
3. If the briefing prompt names a clan ID, trust the env over the prompt.

## II. Per-tick clan upkeep

| Resource | Normal/tick (4 clansmen) | Winter/tick (4 clansmen) | Notes |
|---|---|---|---|
| Wheat | 4 | 8 | Multiplied 2x in winter |
| Fish | 0.4 | 0.8 | Multiplied 2x in winter |
| Wood | 0 | 3 | Winter-only: 0.5/clansman + 1/base |
| Iron | 0 | 0 | Not consumed (used for build/upgrade) |

**Wheat is the bottleneck**: it drains every tick, doubles in winter, and starvation triggers `starvationStartsAtTick` on the clan struct. When this hits, clansmen die.

**Fish carry cap = 8** (vault may show higher; trust observation but plan around 8). At winter consumption 0.8/tick, an 8-fish vault lasts exactly 10 winter ticks — barely. Build a multi-cycle buffer.

## III. Winter cadence

- `WINTER_START_TICK = 110` (first winter)
- `WINTER_DURATION_TICKS = 10`
- `WINTER_PERIOD_TICKS = 110` (cycles)
- `SEASON_DURATION_TICKS = 360`

Windows in season 2: tick 110, 220, 330; in season 3: 470, 580, 690; etc. (Observed: winter active at ticks 660-670 in this session.)

**Pre-winter prep window**: 8-10 ticks before winter starts. Stockpile wheat (need ~80 minimum per winter cycle for 4 clansmen), fish (~8 minimum), wood (~30 minimum).

## IV. Gather yields (per clansman per tick)

| Action ID | Action | Region (ID) | Yield/tick | Ticks to fill carry | Carry cap |
|---|---|---|---|---|---|
| 1 | ChopWood | Forest (1) | 1 (10% chance 2x crit) | ~15 | 15 |
| 2 | MineIron | Mountains (2) | 0.5 probabilistic (2% chance +1 gold crit) | ~10 | 5 |
| 3 | FishDocks | West/East Docks (6/7) | 0.25 | ~32 | 8 |
| 4 | FishDeepSea | Deep Sea (8) | 0.75 (preferred) | ~11 | 8 |
| 5 | HarvestWheat | West/East Farms (4/5) | 5 | ~8 | 40 |

**Spread harvest across multiple plots** when sending multiple wheat clansmen — `WHEAT_PLOT_STARTING_WHEAT=100`, `WHEAT_PLOT_REGROW_TICKS=4`. Four clansmen on one plot deplete fast; split across regions 4 and 5.

**Deep Sea > Docks for fish** by 3x. Always prefer region 8 unless you have a strategic reason.

## V. Action + region IDs (full)

### Actions (`ActionType` enum)

| ID | Name | Notes |
|---|---|---|
| 0 | None | Idle |
| 1 | ChopWood | At Forest (1) |
| 2 | MineIron | At Mountains (2) |
| 3 | FishDocks | At West/East Docks |
| 4 | FishDeepSea | At Deep Sea — best fish |
| 5 | HarvestWheat | At West/East Farms |
| 6 | DepositResources | Must use baseRegion |
| 7 | UpgradeWall | At your base |
| 8 | UpgradeBase | At your base |
| 9 | UpgradeMonument | At your base |
| 10 | DefendBase | targetClanId required |
| 11 | MarketBuy | marketToken + marketAmount + maxGoldIn |
| 12 | MarketSell | marketToken + marketAmount |
| 13 | Wait | Use to skip a tick |
| 14 | WithdrawResources | Pull from vault |

### Regions

| ID | Name | Yield speciality |
|---|---|---|
| 0 | NOOP (don't use as gotoRegion!) | — |
| 1 | Forest | Wood |
| 2 | Mountains | Iron |
| 3 | Unicorn Town | Trade hub |
| 4 | West Farms | Wheat |
| 5 | East Farms | Wheat |
| 6 | West Docks | Fish (slow, 0.25/tick) |
| 7 | East Docks | Fish (slow, 0.25/tick) |
| 8 | Deep Sea | Fish (fast, 0.75/tick) |

## VI. Cooldown & mission lifecycle

- `CLANSMAN_COOLDOWN_SECONDS = 60` (1 tick between missions).
- A mission goes: idle → TRAVELING (`state=1`) → ACTING (`state=2`) → idle (`state=0`).
- `activeMission.settlesAtTick` tells you when it ends.
- After settle, clansman returns to idle. Carry remains until `DepositResources` is called.

## VII. Operator-loop mechanics (transitional, while CLI is a v1 stub)

As of 2026-05-25, the `elder` CLI returns "elder CLI not yet implemented — this is a v1 stub" for all subcommands. Until the real CLI ships:

- **You reason.** State your intended orders in plain text or JSON in your reply to each tick prompt.
- **The orchestrator executes.** They parse your reply, build the `ClanOrder[]` tuple, and call `submitClanOrders(clanId, orders)` via `cast` impersonating your clan owner address on the anvil-fork.
- **Canonical order shape**: `{ clansmanId, gotoRegion, action, targetClanId, marketToken, marketAmount, maxGoldIn, withdrawResources: {wood, iron, wheat, fish} }`. Most fields are 0 / zero-address for gather missions.

When the CLI goes live, switch to `elder clan submit-orders` directly. But keep the rules in section I — they apply identically.

## VIII. Persistence

`/workspace/ANCIENT_WISDOM.md` is the only durable storage that survives container restarts. `elder memory save` is part of the v1 stub and doesn't persist yet. Write lessons learned to ANCIENT_WISDOM. Append, don't overwrite.

## IX. Quick-reference: this tick

1. Look up `worldSnapshot.currentTick` and `winterActive`.
2. For each living clansman, check `state` and `activeMission.settlesAtTick`.
3. If `state == 0` (idle): plan next mission per Section IV.
4. If `state == 1 or 2` (busy): wait, do NOT reissue (Rule 2).
5. If at non-base region + idle + zero carry: send home (Rule 4).
6. Submit one order per idle clansman, one tick at a time.

That's it. Most ticks need zero new orders — clansmen finish their work and you just check in.

---

*Source: synthesized from elder ANCIENT_WISDOM files written tick 661-666 of session 2026-05-25. Original files preserved at `/workspace/ANCIENT_WISDOM.md` per-elder.*
