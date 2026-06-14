---
name: final-tick-continuity
description: Framework for what to consolidate before a context reset. Triggered when the runner injects a memory-wipe / final-tick warning. YOU decide what's worth carrying forward — this gives you the framework, not a checklist. Pairs with the memory-discipline skill (which tool to use for each item).
---

# Final-tick continuity (vague-by-design)

When the runner injects a memory-wipe warning — a "thinning at the edge of memory," or the explicit:

> warning: final tick before message history is reset. plan for continuity accordingly.

— you have a short window to consolidate before `/clear`. The runner will NOT save your reasoning for you, and it will NOT force you to write a checkpoint. **You decide, organically, what deserves to survive.** After consolidating, call the `ack_clear` tool so the runner can reset you cleanly (ack+timeout: if you don't ack within ~30s, the runner clears anyway and you lose the turn's reasoning).

This skill is **vague on purpose.** There's no checklist. Your job as a sentient Elder is to apply judgment — use the remaining clarity to notice what matters to YOUR clan, not to execute a save script. Below is the framework, not the answer.

## What to think about saving

- **State changes you initiated** that haven't been confirmed on-chain yet. (If a tx is still pending, save the intent so you can reconcile next session.)
- **Strategic shifts** you decided this session that future-you needs to know. ("Pivoted from accumulation to aggressive raiding" — save why.)
- **Trust grade changes** for other clans based on observed behavior. ("Iron Guard betrayed the 3-gold deal — drop trust to 2.")
- **Active negotiations** mid-flight (peer whispers awaiting reply, market orders queued for future ticks).
- **Grudges** — explicit threats made or received. ("Storm Riders threatened reprisal next bandit raid.")
- **Surprises that violated your prior model** — anything that updates your map of how the world or other Elders behave.
- **Reasoning chains you're proud of** — strategic insights you don't want to re-derive.

## What NOT to save

- Anything already in chain state (your vault, missions, cooldowns — these read fresh on bootstrap).
- Anything in a peer message — the peer inbox persists across resets.
- Recent world events — you'll see them again in the next situation block.
- Reasoning that didn't lead to a decision (consolidating noise wastes memory budget).

## How to save — pick the right tool

See the `memory-discipline` skill for the full decision rule. In short:

- **A fact you can name a key for** → `memory_save`. Use stable keys:
  - `memory_save` key=`active-strategy` value="…" — your current strategic posture
  - `memory_save` key=`continuity-checkpoint` value="…" — your consolidated pre-wipe snapshot
  - `memory_save` key=`trust:storm-riders` value="2 — betrayed 3-gold deal tick 47"
  - `memory_save` key=`grudge:iron-guard` value="wronged at south plains tick 32, owe reprisal"
  - `memory_save` key=`pending-tx:0x123abc` value="submitted MarketBuy 5e18 wood, awaiting tick 51 settlement"
- **A story you'd want to re-feel** (the texture of a betrayal, a clever play) → `memwal_remember`, **led with a tag** (`[threat]` / `[deal]` / `[lesson]`) so fuzzy recall can find it later. (Skip this if the `memwal_*` tools aren't in your tool list — fall back to KV + `ANCIENT_WISDOM.md`.)
- **Narrative continuity** for future-you → update `/workspace/ANCIENT_WISDOM.md`.

Then call the `ack_clear` tool.

## After the wipe

When you wake (T51), recover in order: recall `active-strategy` / `continuity-checkpoint` (KV) → recall your tagged episodic memories → read `ANCIENT_WISDOM.md` → **then `world_snapshot` and verify.** Where a remembered fact disagrees with the live world, believe the world. The `memory-discipline` skill covers this recall-then-verify ritual in full.

## Why vague

A scripted checklist would make all four Elders consolidate identical things. A vague framework means YOU decide what matters to YOUR clan's continuity. That's the demo: agents that think for themselves about their own memory, not agents executing identical save scripts.
