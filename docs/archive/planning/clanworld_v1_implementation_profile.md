# Clanworld — v1 Implementation Profile

This document defines the intended **implementation profile** for the first working build of Clanworld.
It is not a design brainstorm document. It is a scope-control document.

The purpose is to keep implementation aligned with the actual hackathon goal:
**ship a working, legible, demoable autonomous-agent strategy game with real onchain state transitions and real market interaction.**

---

## 1. Primary objective

The v1 objective is:

- one small shared world
- a small number of clans
- agent-driven mission assignment
- deterministic heartbeat-driven world progression
- visible resource gathering and trading
- visible bandit pressure
- visible base/monument progression
- a coherent playable loop that is stable enough for demo

v1 is **not** trying to solve:
- production MMO scaling
- perfect anti-MEV fairness
- generalized open modding
- trustless OTC escrow
- fully decentralized offchain simulation replacement
- long-term live-service retention design

---

## 2. Target realm size

v1 targets:

- **4 active clans ideal**
- **up to ~8 clans comfortable**
- **~12 clans possible upper bound for testing/demo**
- anything beyond that is explicitly out of scope for v1

This realm size assumption informs:
- heartbeat gas expectations
- eager-settlement cost
- bandit targeting strategy
- message volume
- UI complexity
- demo legibility

---

## 3. Canonical architectural decisions

The following are locked for v1.

### 3.1 Canonical accounting
Canonical source of truth is **internal game accounting**, not ERC20 wallet balances.

Canonical internal balances:
- clan vault resources
- clan purse balances
- worker carry balances

ERC20s exist at the **market / payout boundary**, not as the canonical live game-state store.

### 3.2 Heartbeat model
- heartbeat is **permissionless**
- one heartbeat advances **one tick**
- heartbeat interval target is **60 seconds**
- heartbeat derives randomness internally from onchain sources
- heartbeat does **not** take caller-supplied randomness

### 3.3 Tick model
- the world runs on a discrete global tick counter
- cooldown is **real-time 60 seconds**, intentionally not purely tick-based
- missing a tick window due to timing is allowed behavior in v1

### 3.4 Mission model
- one active mission per worker
- mission shape is `(gotoRegion, action, params)`
- same-region / noop actions bypass travel
- all completed missions end in `WAITING`
- `defend_base` persists until interrupted
- interruption overwrites the active mission slot

### 3.5 Settlement model
- isolated progression can be lazily settled
- world-contact events must be eagerly settled
- market actions are heartbeat-eager, not lazy
- bandit attacks are heartbeat-eager
- clans touched by a world event are forcibly settled to the relevant tick

### 3.6 Market execution model
Two modes exist:

**Immediate market actions**
- worker already in Unicorn Town
- worker in `WAITING`
- worker off cooldown
- executes immediately in Elder tx

**Scheduled market actions**
- travel first
- one action tick
- executes at heartbeat closing the action tick

Immediate actions can front-run scheduled actions in the same tick.

### 3.7 Buy/sell asymmetry
- `market_sell` = exact input, from worker carry to clan gold purse
- `market_buy` = exact output with `maxGoldIn`, from clan gold purse to worker carry

### 3.8 OTC model
OTC transfers are:
- direct internal ledger transfers
- no escrow in v1
- no courier mechanics in v1
- no settlement guarantees beyond explicit transfer calls

### 3.9 Defender registry
Active defenders are explicitly indexed by defended base.
Heartbeat does not discover mercenaries by scanning all clans.

### 3.10 Dead clan policy
When a clan dies:
- clan state becomes `DEAD`
- physical vault loot is burned
- dead clan cannot send OTC transfers
- no ruin salvage exists in v1

---

## 4. Gameplay systems included in v1

The following systems are in scope for the first real working build.

### 4.1 World and movement
- 8 logical regions
- canonical route table
- travel timing
- derived region progression
- no onchain pathfinding

### 4.2 Clan lifecycle
- clan mint / spawn
- base assignment
- initial workers
- initial vault resources
- initial gold
- base / wall / monument starting levels

### 4.3 Resources
- wood
- iron
- wheat
- fish
- gold
- blueprint fragments

### 4.4 Worker actions
- chop wood
- mine iron
- fish docks
- fish deep sea
- harvest wheat
- deposit resources
- build wall
- upgrade base
- upgrade monument
- defend base
- market buy
- market sell
- wait

### 4.5 Markets
- Unicorn Town
- seeded pools
- scheduled and immediate market actions
- exact-input sells
- exact-output buys
- FIFO scheduled execution

### 4.6 Bandits
- spawn
- camp warning
- target selection
- eager-settle region target candidates
- deterministic attack resolution
- defender loot split
- blueprint reward

### 4.7 Seasoning / competition
- season clock
- season end
- monument ranking
- prize pot accounting if feasible

---

## 5. Systems that are intentionally simplified in v1

### 5.1 Trust and cooperation
- no escrow
- no mercenary contract primitive
- no guaranteed cooperation enforcement
- betrayal is allowed and expected

### 5.2 Scale
- no multi-realm sharding
- no federation routing
- no large-population balancing
- no attempt to support hundreds of clans in one realm

### 5.3 Market safety
- no slippage floor on sells
- buy protection only via `maxGoldIn`
- no attempt to eliminate adversarial front-running
- market transparency is a feature

### 5.4 Resource realism
- gold is magical purse balance
- carried resources and vault resources are distinct domains
- only vault contents count for upkeep/building/winter
- no per-item durability system in v1 unless added later

---

## 6. Systems that should be cut first if schedule slips

These are the first things to de-prioritize if implementation time starts hurting.

### 6.1 First cuts
- prize pot payout routing
- season finalization payout polish
- nonessential derived getters
- extra events beyond the most important ones
- advanced OTC convenience batching
- rich telemetry / analytics

### 6.2 Second cuts
- winter
- blueprint gating above monument level 6
- immediate market actions
- rich public/private message UI
- deep event replay tooling

### 6.3 Last cuts before project identity breaks
Do **not** cut these unless the game is being radically simplified:
- heartbeat
- missions
- internal accounting
- Unicorn Town market
- bandits
- base/wall/monument progression
- worker carry + vault split

If those are cut, the project stops being Clanworld.

---

## 7. Recommended implementation milestones

### Milestone A — world loop alive
Goal:
- world tick advances
- clan spawns
- workers can gather
- vault updates work
- agents can send missions

### Milestone B — market alive
Goal:
- worker travels to Unicorn Town
- sell and buy paths work
- gold balance changes correctly
- immediate and scheduled execution semantics are proven

### Milestone C — conflict alive
Goal:
- bandit spawn
- camp warning
- target selection
- deterministic defense
- loot split
- wall damage
- blueprint reward

### Milestone D — progression alive
Goal:
- build walls
- upgrade base
- upgrade monument
- season ranking visible

### Milestone E — hardship alive
Goal:
- starvation
- winter
- cold damage
- elimination

Milestone E is the first acceptable deferral if time becomes tight.

---

## 8. Demo definition of done

v1 is successful if the demo can show:

1. a clan spawn
2. a worker sent to gather
3. gathered resources becoming useful
4. a Unicorn Town trade
5. bandits threatening a base
6. a successful or failed defense
7. a meaningful upgrade to wall/base/monument
8. clear scoreboard / progression pressure

If those eight moments work, the project is strong enough for a hackathon demo even if some secondary systems are still rough.

---

## 9. Non-goals for v1

v1 is not trying to prove:
- perfect economic balance
- fully autonomous agent excellence
- anti-cheat hardening
- production-grade liveness guarantees
- future-proof schema for every expansion idea

It is trying to prove:
- the game loop is coherent
- the agent control model is legible
- the onchain/offchain boundary is sane
- emergent strategy is visible

---

## 10. Guiding principle

When in doubt, prefer:
- deterministic over clever
- explicit over magical
- auditable over elegant
- small and working over broad and half-working

If a feature does not improve the core demo loop, it is a candidate for deferral.
