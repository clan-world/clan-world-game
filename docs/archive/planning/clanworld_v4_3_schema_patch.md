# Clanworld v4.3 Schema Patch

This patch applies to `clanworld_v4_2_state_schema_interface_spec.md` and locks the remaining schema/interface clarifications before Solidity implementation.

---

## A. Same-Region / NOOP Mission Semantics

### A.1 No-travel bypass
If a mission is submitted with:
- `gotoRegion == currentRegion`, or
- `gotoRegion == NOOP_REGION`

then the mission **does not enter a Traveling state**.

Rules:
- `travelTicks = 0`
- worker remains in `WAITING` until the action executes
- no zero-tick traveling transition is created
- no `WorkerArrived` event is required for same-region / noop travel bypass

### A.2 Immediate action interaction
For immediate market actions:
- same-region / noop bypass is required
- worker must already be:
  - in `UnicornTown`
  - in `WAITING`
  - off cooldown
- action executes in the Elder tx itself

### A.3 Same-region scheduled actions
For non-immediate same-region actions:
- action phase begins in the **current tick**
- `actionStartTick = startTick`

---

## B. Mission Storage Cardinality

### B.1 Exactly one active mission per clansman
The canonical storage model is:

- `mapping(uint32 => Clansman) clansmen`
- `mapping(uint32 => Mission) activeMissionByClansman`

There is **exactly one active mission slot per clansman**.

### B.2 Overwrite semantics
When a new valid mission is assigned:
- the prior active mission is overwritten
- no onchain mission history is retained in storage
- historical reconstruction is done from emitted events, not retained mission slots

### B.3 Mission nonce naming
The following naming is canonical:

- `Clansman.lastMissionNonce`
- `Mission.nonce`

Invariant:
- whenever a mission is successfully assigned,
  `Mission.nonce == Clansman.lastMissionNonce`

---

## C. `actionStartTick` Semantics

### C.1 Meaning
`Mission.actionStartTick` means:

> the tick at which the **current active mission's action phase** begins.

### C.2 Initial value
For a newly assigned mission:
- `arrivalTick = startTick + travelTicks`
- `actionStartTick = arrivalTick`

For same-region / noop missions:
- `arrivalTick = startTick`
- `actionStartTick = startTick`

### C.3 No resume semantics
Missions do not pause and resume.

If a mission is interrupted:
- old mission is discarded
- new mission gets a new nonce
- new mission gets a new `actionStartTick`

Therefore `actionStartTick` never refers to "most recent resumed action"; it always refers to the current active mission only.

---

## D. Scheduled Market Action Storage

### D.1 Canonical storage layout
Scheduled market actions are stored as:

`mapping(uint64 => ScheduledMarketAction[]) scheduledMarketActionsByTick`

Key:
- `executeAtTick`

Value:
- append-only FIFO array for that tick

### D.2 FIFO ordering
Within a given `executeAtTick`, scheduled market actions execute in:
1. ascending append order in `scheduledMarketActionsByTick[executeAtTick]`
2. equivalently, ascending global `commitSequence`

### D.3 Heartbeat cleanup
When heartbeat closes tick `T`:
- iterate `scheduledMarketActionsByTick[T]`
- execute each action in FIFO order
- emit success/failure events
- delete `scheduledMarketActionsByTick[T]` after processing

### D.4 Global `commitSequence`
`nextCommitSequence` is:
- global
- monotonically increasing
- never reset across seasons in v1

---

## E. Domain-Separated RNG Derivation

### E.1 Tick seed source
Heartbeat must not accept caller-supplied randomness.

Canonical tick seed derivation remains internal/onchain.

### E.2 Domain separation
Distinct game randomness uses domain-separated derivations from the current tick seed.

Recommended examples:

- `keccak256(abi.encode("bandit_spawn", currentTickSeed))`
- `keccak256(abi.encode("bandit_spawn_region", currentTickSeed))`
- `keccak256(abi.encode("wood_crit", currentTickSeed, clansmanId, missionNonce, tick))`
- `keccak256(abi.encode("iron_gold_bonus", currentTickSeed, clansmanId, missionNonce, tick))`
- `keccak256(abi.encode("fish_roll", currentTickSeed, clansmanId, missionNonce, tick))`

### E.3 Bandit spawn region
Bandit spawn region selection must use a domain-separated RNG derivation and must not reuse the same undifferentiated seed bytes as other unrelated rolls in the same tick.

---

## F. Active Defender Registry Cleanup

### F.1 Existing requirement
Defenders are explicitly tracked in:
- `activeDefendersByBase[targetClanId]`
- `defendingBaseOfClansman[clansmanId]`
- swap-pop helper index tracking

### F.2 Cleanup when defending worker leaves
Already required:
- interrupting / replacing defense mission removes worker from registry
- worker death removes worker from registry

### F.3 Cleanup when defended clan dies
When a target clan transitions to `DEAD`:
- read `activeDefendersByBase[targetClanId]`
- for every listed defender:
  - set `defendingBaseOfClansman[clansmanId] = 0`
  - transition mission/state to `WAITING`
- delete `activeDefendersByBase[targetClanId]`

This prevents orphaned defenders from remaining assigned to a nonexistent base.

---

## G. Bandit Tier vs Attack Power Canonical Source

### G.1 Canonical source
`BanditTroop.tier` is canonical.

`attackPower` is **derived**, not independently authoritative.

### G.2 Derivation
Attack power is computed from tier using the locked bandit attack table / helper:

`attackPower = getBanditAttackPower(tier)`

### G.3 No dual-source ambiguity
If both `tier` and `attackPower` are present in an implementation struct for convenience, `tier` remains the source of truth and `attackPower` must be treated as cached/derived.

---

## H. Loot Value Getter Split

### H.1 Two getter flavors
The schema exposes two distinct loot value getters:

- `quoteLootValueRaw(clanId)`
- `quoteLootValueSettled(clanId)`

### H.2 Raw getter
`quoteLootValueRaw(clanId)`:
- reads currently committed vault balances only
- does not lazily simulate settlement
- intended for lightweight UI/debug usage

### H.3 Settled getter
`quoteLootValueSettled(clanId)`:
- simulates or uses settled-to-current-tick state
- intended for target preview / strategic reasoning
- bandit targeting semantics conceptually align with the settled value path

---

## I. Clan ID Sentinel

### I.1 Null sentinel
`clanId = 0` is reserved as the null / unset sentinel.

### I.2 Valid clan IDs
Valid live clan IDs begin at `1`.

### I.3 Related fields
Any field such as:
- `targetClanId`
- `defendingBaseOfClansman`
- preview outputs

may use `0` to mean "unset / none / not applicable."

---

## J. Derived Getter Non-Mutation Rule

### J.1 Non-mutation invariant
All derived getters are read-only simulations.

They:
- must not mutate storage
- must not update settlement checkpoints
- must not write cached flags
- must not delete queues

### J.2 Canonical writers
Only state-changing execution paths may mutate canonical state, including:
- `submitClanOrders`
- `heartbeat`
- explicit state-mutating admin/season functions
- explicit transfer functions

### J.3 Implication
Any "settled" view in the interface spec is a simulated view and not a state write.

---

## K. Additional Constants and Error Codes

### K.1 Add constants
The schema/interface constants section should include:

- `HEARTBEAT_INTERVAL_SECONDS = 60`
- `WINTER_UPKEEP_MULTIPLIER_BPS = 20000`
- `WHEAT_PLOT_REGROW_TICKS = 4`
- `WHEAT_PLOT_STARTING_WHEAT = 100e18`

Bandit power should be exposed either as:
- explicit constants per tier, or
- a documented helper/library function

### K.2 Add status codes
Add at minimum:

- `ERR_NOT_ENOUGH_GOLD`
- `ERR_CARRY_FULL`

`ERR_CARRY_FULL` is especially relevant for explicit market buy validation and any direct action that is rejected because requested output cannot fit remaining carry capacity.

---

## L. Starvation Cached Flag Cleanup

### L.1 Canonical recommendation
If both:
- `starvationStartsAtTick`
- `starvingCached`

exist, remove `starvingCached` in favor of deriving starvation from canonical state.

### L.2 Preferred model
Use:
- settlement checkpoint data
- `starvationStartsAtTick`
- current tick context

rather than redundant cached boolean state when avoidable.

---

## M. Dead Clan OTC Restriction (explicit restatement)

### M.1 Dead sender restriction
All OTC transfer entrypoints must require sender clan state == `ACTIVE`:

- `transferGold`
- `transferVaultResource`
- `transferBlueprint`
- `transferBundle`

Dead clans may not initiate outbound value transfer.

---

## N. Implementation Notes (Non-blocking)

### N.1 Heartbeat gas exposure
Heartbeat remains permissionless in v1.

Worst-case heartbeat cost includes:
- scheduled market execution
- eager settlement of touched clans
- world event resolution
- winter transition checks
- season end checks

This is acceptable for the intended v1 realm size (~4–12 clans). Larger scales require sharding/batching and are out of scope for v1.

### N.2 `quoteTravel(src, src)`
For completeness:
- `quoteTravel(src, src)` returns `travelTicks = 0`
- path is effectively `[src]`
- actual same-region mission execution bypasses travel state per Section A above

### N.3 Path packing constraint
Any packed path encoding such as `bytes8` is valid only while maximum route length remains within that representation's capacity. Future map expansion must revisit this constraint.

---

## O. Locked summary

This patch locks the following:

- same-region / noop missions bypass travel
- exactly one active mission slot per clansman
- `actionStartTick` semantics for the active mission only
- scheduled market actions stored by `executeAtTick`
- global monotonic `commitSequence`
- domain-separated RNG derivation
- explicit cleanup of defenders when target clan dies
- `tier` as canonical bandit strength source
- split raw vs settled loot-value getters
- `clanId = 0` sentinel
- derived getters never mutate storage
- additional constants and error codes
- removal of redundant starvation cache where possible
- dead clans blocked from OTC transfers
