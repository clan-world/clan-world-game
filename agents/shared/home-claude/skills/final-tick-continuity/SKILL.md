---
name: final-tick-continuity
description: Concrete checklist for what to consolidate before a context reset. Triggered when the runner injects a memory-wipe / final-tick warning. Save a tight, specific operational handoff — NOT a lore diary. Pairs with the memory-discipline skill (which tool to use for each item).
---

# Final-tick continuity (boring + specific)

When the runner injects a memory-wipe warning — a "thinning at the edge of memory," or the explicit:

> warning: final tick before message history is reset. plan for continuity accordingly.

— you have a short window to consolidate before `/clear`. The runner will NOT save your reasoning for you. After consolidating, call the `ack_clear` tool so the runner can reset you cleanly (ack+timeout: if you don't ack within ~30s, the runner clears anyway and you lose the turn's reasoning).

**Save a tight operational handoff, not a story.** Future-you wakes with no transcript and needs to resume play in one tick — give it the facts to act on, not a narrative of how the session felt. **No lore diary.** A consolidated checkpoint is a few short lines, not prose.

## The checklist — write each of these into `continuity-checkpoint` (one or two lines each)

Fill each item with YOUR clan's specifics. The items are fixed; the values are your judgment.

1. **Current strategy** — your posture this moment, in one line. (e.g. "accumulating wood for winter, not raiding.") Also refresh `active-strategy`.
2. **Unresolved promises** — deals/whispers you committed to but haven't delivered, and anything a peer owes you. (e.g. "promised Verdant 5 iron next tick; they owe me 8 wheat.")
3. **Enemies / allies** — current trust + grudge standings that affect your next moves. (e.g. "Storm Riders hostile after region-2 raid; Iron Guard neutral-trading.")
4. **Monument plan** — where your monument build stands and the next build step. (e.g. "monument L2, need 6 iron + blueprint for L3.")
5. **Resource bottleneck** — the ONE resource constraining you right now and the plan to fix it. (e.g. "iron-starved; CM2 mining Mountains, ~20 ticks to next batch.")
6. **One "next tick do this" note** — the single concrete action future-you should take first on resume. (e.g. "T51: deposit CM1's wood at baseRegion BEFORE anything else.")

If an item is empty (no unresolved promises, say), write "none" — don't pad it into a paragraph.

## What NOT to save

- Anything already in chain state (your vault, missions, cooldowns — these read fresh on bootstrap).
- Anything in a peer message — the peer inbox persists across resets.
- Recent world events — you'll see them again in the next situation block.
- **Narrative / lore / how-it-felt prose.** Future-you needs an operational handoff, not a diary entry. Keep it to facts that change your next action.
- Reasoning that didn't lead to a decision (consolidating noise wastes memory budget).

## How to save — pick the right tool

See the `memory-discipline` skill for the full decision rule. In short:

- **A fact you can name a key for** → `memory_save`. Use stable keys:
  - `memory_save` key=`active-strategy` value="…" — your current strategic posture
  - `memory_save` key=`continuity-checkpoint` value="…" — your consolidated pre-wipe snapshot
  - `memory_save` key=`trust:storm-riders` value="2 — betrayed 3-gold deal tick 47"
  - `memory_save` key=`grudge:iron-guard` value="wronged at south plains tick 32, owe reprisal"
  - `memory_save` key=`pending-tx:0x123abc` value="submitted MarketBuy 5e18 wood, awaiting tick 51 settlement"
- **A genuinely load-bearing lesson** (a betrayal pattern, a play that worked) → `memwal_remember`, **led with a tag** (`[threat]` / `[deal]` / `[lesson]`) so fuzzy recall can find it later — **only if `memwal_*` is in your tool list.** If it's absent, put the one-line lesson in `ANCIENT_WISDOM.md` instead. Keep it to a lesson that changes future play, not a retelling.
- **Narrative continuity** for future-you → update `/workspace/ANCIENT_WISDOM.md` (always available). One or two factual lines, not a chapter.

Then call the `ack_clear` tool.

## After the wipe

When you wake (T51), recover in order: recall `active-strategy` / `continuity-checkpoint` (KV) → recall your tagged episodic memories (*only if `memwal_recall` is in your tool list*) → read `ANCIENT_WISDOM.md` → **then `world_snapshot` and verify.** Where a remembered fact disagrees with the live world, believe the world. The `memory-discipline` skill covers this recall-then-verify ritual in full.

## Why a fixed checklist (but your own values)

The six checklist items are the same for every Elder so nothing load-bearing gets dropped — but the *values* you put in them are yours alone, derived from YOUR clan's situation. That's the demo: agents that capture a disciplined operational handoff and resume play in one tick, not agents writing identical save scripts AND not agents wandering into lore-diary prose.
