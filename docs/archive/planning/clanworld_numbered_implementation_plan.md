# Clanworld — Numbered Implementation Plan with Phases and Cut Lines

This document is the execution-oriented build plan for Clanworld v1.

It is designed for a time-constrained implementation environment.
The main goal is to ensure there is always:
- a working core
- a clear next step
- a clear cut line when behind

---

## Phase 0 — repo, skeleton, and execution environment

### 0.1 Set up contract repo structure
Create:
- `contracts/`
- `test/`
- `script/`
- `docs/`

Suggested contracts:
- `ClanworldCore.sol`
- `ClanworldMarket.sol`
- `ClanworldTokenBoundary.sol` or helper module
- `ClanworldLib.sol`
- `IClanworld.sol`

### 0.2 Lock toolchain
Choose and lock:
- Solidity version
- framework (Foundry strongly preferred if already comfortable)
- OpenZeppelin version
- Uniswap integration version

### 0.3 Add CI basics
At minimum:
- compile
- tests
- formatting
- lint if practical

### 0.4 Set up local heartbeat runner
A tiny dev script should be able to:
- call heartbeat every 60s equivalent in local test mode
- optionally accelerate tick speed for demo/testing

**Cut line:** none. This phase is mandatory.

---

## Phase 1 — core data model and read surface

### 1.1 Implement enums, constants, structs
Add:
- region ids
- action types
- states
- status codes
- world/clan/clansman/mission/bandit/wheat plot structs

### 1.2 Implement core storage layout
Add canonical mappings:
- clans
- clansmen
- active mission by clansman
- defender registry
- scheduled actions by tick
- season/world state

### 1.3 Implement raw getters
Add:
- `getWorldStateRaw`
- `getClanRaw`
- `getClansmanRaw`
- `getBanditTroopRaw`
- `getScheduledMarketActionsForTick`

### 1.4 Implement derived getters
Add:
- `getClanDerivedState`
- `getClansmanDerivedState`
- `quoteTravel`
- `quoteLootValueRaw`
- `quoteLootValueSettled`
- `getBanditTargetPreview`

**Definition of done**
- contracts compile
- getters return sane data
- no game logic yet, but storage shape is stable

**Cut line:** none. This phase is mandatory.

---

## Phase 2 — clan mint / spawn lifecycle

### 2.1 Implement clan minting
Lock:
- payment handling
- clan id assignment
- owner assignment
- spawn region RNG
- initial state creation

### 2.2 Spawn workers
Create initial workers per clan:
- starting region = homebase region
- waiting state
- zero carry
- no active mission
- cooldown clear

### 2.3 Initialize starting balances
Apply:
- starting vault resources
- starting gold
- base/wall/monument starting levels
- wheat plot starting state

### 2.4 Add access control rules
Implement:
- clan owner / operator checks for order submission
- admin for pool seeding
- finalize permissions
- dead clan restrictions on OTC

**Definition of done**
- minting a clan gives a fully initialized playable clan
- getters show coherent initial state

**Cut line:** if behind, prize pot routing can be stubbed or deferred.

---

## Phase 3 — mission assignment and lazy settlement core

### 3.1 Implement order submission
Implement:
- per-clansman validation
- partial success return pattern
- cooldown checks
- mission overwrite semantics
- same-region / noop bypass

### 3.2 Implement lazy settlement engine
Implement settlement for:
- travel
- wait
- gather progression
- deposit progression
- local upkeep
- starvation state evolution

### 3.3 Implement mission timing rules
Lock:
- `startTick`
- `arrivalTick`
- `actionStartTick`
- interruption semantics
- overflow clamping
- transition to `WAITING`

### 3.4 Implement `defend_base`
Add:
- persistent defense mission semantics
- defender registry insertion/removal
- no auto-complete

**Definition of done**
- workers can receive missions
- time progression changes their derived state correctly
- interruption works
- no market or bandits yet

**Cut line:** none. This phase is mandatory.

---

## Phase 4 — heartbeat and world progression

### 4.1 Implement permissionless heartbeat
Lock:
- rate limit by time
- one tick per call
- onchain randomness derivation
- current tick increment

### 4.2 Implement correct heartbeat ordering
Heartbeat must do:
1. resolve effects completing this tick
2. resolve scheduled market actions
3. eagerly settle clans touched by pending world events
4. resolve world events
5. increment tick and derive/publish new seed

### 4.3 Implement domain-separated RNG helpers
Add helpers for:
- bandit spawn chance
- bandit region selection
- wood crit
- iron gold bonus
- fish chance
- any other random roll

### 4.4 Add winter / season timers to world state
Even if not fully active yet, wire:
- season timing
- winter timing
- next heartbeat timing

**Definition of done**
- heartbeat can advance the world safely
- tick semantics are stable
- RNG is internal and deterministic enough for v1

**Cut line:** if needed, winter logic can still be stubbed here.

---

## Phase 5 — gathering, deposits, and resource economy

### 5.1 Implement wood gathering
- base yield
- crit chance
- clamp to carry cap

### 5.2 Implement iron gathering
- fractional iron yield
- gold bonus to clan purse

### 5.3 Implement fishing
- dock probability
- deep sea probability

### 5.4 Implement wheat plot system
- harvestable state
- depletion
- regrow
- winter interaction hook

### 5.5 Implement deposit action
- worker carry -> vault transfer
- action tick semantics
- proper event emission

### 5.6 Implement starvation consequences
- next-tick starvation start
- 50% gathering penalty
- 0 defense contribution

**Definition of done**
- resources can be gathered, carried, deposited, and consumed by the economy

**Cut line:** wheat regrow can be simplified temporarily if necessary, but deposit and starvation cannot.

---

## Phase 6 — Unicorn Town market integration

### 6.1 Deploy/seed resource boundary tokens
Set up:
- resource boundary tokens if needed
- gold token boundary
- seed supply holder / treasury

### 6.2 Seed pools
Deploy and seed:
- wood/gold
- wheat/gold
- fish/gold
- iron/gold

### 6.3 Implement immediate market actions
- worker in town
- waiting
- off cooldown
- immediate sell exact-in
- immediate buy exact-out + maxGoldIn

### 6.4 Implement scheduled market actions
- queue by executeAtTick
- FIFO append ordering
- heartbeat execution and deletion

### 6.5 Implement market failure semantics
- buy fails if:
  - insufficient purse gold
  - required gold exceeds `maxGoldIn`
  - output exceeds carry capacity
  - liquidity unavailable
- action still consumes cooldown
- worker ends `WAITING`

### 6.6 Add events and market result surface
Emit:
- immediate market action executed
- scheduled market action executed
- market action failed

**Definition of done**
- worker can go to town and trade
- gold economy works
- immediate vs scheduled semantics are proven

**Cut line:** immediate market actions can be deferred if necessary, but scheduled market execution must exist.

---

## Phase 7 — OTC transfer surface

### 7.1 Implement gold transfer
- clan purse -> clan purse

### 7.2 Implement vault resource transfer
- clan vault -> clan vault

### 7.3 Implement blueprint transfer
- clan blueprint -> clan blueprint

### 7.4 Implement bundled transfer convenience
Optional:
- one call for mixed payment

### 7.5 Restrict dead clans
Dead clans cannot initiate transfers.

**Definition of done**
- mercenary / alliance payments have a real contract surface

**Cut line:** bundle transfer can be cut first.

---

## Phase 8 — building and progression

### 8.1 Implement wall upgrades
- costs
- action tick
- vault spend
- level increase

### 8.2 Implement base upgrades
- costs
- action tick
- defense effects

### 8.3 Implement monument upgrades
- costs
- action tick
- late-level blueprint gating

### 8.4 Implement score/rank getters
Expose:
- monument level
- time reached
- rank preview if useful

**Definition of done**
- clans can materially progress toward victory

**Cut line:** blueprint gating can be deferred temporarily if bandit loop is not ready yet.

---

## Phase 9 — bandit system

### 9.1 Implement bandit troop state machine
- spawn
- camp
- rest
- attack
- defeated
- escaped

### 9.2 Implement spawn chance logic
- cooldown
- increasing chance
- cap
- region selection

### 9.3 Implement eager-settle scope
Before target selection:
- settle all bases in region
- settle all active defenders for the candidate target base(s)

### 9.4 Implement deterministic attack resolution
- clansman defense
- wall defense
- base defense
- victory/failure outcomes
- wall chip logic

### 9.5 Implement defender reward split
- equal split across nonzero defenders
- overflow burn

### 9.6 Implement blueprint reward
- defended base receives blueprint fragment

### 9.7 Implement cleanup on target death
- clear defender registry for dead target
- reset affected defenders to waiting

**Definition of done**
- bandit event can fully play out onchain and affect real game state

**Cut line:** if needed, blueprint reward can be stubbed first, but the attack loop must work.

---

## Phase 10 — winter and elimination

### 10.1 Implement winter schedule
- first winter at tick 110
- duration 10 ticks
- repeated cadence

### 10.2 Implement winter upkeep
- doubled food upkeep
- wood burn

### 10.3 Implement cold damage
- accumulation
- wall degradation
- clansman deaths once walls are zero
- reset at winter end

### 10.4 Implement crop winter transitions
- clear plots
- lock during winter
- restart regrow after winter

### 10.5 Implement clan death
- set dead state
- burn physical vault loot
- preserve dead-clan restrictions

**Definition of done**
- winter can kill clans and end runs

**Cut line:** this entire phase is the first major system you can defer if the core loop already works and deadline is near.

---

## Phase 11 — season end, ranking, and payout

### 11.1 Implement season clock
- fixed tick horizon
- approximately 3 winters
- no instant first-to-10 season end

### 11.2 Implement rank computation
By:
1. monument level
2. earliest tick reaching level
3. vault loot value
4. wall level

### 11.3 Implement finalize season
- deterministic completion
- payout routing if included
- freeze or archive state

### 11.4 Implement prize pot if time allows
- mint revenue split
- prize pot accounting
- payout distribution

**Definition of done**
- season can end deterministically
- winners can be identified

**Cut line:** prize payout routing is cuttable; ranking/finalization is not.

---

## Phase 12 — agent harness and demo loop

### 12.1 Define minimal Elder read bundle
Bundle the minimum data the agent needs:
- world state
- own clan derived state
- own workers derived state
- current bandit preview
- maybe market preview

### 12.2 Define minimal Elder write surface
Probably:
- `submitClanOrders`
- OTC transfer calls

### 12.3 Build simple agent loop
- read
- reason
- submit orders
- log results

### 12.4 Demo scenarios
Prepare these explicit scenarios:
1. spawn clan
2. gather + deposit
3. trade in Unicorn Town
4. bandit camp + defense
5. wall/base/monument upgrade
6. optional winter hardship

**Definition of done**
- the system can be shown, not just compiled

**Cut line:** rich prompt engineering and personality work are optional; functional loop is the priority.

---

# Cut hierarchy summary

## Absolutely must ship
- mint/spawn
- missions
- lazy settlement
- heartbeat
- resources
- deposits
- Unicorn Town trades
- bandit loop
- upgrades
- ranking basics

## Strongly preferred
- OTC transfer surface
- immediate market actions
- blueprint gating
- season finalization

## First large cut if behind
- winter

## First polish cuts
- prize routing
- extra getters
- extra events
- bundle transfers
- replay niceties
- advanced UI

---

# Suggested implementation order if time is brutal

If you need the shortest viable path:

1. repo + skeleton  
2. spawn  
3. missions  
4. lazy settlement  
5. heartbeat  
6. gather/deposit  
7. market sell/buy  
8. bandits  
9. wall/base/monument  
10. ranking  
11. OTC  
12. winter  
13. prize payout

That gives you the best odds of having a working submission even if later phases are incomplete.

---

# Final principle

At every phase boundary, ask:

**Can I already produce a convincing demo clip from what exists?**

If yes, protect that core loop before expanding sideways.
