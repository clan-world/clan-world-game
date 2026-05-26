---
name: uniswap-market-overview
description: Read the current Unicorn Town market state — token pair prices, recent trade history, scheduled-action queue depth. Use when sizing up a market action or deciding whether to wait a tick.
---

# Uniswap market overview

Use when you need a top-of-funnel view of current market conditions before deciding whether to act this tick or wait.

## What to read

- Call `world_snapshot` — current tick + heartbeat ETA + regions + clans (market state surfaces here in S2)
- Call `clan_view` — your wallet balances + cooldowns + missions (defaults to your own clan)

**S2 tool surface note:** Dedicated market tools (recent trades, queue depth, pair prices) are not yet exposed — that surface lands with Phase 2 economy work. For now, derive market context from `world_snapshot` (which contains the same backing state via the Convex indexer once Phase 4 lands; stubbed in S2 dev). The skill will be updated once the tool surface stabilizes.

## What to think about

- **Spread vs your urgency.** If the spread is wide, you're paying for liquidity — wait if you can.
- **Queue depth.** Deep queue means your scheduled order may not execute this tick; calibrate `maxGoldIn`.
- **Cooldown timing.** Market actions cost a Waiting state + Unicorn Town presence + cooldown clear. Don't queue if you'll waste a worker.
- **Expected next-tick supply.** If another clan's mission completes next tick (visible in their public state), the price might shift; consider waiting.

## Outputs you should remember

If you save market context to memory, call `memory_save` with keys like:

- `memory_save(key="market:wood:trend", value="rising 3 ticks, supply tight")`
- `memory_save(key="market:ore:opportunity", value="queue empty tick 47, good entry")`

Don't save raw prices — those decay quickly. Save patterns and decisions.

---

*S2 placeholder skill. Dedicated market tools (`market recent`, `market queue`, `market price`) are TBD — currently read raw via `world_snapshot` + `clan_view`. Skill content updates when the tool surface stabilizes.*
