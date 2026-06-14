# ClanWorld v4.2 — State Schema & Interface Specification

Status: Draft  
Purpose: Contract-facing technical spec synchronized to the consolidated ClanWorld v4 spec, the v4.1 addendum, and the agreed schema/accounting decisions.  
Audience: Solidity implementers, backend/runtime implementers, agent-harness implementers, frontend/replay tooling.

---

## 1. Scope and intent

This document defines the contract-facing technical shapes for ClanWorld v4.2:
- canonical enums
- persistent state structs
- accounting model
- mission and parameter schemas
- raw vs derived read interfaces
- write interfaces and access control
- events and status codes
- settlement semantics and invariants
- worked timing examples

This is not Solidity code. It is an RFC-style pseudocode spec intended to remove ambiguity before implementation.

Where this document conflicts with older drafts, **the consolidated v4 spec + v4.1 addendum + this interface spec wins**.

---

## 2. Execution model

ClanWorld uses a hybrid execution model.

### 2.1 Onchain responsibilities
The contract layer is the source of truth for:
- clan ownership and iNFT-linked identity
- world tick index and season lifecycle
- mission commitments
- clan vault balances
- clansman carry balances
- clan gold purse balances
- blueprint balances
- bandit world state
- building levels
- winter cadence and cold damage
- market intent execution timing
- eager settlement at world-contact events
- elimination state and payout ranking inputs

### 2.2 Heartbeat responsibilities
The world advances via `heartbeat()`.

Heartbeat takes **no caller-provided randomness parameter**.

The heartbeat closes the currently open tick, resolves all required tick-end effects, then opens the next tick.

### 2.3 Correct heartbeat ordering
For the closing tick `T`, heartbeat resolves in this order:

1. resolve effects completing during tick `T` that are already locally determined
2. resolve all scheduled market actions whose `executeAtTick == T`
3. eagerly settle any clans required for pending world-event evaluation
4. resolve world events for tick `T` (including bandit attacks and bandit state transitions)
5. increment `currentTick += 1` and derive/store the seed for the newly opened tick

### 2.4 Eager-settle scope for bandits
Before selecting a bandit target in region `R`, the engine must eagerly settle:
- all clans with homebases in region `R`
- all clans whose defenders are currently registered at any base in region `R`

This is required so target selection, defense totals, starvation state, and vault values are correct at attack resolution time.

Diamond migration note: the facet implementation currently satisfies this by
settling all live clans at the start of `heartbeat()` before market, bandit, and
season logic runs. That is broader than the monolith's region-specific eager
settle hooks, but preserves the same correctness invariant for normal heartbeat
operation. Reintroducing narrower bandit eager-settle hooks is intentionally
tracked as future gas/backlog work rather than part of the first diamond parity
patch.

### 2.5 Lazy vs eager settlement
Settlement is hybrid.

**Lazy settlement** is allowed for isolated clan progression:
- travel
- gather
- wait
- local build progression
- local upkeep propagation

**Eager settlement** is required for world-contact state:
- scheduled market action resolution
- bandit attacks and bandit state transitions
- winter boundary transitions
- season boundary transitions
- any future cross-clan mechanic touching shared world state

### 2.6 Immediate market execution
Workers already in Unicorn Town and eligible to act may execute an immediate market action directly in the Elder tx.

This is still a mission/order action. It:
- requires the worker already be physically in Unicorn Town
- requires the worker be in `Waiting`
- executes immediately in transaction order
- consumes the worker cooldown
- returns the worker to `Waiting`
- updates mission metadata/nonce like any other mission

---

## 3. Tick and timing semantics

### 3.1 Tick interval
Target heartbeat cadence is **60 seconds per tick**.

Implementation note:
- real heartbeat arrival may drift by a few seconds due to automation / block timing
- game semantics still treat each successful heartbeat as the boundary between discrete ticks

### 3.2 Open tick model
`currentTick` is the currently open live tick window.

If `currentTick == 307`, then:
- the world is currently in tick 307
- any Elder tx landing now belongs to tick 307
- the next heartbeat will close tick 307 and open tick 308

### 3.3 Mission start tick
A mission submitted during tick `T` has:
- `startTick = T`

### 3.4 Travel semantics
For a mission submitted during tick `T` with travel duration `d`:
- travel consumes ticks `T` through `T + d - 1`
- the worker arrives at the **start** of tick `T + d`
- tick `T + d` counts as the first action tick

### 3.5 Worked example
If:
- `currentTick = 307`
- a worker is one tick from Forest
- Elder submits `(goto Forest, ChopWood)` during tick 307

Then:
- tick 307 = travel tick
- worker arrives at start of tick 308
- tick 308 is the first wood-gather action tick

### 3.6 Cooldown semantics
Each clansman has a **real-time 60 second cooldown** between mission submissions.

This cooldown is:
- time-based, not tick-based
- checked against `block.timestamp`
- intentionally able to cause a worker to miss a tick window if the Elder waits too long after cooldown expiry

Suggested storage field:
- `cooldownEndsAtTs`

### 3.7 Mission interruption and cooldown
Any successfully submitted mission, including an interrupting mission, starts a new cooldown.

If a clansman is interrupted mid-mission by a valid new mission:
- the old mission is settled through current tick
- the new mission is installed
- `cooldownEndsAtTs` is reset

---

## 4. Canonical accounting model

### 4.1 Source of truth
The canonical source of truth for gameplay balances is the **internal game ledger**, not ERC20 wallet balances.

Canonical internal balances are:
- clan vault resources
- clan gold purse balance
- clan blueprint balance
- per-clansman carry balances

### 4.2 Role of ERC20 tokens
ERC20 tokens exist at the **market / payout boundary**, not as the canonical internal source of truth for gameplay.

ERC20s are used for:
- interaction with seeded Uniswap pools
- optional prize payout plumbing
- optional future externalization / withdrawal features

ERC20 balances are **not** the authoritative representation of a clan’s vault or a clansman’s wheelbarrow.

### 4.3 Balance domains
There are three balance domains:

**Clansman carry domain**
- wood
- iron
- wheat
- fish

Used for:
- gathering
- hauling
- direct sell-to-market when physically in Unicorn Town
- receiving bought resources from market actions

**Clan vault domain**
- wood
- iron
- wheat
- fish

Used for:
- upkeep
- winter burn
- construction spending
- bandit theft
- OTC clan-to-clan resource transfers

**Clan purse domain**
- gold
- blueprint fragments

Used for:
- market sale proceeds
- market purchase spending
- mercenary payments
- OTC transfers of abstract assets

### 4.4 Deposit rule
Carried resources do not count for:
- upkeep
- winter burn
- construction
- bandit loot value
- OTC transfers

Carried resources only enter the clan vault after `DepositResources` resolves at homebase.

### 4.5 Gold mining bonus rule
If a worker hits the iron mining gold bonus:
- the bonus gold is credited directly to the **clan gold purse** during settlement
- no `carryGold` field exists

Gold is never physically hauled by workers.

---

## 5. Canonical constants and world parameters

These are config constants or governance-set params for v4.2.

```solidity
uint64 TICK_SECONDS = 60;
uint64 TICKS_PER_WINTER_CYCLE = 110;
uint64 WINTER_DURATION_TICKS = 10;
uint64 SEASON_DURATION_TICKS = 360;

uint64 BANDIT_COOLDOWN_TICKS = 10;
uint64 BANDIT_CAMP_TICKS = 3;
uint64 BANDIT_REST_TICKS = 2;
uint8  BANDIT_MAX_ATTACK_ATTEMPTS = 6;

uint64 CLANSMAN_COOLDOWN_SECONDS = 60;

uint256 WOOD_CAP  = 15e18;
uint256 IRON_CAP  = 5e18;
uint256 WHEAT_CAP = 40e18;
uint256 FISH_CAP  = 8e18;

uint256 WOOD_BASE_YIELD = 2e18;
uint256 WOOD_CRIT_BONUS = 1e18;
uint16  WOOD_CRIT_BPS = 2000;      // 20%

uint256 IRON_BASE_YIELD = 5e17;    // 0.5e18, literal fractional yield
uint16  GOLD_FROM_IRON_BPS = 200;  // 2%
uint256 GOLD_FROM_IRON_AMOUNT = 1e18;

uint16  FISH_DOCKS_BPS = 2500;     // 25%
uint16  FISH_DEEP_BPS = 7500;      // 75%

uint256 WHEAT_UPKEEP_PER_CLANSMAN = 1e18;
uint256 FISH_UPKEEP_PER_CLANSMAN = 1e17; // 0.1 fish
uint256 WINTER_WOOD_BURN_PER_BASE = 1e18;

uint16 BANDIT_BASE_STEAL_BPS = 2000;          // 20%
uint16 BANDIT_DROP_TO_DEFENDERS_BPS = 5000;   // 50%
```

---

## 6. Route model

### 6.1 Canonical path table
All travel is resolved using a canonical, deterministic route table for `(srcRegion, dstRegion)`.

The table yields:
- total travel ticks
- canonical packed path

### 6.2 Route storage shape
Implementers may choose one of:
- `mapping(uint8 => mapping(uint8 => PackedRoute))`
- fixed arrays in immutable storage
- pure lookup library

Suggested shape:

```solidity
struct PackedRoute {
    uint8 travelTicks;
    bytes8 path; // ordered region ids, e.g. [6,4,3,2,0,0,0,0]
}
```

### 6.3 Path semantics
If a worker is rerouted mid-travel, current region is derived by:
- mission `startTick`
- elapsed ticks
- canonical packed path for that mission

No runtime pathfinding is performed onchain.

### 6.4 Path length constraint
`bytes8 path` assumes a maximum of 8 nodes in any canonical route.

This is safe for the current 8-region map but must be revisited if the map expands.

### 6.5 Identity travel query
`quoteTravel(src, src)` returns:
- `travelTicks = 0`
- `path = [src]`

---

## 7. Persistent state structs

### 7.1 WorldState

```solidity
struct WorldState {
    uint64 currentTick;
    uint64 seasonStartTick;
    uint64 seasonEndTick;
    bool seasonFinalized;

    uint64 nextHeartbeatAtTs;
    uint64 nextBanditSpawnEligibleTick;
    uint16 currentBanditSpawnChanceBps;
    bytes32 currentTickSeed;

    uint32 activeBanditId;       // 0 if none
    bool winterActive;
    uint64 winterStartsAtTick;   // first winter start is tick 110
    uint64 winterEndsAtTick;     // 0 if not active

    uint64 nextCommitSequence;   // global monotonic FIFO sequence for scheduled market actions
}
```

### 7.2 TreasuryState

```solidity
struct TreasuryState {
    address treasuryOwner;
    uint256 prizePotGold;

    bool poolsSeeded;
    address woodToken;
    address wheatToken;
    address fishToken;
    address ironToken;
    address goldToken;
    address blueprintToken;

    address woodGoldPool;
    address wheatGoldPool;
    address fishGoldPool;
    address ironGoldPool;
}
```

### 7.3 Clan

```solidity
struct Clan {
    uint32 clanId;
    uint256 iftTokenId;
    address owner;
    ClanState clanState;

    uint8 baseRegion;
    uint8 baseLevel;
    uint8 wallLevel;
    uint8 monumentLevel;
    uint8 livingClansmen;

    uint64 lastSettledTick;
    uint64 starvationStartsAtTick; // 0 or max sentinel if none
    bool starvingCached;

    uint16 coldDamage;             // resets to 0 at winter end

    uint256 goldBalance;
    uint256 blueprintBalance;

    uint256 vaultWood;
    uint256 vaultIron;
    uint256 vaultWheat;
    uint256 vaultFish;
}
```

### 7.4 WheatPlot

Each clan owns exactly two plots.

```solidity
struct WheatPlot {
    WheatPlotState state;
    uint8 region;              // WestFarmland or EastFarmland
    uint256 remainingWheat;
    uint64 regrowUntilTick;
}
```

Winter transition semantics:
- at winter start: plots enter `WinterLocked`
- at winter end: `WinterLocked -> Regrowing`
- after 4 ticks: `Regrowing -> Harvestable` with reset `remainingWheat`

### 7.5 Clansman

```solidity
struct Clansman {
    uint32 clansmanId;
    uint32 clanId;
    ClansmanState state;
    uint8 currentRegion;

    uint64 cooldownEndsAtTs;
    uint64 lastMissionNonce;

    uint256 carryWood;
    uint256 carryIron;
    uint256 carryWheat;
    uint256 carryFish;
}
```

### 7.6 Mission

Store missions separately from clansmen.

```solidity
struct Mission {
    bool active;

    uint64 nonce;
    uint32 clansmanId;

    uint8 startRegion;
    uint8 targetRegion;
    ActionType action;

    uint64 startTick;
    uint64 arrivalTick;
    uint64 actionStartTick;

    bytes32 missionSeed;
    MarketExecutionMode marketMode;

    uint32 targetClanId;   // DefendBase only
    address marketToken;   // market token for buy/sell
    uint256 marketAmount;  // exact-in for sell, exact-out for buy
    uint256 maxGoldIn;     // market_buy only, 0 otherwise
}
```

### 7.7 BanditTroop

```solidity
struct BanditTroop {
    uint32 banditId;
    BanditState state;

    uint8 currentRegion;
    uint8 attackAttemptsMade;
    uint64 stateEnteredTick;
    uint64 nextActionTick;

    uint8 tier;
    uint16 attackPower;

    uint256 carryWood;
    uint256 carryIron;
    uint256 carryWheat;
    uint256 carryFish;
}
```

### 7.8 ScheduledMarketAction

Scheduled market actions must resolve eagerly at heartbeat boundaries and should therefore be indexed explicitly rather than lazily inferred.

```solidity
struct ScheduledMarketAction {
    uint64 executeAtTick;
    uint64 commitSequence;   // global monotonic FIFO order
    uint32 clanId;
    uint32 clansmanId;
    ActionType action;       // MarketBuy or MarketSell

    address marketToken;
    uint256 marketAmount;    // exact-in for sell, exact-out for buy
    uint256 maxGoldIn;       // buy only, 0 otherwise
}
```

Resolved scheduled actions should be deleted from storage after execution.

### 7.9 DefenseContribution

Used for one combat boundary to distribute loot correctly.

```solidity
struct DefenseContribution {
    uint32 clansmanId;
    uint32 clanId;
    uint16 defensePoints;
}
```

### 7.10 Active defender registries

Required so heartbeat can identify defender participants without scanning all clans.

```solidity
mapping(uint32 => uint32[]) activeDefendersByBase;
mapping(uint32 => uint32) defendingBaseOfClansman;   // 0 if none
mapping(uint32 => uint32) defenderIndexPlusOne;      // swap-pop helper
```

Semantics:
- when a worker successfully enters `DefendBase(targetClanId)`, add worker id to `activeDefendersByBase[targetClanId]`
- when defend mission is interrupted, worker dies, worker changes mission, or defending clan dies, remove worker from the registry

### 7.11 Defense contribution storage

Suggested storage shape:

```solidity
mapping(uint32 => DefenseContribution[]) defenseContributionsByBanditId;
```

These entries are temporary and should be cleared after loot distribution for that attack resolution.

---

## 8. Mission parameter semantics

### 8.1 General mission shape
A mission is still conceptually:
- `gotoRegion`
- `doAction`
- optional typed params

Implementation uses flattened fixed fields in `Mission` instead of dynamic `bytes params`.

### 8.2 DefendBase semantics
`DefendBase` is a continuous mission that:
- persists until interrupted by Elder
- does not auto-complete after one bandit event
- allows a worker to defend across multiple attacks if left in place

### 8.3 MarketSell semantics
`MarketSell` is **exact input only**.

Meaning:
- source = worker carry balance
- destination = clan gold purse
- `marketAmount` = exact amount of resource to sell
- no `minOut` in v1

### 8.4 MarketBuy semantics
`MarketBuy` is **exact output only**.

Meaning:
- source = clan gold purse
- destination = worker carry balance
- `marketAmount` = exact amount of resource to buy
- `maxGoldIn` = max purse gold willing to spend

Validation:
- requested output must fit within remaining carry capacity of that worker
- if required gold at execution time exceeds `maxGoldIn`, buy fails
- if clan purse lacks enough gold at execution time, buy fails

### 8.5 Market token validation
For v1:
- `MarketSell.marketToken != goldToken`
- `MarketBuy.marketToken != goldToken`

Gold is the quote / purse asset, not the traded resource token in these mission forms.

---

## 9. Read interfaces

### 9.1 Raw getters
These return raw committed storage.

```solidity
function getWorldState() external view returns (WorldState memory);
function getTreasuryState() external view returns (TreasuryState memory);
function getClan(uint32 clanId) external view returns (Clan memory);
function getClansman(uint32 clansmanId) external view returns (Clansman memory);
function getActiveMission(uint32 clansmanId) external view returns (Mission memory);
function getBanditTroop(uint32 banditId) external view returns (BanditTroop memory);
function getWheatPlots(uint32 clanId) external view returns (WheatPlot memory west, WheatPlot memory east);
function getScheduledMarketActionsForTick(uint64 tick) external view returns (ScheduledMarketAction[] memory);
function getActiveDefenders(uint32 targetClanId) external view returns (uint32[] memory);
```

### 9.2 Derived getters
These may settle lazily in view / simulation form.

```solidity
function getDerivedClanState(uint32 clanId) external view returns (DerivedClanState memory);
function getDerivedClansmanState(uint32 clansmanId) external view returns (DerivedClansmanState memory);
function getBanditTargetPreview(uint32 banditId) external view returns (uint32 previewClanId);
function quoteTravel(uint8 src, uint8 dst) external view returns (uint8 travelTicks, bytes8 path);
function quoteLootValue(uint32 clanId) external view returns (uint256 lootValue);
```

### 9.3 Bandit target preview disclaimer
`getBanditTargetPreview()` is **non-binding**.

Bandit targeting is recomputed at attack resolution time using then-current eagerly settled state.

---

## 10. Write interfaces and access control

### 10.1 Access control rules

- `submitClanOrders(clanId, ...)`
  - only clan owner or approved operator
- `transferGold(...)`, `transferVaultResource(...)`, `transferBlueprint(...)`, `transferBundle(...)`
  - only sender clan owner or approved operator
- `mintClan(...)`
  - public payable if minting is enabled
- `seedPools(...)`
  - only owner/admin
- `finalizeSeason()`
  - permissionless after season end, because outcome is deterministic
- `heartbeat()`
  - permissionless, but rate-limited by `nextHeartbeatAtTs`

### 10.2 Core write functions

```solidity
function heartbeat() external;
function submitClanOrders(uint32 clanId, ClanOrder[] calldata orders) external returns (OrderResult[] memory);
function settleClan(uint32 clanId) external;
function mintClan(address to) external payable returns (uint32 clanId, uint256 iftTokenId);
function seedPools(PoolSeedConfig calldata cfg) external;
function finalizeSeason() external;
```

### 10.3 OTC transfer surface

Internal accounting requires explicit transfer functions.

```solidity
function transferGold(uint32 fromClanId, uint32 toClanId, uint256 amount) external;
function transferVaultResource(uint32 fromClanId, uint32 toClanId, ResourceType resource, uint256 amount) external;
function transferBlueprint(uint32 fromClanId, uint32 toClanId, uint256 amount) external;
function transferBundle(
    uint32 fromClanId,
    uint32 toClanId,
    uint256 gold,
    uint256 blueprint,
    uint256 wood,
    uint256 iron,
    uint256 wheat,
    uint256 fish
) external;
```

OTC transfers may draw only from:
- clan vault resources
- clan gold purse
- clan blueprint balance

OTC transfers may **not** draw from worker carry balances.

### 10.4 ClanOrder

```solidity
struct ClanOrder {
    uint32 clansmanId;
    uint8 gotoRegion;
    ActionType action;

    uint32 targetClanId;
    address marketToken;
    uint256 marketAmount;
    uint256 maxGoldIn;
}
```

### 10.5 OrderResult

```solidity
struct OrderResult {
    uint32 clansmanId;
    StatusCode status;
    uint64 cooldownEndsAtTs;
    uint64 missionNonce;
}
```

### 10.6 Pool seeding config

```solidity
struct PoolSeedConfig {
    uint256 woodSeed;
    uint256 wheatSeed;
    uint256 fishSeed;
    uint256 ironSeed;
    uint256 goldSeedForWood;
    uint256 goldSeedForWheat;
    uint256 goldSeedForFish;
    uint256 goldSeedForIron;
}
```

### 10.7 Prize pot routing note
If prize pot splitting is implemented, `mintClan` should route the configured mint-revenue share into `TreasuryState.prizePotGold` or an equivalent internal treasury bucket.

This is optional to ship in the first playable cut.

---

## 11. Randomness, market execution, and reentrancy

### 11.1 Tick seed derivation
Heartbeat must derive the tick seed onchain.

Suggested v1 formula:

```solidity
bytes32 tickSeed = keccak256(
    abi.encode(
        currentTick,
        block.prevrandao,
        block.timestamp,
        block.number
    )
);
```

If target chain behavior differs, the implementation may swap to a chain-appropriate source later, but caller-supplied seed input is forbidden.

### 11.2 Immediate vs scheduled market ordering
Immediate market actions during tick `T` execute immediately in Elder tx order against current pool state at that tx’s execution time.

Scheduled market actions for tick `T` execute later at the closing heartbeat of tick `T`, in ascending `commitSequence` order.

Therefore:
- immediate actions during tick `T` may front-run scheduled actions that will execute at the close of tick `T`

### 11.3 Scheduled action lifecycle
A scheduled market action:
- is created when a travel-based market mission is accepted
- is indexed under `executeAtTick`
- executes eagerly at the corresponding heartbeat
- is deleted from storage after success or failure resolution

### 11.4 Reentrancy and interaction discipline
Any function path that can trigger AMM interaction must follow checks-effects-interactions discipline.

Recommended:
- apply `nonReentrant` to immediate-order paths that can swap
- apply `nonReentrant` to `heartbeat()` if it performs scheduled swaps
- never leave partially updated clan/carry state around external calls

Even if only known V2 pools are used in v1, implementation should still follow safe external-call patterns.

---

## 12. Mission and settlement semantics

### 12.1 Submission flow
When Elder submits one or more clansman orders:

1. settle the clan forward to current tick
2. validate each order independently
3. apply valid orders
4. return per-clansman results
5. invalid orders do not revert the whole tx

### 12.2 Mission interruption
If a worker receives a valid replacement mission:
- settle progress through current tick
- derive current region from canonical route and elapsed ticks
- preserve carried resources
- discard old mission
- install new mission
- reset cooldown

### 12.3 Mission completion
When a mission completes naturally:
- worker transitions to `Waiting`
- unless the action is a persistent continuous action like `DefendBase`

### 12.4 Per-tick local settlement order
For each settled local tick:

1. apply clan upkeep for the tick
2. update starvation status if shortage occurred
3. advance traveling workers by one tick along route
4. resolve one tick of continuous action
5. apply single-tick action effects
6. move completed or blocked workers to `Waiting`

### 12.5 Just-in-time deposit rule
Because upkeep is applied before deposit effects, a worker arriving home with wood/food in carry does **not** save the base from that same tick’s winter burn or upkeep shortage.

This is intentional and punishes just-in-time logistics.

### 12.6 Overflow clamp rule
Normal gathering yield is clamped to the worker’s remaining capacity.

Example:
- worker has 14 wood already carried
- 1 wood capacity remains
- tick roll would yield 3 wood
- worker only gains 1 wood
- mission then transitions to `Waiting`

### 12.7 Summer starvation
Outside winter, starvation is nonlethal.

A starving clan:
- gathers at 50% output
- contributes 0 defense
- does not lose workers directly from starvation outside winter

### 12.8 Dead clans
When a clan’s `livingClansmen == 0`:
- clan state becomes `Dead`
- remaining vault resources are burned
- no salvage mechanic exists in v1

---

## 13. Events

Suggested event surface:

```solidity
event TickAdvanced(uint64 closedTick, uint64 openedTick, bytes32 tickSeed);
event ClanSettled(uint32 indexed clanId, uint64 settledToTick);
event MissionAssigned(uint32 indexed clanId, uint32 indexed clansmanId, uint64 missionNonce, ActionType action, uint8 startRegion, uint8 targetRegion);
event MissionInterrupted(uint32 indexed clanId, uint32 indexed clansmanId, uint64 oldMissionNonce, uint64 newMissionNonce);
event MissionCompleted(uint32 indexed clanId, uint32 indexed clansmanId, uint64 missionNonce, ActionType action);
event WorkerArrived(uint32 indexed clanId, uint32 indexed clansmanId, uint8 region, uint64 tick);
event ResourcesDeposited(uint32 indexed clanId, uint32 indexed clansmanId, uint256 wood, uint256 iron, uint256 wheat, uint256 fish);

event ImmediateMarketActionExecuted(
    uint32 indexed clanId,
    uint32 indexed clansmanId,
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 amountOut
);

event ScheduledMarketActionExecuted(
    uint64 indexed executeAtTick,
    uint64 indexed commitSequence,
    uint32 indexed clanId,
    uint32 clansmanId,
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 amountOut
);

event MarketActionFailed(uint32 indexed clanId, uint32 indexed clansmanId, ActionType action, StatusCode reason);

event BanditSpawned(uint32 indexed banditId, uint8 region, uint8 tier, uint16 attackPower);
event BanditAttackResolved(uint32 indexed banditId, uint32 indexed targetClanId, bool defended, uint16 attackPower, uint16 totalDefense);
event BlueprintAwarded(uint32 indexed clanId, uint32 indexed banditId, uint256 amount);
event WinterStarted(uint64 indexed tick);
event WinterEnded(uint64 indexed tick);
event ClanEliminated(uint32 indexed clanId, uint64 indexed tick);
```

---

## 14. Status codes

```solidity
enum StatusCode {
    OK,
    ERR_CLAN_DEAD,
    ERR_CLAN_NOT_OWNED,
    ERR_CLANSMAN_DEAD,
    ERR_INVALID_CLANSMAN,
    ERR_INVALID_REGION,
    ERR_INVALID_ACTION,
    ERR_INVALID_TARGET,
    ERR_COOLDOWN_ACTIVE,
    ERR_NOT_WAITING,
    ERR_NOT_IN_UNICORN_TOWN,
    ERR_NOT_AT_HOMEBASE,
    ERR_NOT_AT_TARGET_BASE,
    ERR_NOT_DEFENDABLE,
    ERR_MISSING_RESOURCES,
    ERR_EMPTY_CARGO,
    ERR_PLOT_NOT_READY,
    ERR_PLOT_EMPTY,
    ERR_MARKET_ZERO_AMOUNT,
    ERR_MARKET_UNSUPPORTED_TOKEN,
    ERR_IMMEDIATE_MARKET_NOT_ELIGIBLE,
    ERR_MARKET_BUY_OVER_CAPACITY,
    ERR_MARKET_BUY_MAX_GOLD_EXCEEDED,
    ERR_WORLD_TICK_MISMATCH,
    ERR_NO_ACTIVE_BANDIT,
    ERR_SEASON_ENDED
}
```

---

## 15. Invariants

- a clansman may have at most one active mission
- a dead clansman cannot receive orders
- a dead clan cannot receive new workers or orders
- only vault resources count for upkeep, winter burn, building, and bandit target value
- bandits cannot spawn in Unicorn Town or Deep Sea
- at most one active bandit troop exists at once
- `Mission.startTick <= WorldState.currentTick`
- `DefendBase` persistence is explicit and does not auto-complete
- scheduled market actions are never lazily replayed; they resolve eagerly at heartbeat
- OTC transfers cannot draw from worker carry balances
- immediate market actions require `Waiting` + Unicorn Town + cooldown clear
- sell is exact-input; buy is exact-output with `maxGoldIn`

---

## 16. Worked examples

### 16.1 Travel and gather
If:
- `currentTick = 307`
- worker is one tick from Forest
- Elder submits `(goto Forest, ChopWood)` during tick 307

Then:
- tick 307 = travel tick
- worker arrives at start of tick 308
- tick 308 is the first gather tick

### 16.2 Immediate market sell
If:
- worker is `Waiting` in Unicorn Town
- cooldown is clear
- worker carries 12 wood
- Elder submits `MarketSell(wood, 12e18)`

Then:
- swap executes immediately in that tx
- clan gold purse increases by output
- worker stays in Unicorn Town
- worker returns to `Waiting`
- cooldown is consumed

### 16.3 Scheduled market buy
If:
- worker is one tick away from Unicorn Town in tick 307
- Elder submits `MarketBuy(wood, 5e18, 10e18)`

Then:
- tick 307 = travel
- tick 308 = single action tick in town
- heartbeat closing tick 308 attempts to buy exactly 5 wood spending at most 10 gold
- if price moved above 10 gold or purse balance is insufficient, trade fails, worker ends `Waiting`, cooldown consumed

### 16.4 Starving mercenary
If Clan B has a worker defending Clan A, and Clan B later enters starvation:
- that defending worker contributes 0 defense until Clan B starvation ends

This is intentional.

---

## 17. Notes on implementation priority

Must-have implementation decisions already locked here:
- onchain-derived heartbeat randomness
- permissioned / permissionless access surfaces
- internal canonical accounting
- explicit OTC transfer functions
- active defender registry
- global monotonic `commitSequence`
- split `Mission` storage from `Clansman`
- exact-input sell / exact-output buy model

With these locked, the contract can now be implemented without the major schema ambiguities present in earlier drafts.
