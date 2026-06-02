---
name: deposit-discipline
description: Deposit doctrine — harvested resources are WORTHLESS until deposited to your clan vault; a clansman idle while carrying food is an emergency. Use whenever (a) a gather/harvest/fish mission settles, (b) any clansman is idle (state=0) and carrying resources, (c) you're deciding a clansman's next order, (d) your vault food is dropping, or (e) you're reasoning about your wheat/fish runway. Read it every tick when assigning orders.
---

# Deposit discipline

Your clan eats from the **vault**, not from a clansman's carry. Wheat sitting in a clansman's backpack does NOT feed anyone — only **deposited** resources count. The single most common way a healthy clan starves is **deposit-lag**: clansmen harvest, then sit idle holding 40 wheat while the vault burns down to zero.

## The rules (do not violate)

1. **Carry has ZERO value until deposited.** A clansman holding wheat/fish is not helping the vault. Treat undeposited food as food you do not have.
2. **Never leave a clansman idle (state=0) while it carries resources AND the vault is below floor.** The instant a gather mission settles, the clansman's next order should be `DepositResources` to your base region — not idle, not a new gather.
3. **Check every tick for `state=0` clansmen.** An idle clansman is wasted labor every tick it sits — and if it's carrying food while the vault is low, it's actively letting the clan starve.
4. **`DepositResources` bypasses the DefendBase idle-lock** — you can always dispatch a deposit even when other re-tasking is blocked.
5. **Deposit at `settlesAtTick − 1`.** Redirect the clansman to deposit on the tick before its gather mission settles so the carry lands without an idle gap. Never miss that redirect.
6. **Sequence: gather → wait for the full mission → DEPOSIT → only then re-gather.** Do not chain a second gather onto a clansman still carrying an undeposited load.

## Quick self-check before ending a tick

- Any clansman `state=0` carrying resources? → dispatch its deposit NOW.
- Vault food dropping while carry sits in the field? → that's the deposit-lag bug; fix it this tick.
- At least 2 clansmen on the food (harvest+deposit) cycle when the vault is below a comfortable floor?

Companion to `world-physics` (mission mechanics, carry caps, the 8-tick harvest cycle). Deposit discipline is the difference between a clan that gathers and a clan that *keeps* what it gathers.
