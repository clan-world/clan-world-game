# Shared base skills

Every Elder container gets these skills R/O-mounted into `/home/elder/.claude/skills/`. They are the **base toolkit** every Elder needs — the canonical tick procedure, the autonomous-research mindset, and (in future) any other skill that has been validated as "every elder benefits from this."

## Current shared skills

- **`lean-tick/`** — the canonical 3-command per-tick procedure. The default response to a plain `TICK N Started` marker.
- **`research-mindset/`** — heuristics for open-ended autonomous work. Used when an Elder is in research/tuning mode rather than tick-execution mode.

## Adding a new shared skill

Per the plan (Phase 1.7 acceptance criterion), keep total shared skills ≤ 6. Each skill is committed to git, so a change here propagates to every Elder on the next container restart. Promote a skill from per-elder to shared only after it's been validated across multiple Elders / runs.

The skill loading order at container init (Phase 1.2 / Phase 1.6):

1. Per-elder seed manifest (if present at `agents/elder-N/seed/skills.manifest.json`) overrides shared.
2. Shared base from `/opt/clan-world/shared/skills/` is copied to `/home/elder/.claude/skills/` (no-clobber).
3. Per-elder runtime skills authored by the agent itself live in `/home/elder/.claude/skills/` (R/W).

See the plan's "Pattern B + seed manifest" section for the full propagation contract.
