# ClanWorld Spec v4.1 Addendum

This addendum locks several implementation-facing decisions that were already intended by the design but were not stated explicitly enough in prior versions of the spec.

These clarifications are normative for v4.

---

## A1. World tick heartbeat interval

The target world heartbeat cadence is **60 seconds per tick**.

Notes:
- The heartbeat is intended to run approximately once every 60 seconds.
- Minor variance of a few seconds is acceptable due to keeper / transaction timing.
- World logic remains tick-based; slight real-time drift does not change rules semantics.

---

## A2. First winter timing

The first winter begins at **tick 110**.

Thereafter, winter begins every 110 ticks:
- tick 110
- tick 220
- tick 330
- and so on

Each winter lasts **10 ticks**, as already specified in v4.

---

## A3. Bandit movement duration between regions

Bandit movement between adjacent outer-ring regions takes **0 additional ticks**.

Bandit lifecycle between attacks is:
1. complete attack attempt or noop in current region
2. enter `RESTING` for 2 ticks
3. after rest completes, move immediately to the next clockwise region
4. resolve next target selection / attack logic there

UI may visually animate movement during or after rest, but from the game-engine perspective movement itself consumes no extra tick beyond the 2-tick rest window.

---

## A4. Eager-settle scope for bandit target selection

Before bandit target selection is computed in a region, **all clans with homebases in the bandit's current region must be eagerly settled to that tick**.

This requirement exists because bandit targeting depends on each base's current vault loot-value, and accurate loot-value requires up-to-date clan settlement.

Therefore:
- target selection is not based only on the eventually selected base
- target selection is computed only after all candidate bases in the current region have been eagerly settled
- this is in addition to settling any external defender clans that physically contribute to the eventual defense event

---

## A5. Mission interruption and cooldown semantics

**Every successful mission submission starts cooldown**, including an interruption/replacement of a currently active mission.

This includes:
- normal mission assignment
- mission replacement while traveling
- mission replacement while acting
- immediate market action missions submitted while already in Unicorn Town

If a new mission submission succeeds:
- the clansman is settled to current tick
- prior mission progress through the current tick is preserved
- the old mission is replaced
- cooldown starts immediately from that successful submission

Unsuccessful / rejected mission submissions do **not** start cooldown.

---

## A6. Just-in-time winter logistics are intentionally punitive

The per-tick local settlement order remains:
1. apply clan upkeep for the tick
2. update starvation status for the next tick if shortages occur
3. advance travel
4. resolve continuous actions
5. apply single-tick action effects
6. check terminal conditions

This means that during winter:
- if a base begins a tick with `0` wood in vault,
- and a clansman arrives that same tick carrying wood,
- and that wood is deposited later in step 5,

then the base **still takes the winter wood-burn failure / cold-damage consequence for that tick**.

This is intentional.

Implication:
- carried resources do not save a base from upkeep until they are actually deposited
- just-in-time logistics are risky by design
- players are expected to maintain a real vault buffer rather than rely on same-tick rescue deliveries

---

## A7. Market action input mode

> **[PATCHED 2026-04-26]** The original text of this section incorrectly stated that all v1 market actions are Exact Input. `market_buy` is Exact Output, not Exact Input. The corrected text is below. Authoritative source: `clanworld_v4_2_state_schema_interface_spec.md §8.4` and `IClanWorld.sol`.

### `market_sell`
`market_sell` is **Exact Input**.
- `marketAmount` = exact amount of resource token to sell
- gold output is whatever the AMM returns at execution time
- no `minOut` guard in v1

### `market_buy`
`market_buy` is **Exact Output**.
- `marketAmount` = exact amount of resource to receive
- `maxGoldIn` = max purse gold willing to spend (slippage guard)
- buy fails if required gold at execution time exceeds `maxGoldIn`
- buy fails if clan purse lacks sufficient gold at execution time

---

## A8. Immediate vs scheduled market execution ordering

This addendum reaffirms the intended ordering rule:

### Immediate market actions
If a clansman is:
- physically in Unicorn Town,
- in `WAITING` state,
- and not on cooldown,

then an Elder may submit a market mission that executes **immediately in that tx**.

Immediate actions execute against the current AMM pool state at tx execution time.

### Scheduled market actions
If a market mission requires travel or action-tick maturation, it executes later at the heartbeat that closes its action tick.

Scheduled market actions execute:
- eagerly at heartbeat close
- in FIFO order by mission commit order

### Collision rule
An immediate market action during tick `T` can front-run scheduled market actions that will execute at the close of tick `T`.

This is intentional and part of the adversarial market design.

---

## A9. Starving mercenaries are intentional

If a clansman from Clan A is defending Clan B's base, and Clan A enters starvation, that defending clansman contributes **0 defense** while starvation is active, even though they are physically present at Clan B's base.

This is intentional and follows the existing rule that starvation reduces all clansmen defense contribution to zero.

Implication:
- mercenary reliability depends on the mercenary clan's own home economy
- Elders may need to monitor not only where mercenaries are, but whether their home clan is still fed

---

## A10. No change to summer starvation lethality

Starvation outside winter does **not** directly kill clansmen.

While starving outside winter:
- gathering output is reduced by 50%
- defense contribution becomes 0

Clansman death from deprivation occurs only through the winter cold-damage / wall-collapse pathway already specified in v4.

This is intentional for v1 to avoid excessively punishing early-game elimination.

---

## A11. No change to equal defender loot split

When bandits are defeated and loot is dropped, the dropped portion is split **equally among all defending clansmen with nonzero defense contribution**, regardless of whether each qualifying defender contributed:
- 10 defense via `defend_base`, or
- 5 defense via `WAITING` at their own homebase

This equality rule is intentional for v1.

---

## A12. Status of this addendum

This addendum is part of the authoritative v4 ruleset.

Where any ambiguity exists between prior wording and this addendum, **this addendum controls**.
