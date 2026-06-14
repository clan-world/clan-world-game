# Shared base skills

Every Elder container gets these skills R/O-mounted into `/home/elder/.claude/skills/`. They are the **base toolkit** every Elder needs — the canonical tick procedure, the autonomous-research mindset, and (in future) any other skill that has been validated as "every elder benefits from this."

## Current shared skills

- **`lean-tick/`** — the canonical 3-command per-tick procedure. The default response to a plain `TICK N Started` marker.
- **`deposit-discipline/`** — harvested resources are worthless until deposited; the deposit-lag failure mode and how to avoid starving a clan.
- **`world-physics/`** — mission mechanics, carry caps, yields, the gather/deposit cycle.
- **`research-mindset/`** — heuristics for open-ended autonomous work. Used when an Elder is in research/tuning mode rather than tick-execution mode.
- **`clan-strategy/`** — the clansman-allocation doctrine: WIN = tallest Monument fastest, via a 7-rung survive→build→diplomacy ladder. Pulled on `lean-tick` Step 3 (decide). Deep prose in its sibling `LADDER.md`.
- **`memory-discipline/`** — using the two memory systems well: KV facts (`memory_save` / `memory_recall`) vs episodic reflections (`memwal_remember` / `memwal_recall`), stable keys, tagging, anti-patterns, the wipe ritual. Pull on demand.
- **`final-tick-continuity/`** — vague-by-design framework for what to consolidate before a memory wipe. Triggered by the runner's wipe warning.

That's 7 — over the prior cap of 6 (clan-strategy + the two memory skills all promoted in the hackathon push). Retire one or raise the cap before adding more.

## Adding a new shared skill

Per the plan (Phase 1.7 acceptance criterion), keep total shared skills lean (the original target was ≤ 6; the hackathon push brought it to 7 — revisit the cap intentionally). Each skill is committed to git, so a change here propagates to every Elder on the next container restart. Promote a skill from per-elder to shared only after it's been validated across multiple Elders / runs.

The skill loading order at container init (Phase 1.2 / Phase 1.6):

1. Per-elder seed manifest (if present at `agents/elder-N/seed/skills.manifest.json`) overrides shared.
2. Shared base from `/opt/clan-world/shared/skills/` is copied to `/home/elder/.claude/skills/` (no-clobber).
3. Per-elder runtime skills authored by the agent itself live in `/home/elder/.claude/skills/` (R/W).

See the plan's "Pattern B + seed manifest" section for the full propagation contract.
