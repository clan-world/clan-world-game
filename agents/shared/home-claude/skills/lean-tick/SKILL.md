---
name: lean-tick
description: The canonical lean per-tick procedure for an Elder. 3 tool calls max — memory_recall, world_snapshot (or skip if pre-fetched), submit_orders. Use on every normal TICK N Started message. Bypass for memory-wipe/final-tick/crisis ticks.
---

# Lean tick — your default per-tick routine

The runner gives you ~60 seconds between ticks. If you spend 5+ minutes deliberating, you fall behind. This skill is your default response to a plain `TICK N Started` marker.

You drive the game entirely through the `elder` MCP tools (`world_snapshot`, `clan_view`, `submit_orders`, `memory_recall`, `memory_save`, `peer_whisper`, `peer_inbox`, `post_bulletin`, `ack_clear`, `rules`). Call them as tools — never via bash.

## When to invoke

- You received a plain `TICK N Started` marker (no warning, no FINAL TICK, no pre-fetched state)
- OR you received a tick with `# Pre-fetched state` — same flow, just skip step 2

## Do NOT invoke when

- The tick is T49 (MEMORY-WIPE WARNING) or T50 (FINAL TICK) — use `final-tick-continuity` instead.
- A bandit attack is imminent (your peer inbox or world snapshot shows a tier ≥3 bandit in your region or adjacent).
- Your last order batch failed unexpectedly — investigate first.

## The 3-command flow

### Step 1: recall ONE memory key

Call `memory_recall` with key `active-strategy`.

This pulls forward your most recent saved plan. **Do NOT recall additional keys** (`grudge:<clan>`, `trust:<clan>`, `pending-tx:<hash>`, etc) — they're rarely actionable on a single tick and burn tokens. (See the `memory-discipline` skill's HARD rules: at most one recall per tick.)

### Step 2: refresh state — OR SKIP if pre-fetched

If the tick block contains a `# Pre-fetched state` section listing your clan's vault/clansmen/region, **skip this step entirely** — trust the embedded state.

Otherwise, call `world_snapshot`.

That returns the full WorldSnapshot including your clan's clansmen, vault, missions, and the current tick. Read the JSON, find your clan in the `clans` array. **DO NOT also call `clan_view`** — it's sparse (returns only treasury) and the snapshot has everything you need.

### Step 3: decide + submit

Look at:
- Each clansman's `currentRegion` and `state` (3=Waiting means idle)
- Vault levels vs caps (wood 15, iron 5, wheat 40, fish 8)
- Wheat upkeep is 4 per tick at 4 clansmen — vault wheat ÷ 4 = ticks of food buffer
- Winter window (winter starts at tick `seasonStartTick + 110`, lasts 10 ticks; consumes 2x food + wood)

Build your orders array — **ONE order per clansman** — and pass it INLINE to the `submit_orders` tool. The array shape:

```json
[
  { "kind": "mission", "payload": { "clansmanId": 1, "gotoRegion": 4, "action": 5 } },
  { "kind": "mission", "payload": { "clansmanId": 2, "gotoRegion": 5, "action": 5 } },
  { "kind": "mission", "payload": { "clansmanId": 3, "gotoRegion": 1, "action": 1 } },
  { "kind": "mission", "payload": { "clansmanId": 4, "gotoRegion": 2, "action": 2 } }
]
```

**🚫 NEVER write orders to a file via bash `cat`/heredoc/`echo >`.** A brace-in-quotes shell construct trips a CC safety modal that freezes you mid-tick. Pass the orders array as the tool argument — no json file, no temp file, no `cat >`.

**🚨 CRITICAL — ONE mission per clansman per tick 🚨**. Each order REPLACES that clansman's active mission. Chaining gather+deposit for the same clansman in one batch causes the deposit to overwrite the gather — the clansman ends up in Deposit mode with empty carry. Always submit a single mission per clansman, then wait for the runner's NEXT tick to dispatch the follow-up.

**Deposit target region**: for `DepositResources` (action 6), `gotoRegion` MUST be your clan's home base region (read `baseRegion` from clan state). **Do NOT use `gotoRegion: 0`** — region 0 is REGION_NOOP and a deposit fired there silently does nothing.

**Follow-up cycle**: when you see a clansman's carry near-full on a future tick (e.g. `carryWood >= 8` of cap 10), dispatch a single `DepositResources` order to `gotoRegion: <baseRegion>, action: 6`. After they deposit (1 tick), they're idle again — dispatch next gather.

Submit by calling `submit_orders` with the orders array passed inline (the array above as the tool argument — `clanId` defaults to your own clan).

### Step 4 (only if plan changed): save updated strategy

If you changed your plan (different clansman assignment, new priorities), call `memory_save` with key `active-strategy` and value like:

```
Tick N: CM1=<plan>, CM2=<plan>, CM3=<plan>, CM4=<plan>. <reasoning>.
```

Otherwise skip — your previous active-strategy is fine.

## Token budget

A disciplined lean tick costs ~3-5k tokens and 1-2 minutes wall-clock. If you're at 5k+ tokens halfway through, you're over-investigating. Stop, commit to a reasonable plan from what you have, submit.

## Conflict between memory and snapshot

If `active-strategy` says clan is alive with full vault but `world snapshot` says clan is dead with empty vault (or vice versa), the snapshot is **probably stale** — Convex indexer can lag the chain by hundreds of ticks. **Trust the more-recent timestamp.** If both seem stale, just act on what makes sense given the saved plan, and add a note to `active-strategy` flagging the conflict so future-you can investigate.

Do NOT cat tool-result files or run python parsers to investigate conflicts. That's the expensive failure mode. Commit to a plan within 2 minutes of the tick arriving.

## Anti-patterns

- ❌ Recalling 5+ memory keys per tick
- ❌ Calling `world_snapshot` + `clan_view` together
- ❌ Browsing `peer_inbox` on every tick (only when threats indicated)
- ❌ Writing orders to a file via bash `cat`/heredoc/`echo >` (trips a CC safety modal — always pass orders inline to `submit_orders`)
- ❌ Running `date` or other diagnostic commands
- ❌ Parsing tool-result files with python — read the snapshot directly
- ❌ "Almost done thinking" loops past 3 minutes
