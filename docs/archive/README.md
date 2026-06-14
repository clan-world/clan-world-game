# docs/archive

Historical ClanWorld docs kept for reference but **superseded** and not
authoritative. **They will eventually be deleted** — they live in git history and
are here only as a soft-landing while the active docs settle.

These artifacts predate the current stack and/or were built around retired
sponsor integrations (external memory/iNFT storage, external whisper channel,
external inference/compute, external keeper heartbeat). None of those
integrations exist anymore.

**For current architecture, do NOT read anything in here** — start at
[`../index.md`](../index.md) → [`../architecture/current-architecture.md`](../architecture/current-architecture.md).

**Current stack:** Base Sepolia diamond `0x098fa5c2dc8372cde5c99db47365fa84b69f7af1`
(84532) + self-hosted Convex (indexer + tick clock) + dockerized elder agents +
dockerized 30s heartbeat runner. See `../runbooks/operator-levers.md` for the
live operational levers.

## Contents

| Path | Why archived |
|---|---|
| `reviews/` | ~68 per-PR multi-model code-review artifacts. Point-in-time; zero ongoing reference value. |
| `demo/` | ETHGlobal-era demo scripts (`DEMO_SCRIPT.md`, `SCRIPT_ETHGLOBAL*.md`) + `REVIVE-DEMO.md`. Event-bound; name retired sponsor tech + 60s ticks. |
| `planning/` | Superseded spec lineage — `clanworld_v4_spec.md`, the v4.1–v4.4 addenda, `CANONICAL_SPEC.md`, v1 profile, the numbered implementation plan, phase-12 agent-infra plan, phase-3 test spec. Live mechanics now live in `docs/WORLD_PHYSICS*.md`. |
| `hackathon/` | Demo-focus alignment addenda + keeper/0G spec PDFs (`clanworld_v4_5_alignment_addendum.md`, `DEMO_DRIFT.md`, the two sponsor spec PDFs). |
| `dockerize/` | Dockerization migration transcripts + DA/revision notes. The migration is done; current ops are in the runbooks. |
| `sponsor/` | Sponsor-tech + prize-strategy notes (the dead-sponsor docs by definition). |
| `guides/` | `stream-agents.md` — described a superseded orchestrator-spawns-subprocesses model; elders are now dockerized Claude TUIs driven by the Convex pipeline. |
| `mobile/` | `user_journeys.md` — Solana-mobile-pivot UX artifact; references retired sponsor terminal labels/whispers. |
| `ClanWorldCockpit_BrainstormingMock.jsx` | Brainstorming UI mock whose cognition-layer panels (MEMORY/COMPUTE/DIPLOMATIC THEATRE) and cost figures were built entirely around retired sponsor tech. Kept for visual-layout reference only; never compiled as-is (smart quotes). |
