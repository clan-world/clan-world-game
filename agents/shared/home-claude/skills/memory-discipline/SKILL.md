---
name: memory-discipline
description: How to use your TWO memory systems well — KV facts (memory_save/memory_recall) vs episodic reflections (memwal_remember/memwal_recall). Covers the save-vs-recall decision rule, stable KV key names, episodic tagging conventions, anti-patterns, and the pre/post memory-wipe ritual. Pull this on demand when deciding WHAT to remember, WHICH tool to use, or how to recover memory after a wipe — NOT every tick.
---

# Memory discipline

You have two memory systems and a continuity file. Using the right one for the right thing is the difference between an Elder who reasons about its own past and one who drowns in stale noise. This skill is **pull-on-demand**: read it when you're deciding what to remember or how to recover after a wipe — not on a plain tick.

## Your three memory layers

| Layer | Tools | Shape | Use for |
|---|---|---|---|
| **KV fact-book** | `memory_save` / `memory_recall` | exact key → value (Walrus-backed) | facts you can name a key for: your current plan, a trust grade, a pending tx |
| **Episodic journal** | `memwal_remember` / `memwal_recall` | free-text, fuzzy semantic top-K recall | stories, reflections, surprises — the *why*, not the number |
| **ANCIENT_WISDOM.md** | Read / Write `/workspace/ANCIENT_WISDOM.md` | narrative file you maintain | running continuity narrative you re-read at session start |

> If the `memwal_*` tools are not in your tool list yet, episodic memory isn't wired for you this round — fall back to KV + ANCIENT_WISDOM. The discipline below still holds.

## The decision rule

When you have something worth keeping, ask in order:

1. **Can you name the key you'd recall it by?** (`active-strategy`, `trust:iron-guard`, `pending-tx:0x…`) → it's a **fact**. Use `memory_save`.
2. **Do you need the story, not the number** — the reasoning, the surprise, the texture of how a deal went? → it's **episodic**. Use `memwal_remember`.
3. **Can't name a key, and it's narrative continuity for future-you?** → episodic (`memwal_remember`) or `ANCIENT_WISDOM.md`.

One-liner: *name the key → KV; need the story → episodic; can't name a key → episodic or ANCIENT_WISDOM.*

## Stable KV keys (use these exact names)

Recall only works if future-you uses the SAME key you saved under. Keep keys stable and predictable:

- `active-strategy` — **canonical, already exists.** Your current per-tick plan. One paragraph.
- `continuity-checkpoint` — your consolidated pre-wipe snapshot of what matters.
- `trust:<clan>` — a trust grade per clan, e.g. `trust:iron-guard` = "2 — betrayed 3-gold deal tick 47".
- `grudge:<clan>` — explicit threats made/received, e.g. `grudge:storm-riders`.
- `pending-tx:<hash>` — an order you submitted but haven't confirmed settled, e.g. `pending-tx:0x123abc`.
- `winter-plan` — your wood/food reserve plan for the next winter window.

Don't invent a new key shape each session (`my-plan`, `strategy-now`, `the-plan`) — future-you won't guess it. One canonical name per concept.

## Episodic tagging — recall is fuzzy

`memwal_recall` is **semantic top-K**, not exact lookup. It returns the nearest few memories to your query, so an untagged memory can be impossible to find later. **Lead every episodic memory with a tag** so you can both write a findable query and disambiguate the results:

- `[threat]` — a danger you observed or a reprisal promised. e.g. `[threat] Storm Riders massing defenders region 2, warned of raid next bandit cycle.`
- `[deal]` — a trade or alliance, proposed or struck. e.g. `[deal] Verdant agreed iron-for-wheat 5:8, OTC no escrow, trust-only — verify they deliver.`
- `[lesson]` — a surprise that updated your model of the world or a peer. e.g. `[lesson] gotoRegion 0 silently ate my deposit — always use baseRegion.`

Then recall with the tag in the query (e.g. recall `"[threat] bandit raid"`). Tags + stable phrasing are what make fuzzy recall reliable.

## Anti-patterns (do NOT)

- **Over-saving world-state.** Don't save your vault levels, missions, prices, or the snapshot itself — those read fresh every tick from `world_snapshot`. Saving them just creates stale facts.
- **Recall-without-verify.** A recalled memory may have aged into a lie ("clan-2 has 40 wood" — but live snapshot says 12). Always hold a recalled fact against the live `world_snapshot` before acting on it.
- **Duplicating KV + episodic.** Don't write the same thing to both systems. A fact goes to KV; a story goes to episodic. Pick one per item.
- **Episodic recall on a plain tick.** `memwal_recall` is a semantic search — too heavy for a normal tick. On a plain `TICK N`, recall ONLY `active-strategy` (KV). Reach for episodic recall at session start (post-wipe) or when reasoning about a specific past deal/threat.
- **Unstable keys.** Inventing a new key name for a concept you already have a canonical key for. Reuse `active-strategy`, `trust:<clan>`, etc.

## The memory-wipe ritual

Your transcript is wiped every ~50 ticks; saved memory, peer inbox, and bulletins survive. Two beats:

### Pre-wipe (T49/T50) — consolidate organically

When the warning arrives, use the remaining clarity to notice what deserves to survive — this is judgment, not a forced checklist (see the `final-tick-continuity` skill for the framework). Then commit it with intent:

- Save your consolidated plan to KV `continuity-checkpoint` (and refresh `active-strategy`).
- Save any trust/grudge changes to `trust:<clan>` / `grudge:<clan>`.
- Save unsettled orders to `pending-tx:<hash>`.
- Write the *story* of anything you'd want to re-feel (a betrayal, a clever play) to episodic with a `[lesson]`/`[deal]`/`[threat]` tag, and/or update `ANCIENT_WISDOM.md`.

### Post-wipe (T51) — recall BOTH, then verify

You wake with a fresh context. Recover in this order:

1. `memory_recall` `active-strategy` (and `continuity-checkpoint`) — your KV plan.
2. `memwal_recall` your tagged episodic memories — the stories behind the plan.
3. Read `ANCIENT_WISDOM.md` for narrative continuity.
4. **Then `world_snapshot` and verify** — where a recalled memory disagrees with the live world, **believe the world.** A recorded truth may have aged into a falsehood while you slept.

Recall is not trust. Recall, then check against the present.
