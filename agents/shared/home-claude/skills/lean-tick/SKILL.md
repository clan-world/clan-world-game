---
name: lean-tick
description: The canonical lean per-tick procedure for an Elder. 3 commands max — recall, snapshot (or skip if pre-fetched), submit. Use on every normal TICK N Started message. Bypass for memory-wipe/final-tick/crisis ticks.
---

# Lean tick — your default per-tick routine

The runner gives you ~60 seconds between ticks. If you spend 5+ minutes deliberating, you fall behind. This skill is your default response to a plain `TICK N Started` marker.

## When to invoke

- You received a plain `TICK N Started` marker (no warning, no FINAL TICK, no pre-fetched state)
- OR you received a tick with `# Pre-fetched state` — same flow, just skip step 2

## Do NOT invoke when

- The tick is T49 (MEMORY-WIPE WARNING) or T50 (FINAL TICK) — use `final-tick-continuity` instead.
- A bandit attack is imminent (your peer inbox or world snapshot shows a tier ≥3 bandit in your region or adjacent).
- Your last order batch failed unexpectedly — investigate first.

## The 3-command flow

### Step 1: recall ONE memory key

```bash
elder memory recall active-strategy
```

This pulls forward your most recent saved plan. **Do NOT recall additional keys** (grudges, clan-priors, active-trades, etc) — they're rarely actionable on a single tick and burn tokens.

### Step 2: refresh state — OR SKIP if pre-fetched

If the tick block contains a `# Pre-fetched state` section listing your clan's vault/clansmen/region, **skip this step entirely** — trust the embedded state.

Otherwise:

```bash
elder world snapshot
```

That returns the full WorldSnapshot including your clan's clansmen, vault, missions, and the current tick. Read the JSON, find your clan in the `clans` array. **DO NOT also run `elder clan view <clanId>`** — it's sparse (returns only treasury) and the snapshot has everything you need.

### Step 3: decide + submit

Look at:
- Each clansman's `currentRegion` and `state` (3=Waiting means idle)
- Vault levels vs caps (wood 15, iron 5, wheat 40, fish 8)
- Wheat upkeep is 4 per tick at 4 clansmen — vault wheat ÷ 4 = ticks of food buffer
- Winter window (winter starts at tick `seasonStartTick + 110`, lasts 10 ticks; consumes 2x food + wood)

Write `/tmp/orders_<tick>.json` — **ONE order per clansman**:

```json
{
  "clanId": "1",
  "orders": [
    { "kind": "mission", "payload": { "clansmanId": 1, "gotoRegion": 4, "action": 5 } },
    { "kind": "mission", "payload": { "clansmanId": 2, "gotoRegion": 5, "action": 5 } },
    { "kind": "mission", "payload": { "clansmanId": 3, "gotoRegion": 1, "action": 1 } },
    { "kind": "mission", "payload": { "clansmanId": 4, "gotoRegion": 2, "action": 2 } }
  ]
}
```

**🚨 CRITICAL — ONE mission per clansman per tick 🚨**. Each order REPLACES that clansman's active mission. Chaining gather+deposit for the same clansman in one batch causes the deposit to overwrite the gather — the clansman ends up in Deposit mode with empty carry. Always submit a single mission per clansman, then wait for the runner's NEXT tick to dispatch the follow-up.

**Deposit target region**: for `DepositResources` (action 6), `gotoRegion` MUST be your clan's home base region (read `baseRegion` from clan state). **Do NOT use `gotoRegion: 0`** — region 0 is REGION_NOOP and a deposit fired there silently does nothing.

**Follow-up cycle**: when you see a clansman's carry near-full on a future tick (e.g. `carryWood >= 8` of cap 10), dispatch a single `DepositResources` order to `gotoRegion: <baseRegion>, action: 6`. After they deposit (1 tick), they're idle again — dispatch next gather.

```bash
elder clan submit-orders /tmp/orders_<tick>.json
```

### Step 4 (only if plan changed): save updated strategy

If you changed your plan (different clansman assignment, new priorities), save:

```bash
elder memory save active-strategy "Tick N: CM1=<plan>, CM2=<plan>, CM3=<plan>, CM4=<plan>. <reasoning>."
```

Otherwise skip — your previous active-strategy is fine.

## Token budget

A disciplined lean tick costs ~3-5k tokens and 1-2 minutes wall-clock. If you're at 5k+ tokens halfway through, you're over-investigating. Stop, commit to a reasonable plan from what you have, submit.

## Conflict between memory and snapshot

If `active-strategy` says clan is alive with full vault but `world snapshot` says clan is dead with empty vault (or vice versa), the snapshot is **probably stale** — Convex indexer can lag the chain by hundreds of ticks. **Trust the more-recent timestamp.** If both seem stale, just act on what makes sense given the saved plan, and add a note to `active-strategy` flagging the conflict so future-you can investigate.

Do NOT cat tool-result files or run python parsers to investigate conflicts. That's the expensive failure mode. Commit to a plan within 2 minutes of the tick arriving.

## Anti-patterns

- ❌ Recalling 5+ memory keys per tick
- ❌ Running `elder world snapshot` + `elder clan view <N>` together
- ❌ Browsing `elder peer inbox` on every tick (only when threats indicated)
- ❌ Running `date` or other diagnostic commands
- ❌ Parsing tool-result files with python — read the snapshot directly
- ❌ "Almost done thinking" loops past 3 minutes
