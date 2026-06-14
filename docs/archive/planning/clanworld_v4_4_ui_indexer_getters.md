# ClanWorld v4 — Proposed UI Indexer Getters

**Status:** Draft proposal, hackathon-scoped
**Applies to:** v4.2 state schema + v4.3 schema patch
**Audience:** ClanWorld contract implementer
**Author intent:** keep the demo UI's indexer cheap and simple

---

## 0. Context

These are proposed additions to the v4.2 / v4.3 contract spec to support the hackathon demo UI's indexer with minimum RPC cost.

All proposed functions are:

- `view` only (no state writes, no settlement writes)
- pure aggregations over state already accessible via existing getters
- fully covered by v4.3 §J ("Derived Getter Non-Mutation Rule")

**No game mechanics are altered.** These are batched composition wrappers, designed to reduce indexer RPC calls per tick from roughly O(N × M) to O(1) for the v1 realm size of 4–8 clans.

---

## 1. Motivation

The demo UI's indexer (Convex) polls contract state every tick to maintain a reactive snapshot for clients. With raw getters only, a single tick refresh would require:

- 1 call for `getWorldState()`
- N calls for `getClan(clanId)` (per clan)
- N calls for `getDerivedClanState(clanId)` (per clan)
- M calls for `getDerivedClansmanState(clansmanId)` (per clansman)
- M calls for `getActiveMission(clansmanId)` (per clansman)
- 4 calls for pool reserves
- 1 call for `getBanditTroop`
- 1 call for `getBanditTargetPreview`

For 8 clans × 5 clansmen = 40 clansmen, this is roughly 100 RPC calls per tick. We have two Alchemy RPCs at 1M/day each = 2M total capacity, so this fits with massive headroom. The aggregator getters are about cleanliness and indexer simplicity, not quota relief.

The proposed additions reduce a tick refresh to **about 6 RPC calls**, dramatically simplifying indexer code. We have 2× Alchemy RPCs at 1M/day each (2M total capacity), so quota was never a real constraint — the win here is code simplicity and indexer reliability.

---

## 2. Proposed Functions

### 2.1 `getWorldSnapshot()`

**Purpose:** Single-call top-level world state, including leaderboard data for every clan.

**Signature:**

```solidity
struct WorldSnapshot {
    uint64 currentTick;
    uint64 seasonStartTick;
    uint64 seasonEndTick;
    bool   seasonFinalized;
    bool   winterActive;
    uint64 winterStartsAtTick;
    uint64 winterEndsAtTick;
    uint32 activeBanditId; // 0 if none
    bytes32 currentTickSeed;

    LeaderboardEntry[] leaderboard;
}

struct LeaderboardEntry {
    uint32 clanId;
    address owner;
    uint8 monumentLevel;
    uint8 baseLevel;
    uint8 wallLevel;
    uint8 livingClansmen;
    ClanState state;       // ACTIVE, DEAD
    uint256 lootValue;     // settled to current tick (uses quoteLootValueSettled)
}

function getWorldSnapshot() external view returns (WorldSnapshot memory);
```

**Notes:**

- `lootValue` should call the v4.3 `quoteLootValueSettled` path
- The leaderboard does not need to be sorted; UI sorts client-side
- Drives: top HUD bar, season clock, winter indicator, leaderboard panel, bandit summary

---

### 2.2 `getClanFullView(uint32 clanId)`

**Purpose:** Single-call complete clan rendering data, including all clansmen with derived states, active missions, plot states, and defender bookkeeping.

**Signature:**

```solidity
struct ClanFullView {
    DerivedClanState clan;      // existing struct, v4.2 §9.2
    ClansmanFullView[] clansmen;
    WheatPlot westPlot;
    WheatPlot eastPlot;
    uint32[] incomingDefenderIds; // workers from other clans currently defending this base
    uint32   thisClanDefendingBaseId; // base ID this clan's defending workers are at, or 0
}

struct ClansmanFullView {
    DerivedClansmanState clansman; // existing struct
    Mission              activeMission; // existing struct
}

function getClanFullView(uint32 clanId) external view returns (ClanFullView memory);
```

**Notes:**

- One call per clan per tick. With 8 clans this is the bulk of RPC traffic.
- Composition order: settle clan (read-only simulation) → enumerate clansmen → for each, call existing derived getters → bundle.
- Drives: sprite layer, mission timeline panel, vault inventory display, defender HUD.

---

### 2.3 `getMarketState()`

**Purpose:** Single-call complete Unicorn Town market state including spot prices and the next two ticks of scheduled queue.

**Signature:**

```solidity
struct MarketState {
    PoolReserves wood;
    PoolReserves wheat;
    PoolReserves fish;
    PoolReserves iron;

    uint64 currentTick;
    ScheduledMarketAction[] currentTickQueue; // executes at heartbeat closing currentTick
    ScheduledMarketAction[] nextTickQueue;    // executes at heartbeat closing currentTick + 1
}

struct PoolReserves {
    address resourceToken;
    uint256 resourceReserve;
    uint256 goldReserve;
    // Spot price as gold per resource, 18-decimal fixed point.
    // = goldReserve * 1e18 / resourceReserve, or 0 if resourceReserve == 0.
    uint256 spotPriceGoldPerResource;
}

function getMarketState() external view returns (MarketState memory);
```

**Notes:**

- `spotPriceGoldPerResource` is computed inline so the indexer does not have to do AMM math.
- The indexer stores each tick's spot price into Convex, building a per-resource price-history series for sparkline charts in the market panel.
- Drives: market panel, scheduled-trade ticker, per-resource price charts.

---

### 2.4 `getActiveBanditView()`

**Purpose:** Single-call complete bandit state including its currently-projected target.

**Signature:**

```solidity
struct ActiveBanditView {
    bool   exists;                    // false if WorldState.activeBanditId == 0
    uint32 banditId;
    BanditState state;                // CAMPING, RESTING, ATTACKING, DEFEATED, ESCAPED
    uint8  currentRegion;
    uint8  attackAttemptsMade;
    uint8  maxAttemptsRemaining;
    uint64 stateEnteredTick;
    uint64 nextActionTick;
    uint8  tier;
    uint16 attackPower;

    uint256 carryWood;
    uint256 carryIron;
    uint256 carryWheat;
    uint256 carryFish;

    // Projected target if attack resolved this tick.
    // Uses bandit target-preview semantics from v4.2 §9.3 / v4.3 §H.
    uint32 projectedTargetClanId;     // 0 if no eligible target in current region
    uint256 projectedTargetLootValue; // 0 if no target
}

function getActiveBanditView() external view returns (ActiveBanditView memory);
```

**Notes:**

- Folds `getBanditTroop` + `getBanditTargetPreview` into one call.
- This is the most demo-critical getter — it drives the "bandits threatening" UI moment: camp sprite, danger pulse on projected target, attack countdown.

---

### 2.5 `getRegionPopulation(uint8 region)` *(optional, nice-to-have)*

**Purpose:** Single-call list of all clansmen currently in a given region, for tap-to-inspect tooltips in the detail view.

**Signature:**

```solidity
struct RegionOccupant {
    uint32 clansmanId;
    uint32 clanId;
    ClansmanState state;
    ActionType currentAction;  // None if Waiting
    uint64 missionNonce;
}

function getRegionPopulation(uint8 region) external view returns (RegionOccupant[] memory);
```

**Notes:**

- Optional. Can be derived clientside from the snapshot.
- Listed here for completeness in case the implementer prefers keeping that derivation onchain.

---

## 3. Implementation notes

### 3.1 Gas

All functions are `view`. Readers and indexer pay no gas. The only cost is bytecode size for the additional structs and functions, which should be negligible.

### 3.2 Settlement semantics

Per v4.3 §J ("Derived Getter Non-Mutation Rule"), none of these functions may mutate storage. They must simulate settlement using the same read-only path as `getDerivedClanState` and `quoteLootValueSettled`.

They must not call any function that writes settlement checkpoints.

### 3.3 Stable struct layouts

Once the indexer is deployed, changing struct layouts of these views breaks the UI. Treat them as a stable API. Add new fields at the end; never remove or reorder existing fields.

### 3.4 Pagination not needed for v1

With v1's max realm size of 8 clans, unbounded array returns are safe. If a future version grows beyond ~50 clans, add pagination to `getWorldSnapshot.leaderboard`.

---

## 4. Summary

| Function                        | Replaces           | Demo value                             |
| ------------------------------- | ------------------ | -------------------------------------- |
| `getWorldSnapshot()`            | ~14 calls          | High — every persistent HUD element    |
| `getClanFullView(clanId)`       | ~10 calls per clan | High — entire sprite layer             |
| `getMarketState()`              | ~5 calls           | Medium — market panel + price charts   |
| `getActiveBanditView()`         | 2 calls            | Critical — bandit drama moment         |
| `getRegionPopulation(region)`   | 0 (optional)       | Low — region tooltip nicety            |

Total per-tick indexer RPC count drops from ~100 to ~6 at v1 realm size.
