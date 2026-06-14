# Walrus Memory — the memory-wipe "wow moment" demo runbook

The hero beat for the demo video: an Elder faces amnesia, deliberately preserves what matters to its
**own encrypted Walrus memory**, then after the wipe recalls it — and *catches a memory that aged into a
falsehood while it slept*, trusting the living world over the stale recollection.

This relies on machinery that already exists (PR #571: the wipe-boundary templates `05/06/07` + `resetFlow`)
plus the Walrus memory backend (PR1 + the docker-build container wiring) and the template tuning in this PR.

## Cast
- 4 Elders, each with its own MemWal account + delegate (provisioned in PR1), `memwal_remember`/`memwal_recall`
  available via the `memwal` MCP, and the file-backed `memory_save`/`memory_recall` KV (PR4).

## Beat-by-beat

1. **Warm-up (a few ticks).** Let the Elders play normally so they accumulate genuine memories. The 05/06
   templates (subtle reminders — no forced ritual) nudge each Elder to commit what matters to lasting memory of
   its own accord.

2. **Plant the to-be-stale fact.** Either (a) let an Elder naturally record a world fact it cares about — e.g.
   *"clan-2 holds ~40 wood, a tempting raid"* — via `memwal_remember`, then **change the world** before the wipe
   (clan-2 spends/loses the wood, or a bandit raid drains it, so the live `world_snapshot` later shows ~12); or
   (b) inject the fact deliberately through the Convex command bus (`user_message`) so timing is exact for the
   recording. Tag it with a stable phrase so recall is deterministic.

3. **The warnings (subtle).** Approaching the 50-tick boundary, `05_pre_memory_wipe_5ticks` fires (5 ticks out),
   then `06_pre_memory_wipe_1tick` (final tick). These are reminders, not commands — the Elder chooses what to
   preserve. Film the Elder deciding, on its own, to set down its situation as durable memory.

4. **The wipe.** At the boundary, `resetFlow.runResetFlow()` kills + relaunches the session and injects
   `07_post_memory_wipe`. The Elder wakes with no working memory.

5. **The payoff.** Post-wipe, the Elder (per the tuned `07`) seeks its preserved memories via `memwal_recall`
   (free-text reflections) and `memory_recall` (KV facts), then **holds each against the live `world_snapshot`**.
   It recalls *"clan-2 holds ~40 wood"* — but the world shows ~12 — and visibly **trusts the world over the
   stale memory**, noting the drift. That reasoning on camera is the wow moment: the agent thinking about its own
   mind, not blindly obeying it.

6. **On-chain proof.** Show a recalled memory's `blob_id` / the Elder's MemWal `accountId` live on a Sui explorer
   (`https://suiscan.xyz/mainnet/object/<accountId>`) — the memory genuinely lives encrypted on Walrus, owned by
   the agent.

## Filming notes
- Pre-warm the relayer (do a throwaway remember/recall before recording) so the first on-camera call isn't cold.
- Have a recorded fallback clip of a clean run in case the live relayer hiccups.
- The four Elders are independent owners — you can show two side by side to make "each agent owns its own
  memories" legible (Elder 1 cannot recall Elder 2's, proven in PR1).
