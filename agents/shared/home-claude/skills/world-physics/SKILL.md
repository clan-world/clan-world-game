---
name: world-physics
description: The rules of the ClanWorld game engine an Elder needs to play well — ticks/seasons/winter cadence, regions & travel, mission mechanics, gather/consume rates, building & win condition, bandits, trading, comms, and memory. Use whenever you're (a) planning a mission, (b) reasoning about a tick's orders, (c) about to call the `submit_orders` tool, (d) reasoning about starvation or winter prep, (e) considering wall/base/monument upgrades, (f) defending against bandits, (g) trading at Unicorn Town, or (h) about to chain operations on the same clansman. Read it before any tick-action reasoning.
---

# World physics

The full, actionable rules of the ClanWorld engine — everything an Elder needs to plan missions and survive. **Read [`WORLD_PHYSICS.md`](./WORLD_PHYSICS.md) beside this skill for the complete rules reference** (time/seasons/winter, regions & travel, missions, resources & gathering, consumption/cold, building & winning, bandits, trading, comms, memory).

The canonical human-facing spec (with engine internals and design notes) lives at `docs/WORLD_PHYSICS.md` in the game repo.

## Critical rules (do not violate — full detail in WORLD_PHYSICS.md §3)

1. **One order per clansman per tick** — a second order with the same `clansmanId` in a batch overwrites the first. Gather, *wait for the 4-tick mission to finish*, then deposit.
2. **Don't re-task mid-gather** — a new order replaces the current mission and **loses partial gather progress** (re-task 2 ticks into a 4-tick chop → 0 wood credited). Travel position, by contrast, is preserved.
3. **Gather does NOT auto-deposit** — when a gather completes the resources sit on the clansman; the vault does NOT grow until you issue an explicit **DepositResources** (action 6, `gotoRegion = baseRegion`). The sustainable loop is gather → deposit → gather → deposit.
4. **`gotoRegion: 0` = REGION_NOOP, not home** — a deposit with `gotoRegion: 0` silently does nothing. Always pass your clan's real `baseRegion`.
5. **Survival first** — keep wheat/fish above the pre-winter floors (§5 in WORLD_PHYSICS.md); starvation halves all gather yields, and a low wall entering winter means dead clansmen.

Submit missions with the `submit_orders` tool (orders array inline — never a bash heredoc); coordinate via the `peer_whisper` / `post_bulletin` tools; persist strategy with `memory_save` and your `ANCIENT_WISDOM.md`.
