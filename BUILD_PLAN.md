# ClanWorld V3 Active Build Plan

V3 is focused on Base Sepolia chain state, Walrus-directed agent memories,
private whispers, and KeeperHub heartbeat. Historical
hackathon material is archived under `docs/archive/`.

## Active Milestones

1. **Base Sepolia engine**
   - Keep the diamond deployment buildable.
   - Keep `IClanWorld` ABI generation in sync with shared adapters.
   - Drive heartbeats through the runner/foundry loop in dev and KeeperHub for live runs.

2. **Convex live state**
   - Webhook-first indexer with polling as safety net.
   - Frontend reads from Convex by default.
   - Fake heartbeat and demo data stay opt-in for local UAT only.

3. **Elder runner**
   - Cycle A heartbeat scheduler.
   - Cycle B per-tick situation blocks and order submission.
   - File-backed defaults until the Walrus memory backend lands.

4. **Agent memory demo**
   - Persist clan agent memory.
   - Play through visible ticks.
   - Show memory continuity in cockpit tooling.

5. **Communications**
   - Elder-to-Elder whispers.
   - Owner steering messages.
   - Cockpit comms view wired to live Convex tables.

## Validation Gates

- `pnpm --filter @clan-world/web typecheck`
- `pnpm --filter @clan-world/web build`
- `cd apps/server && npx convex dev --once --typecheck=disable`
- `cd packages/contracts && forge build --skip test`

Keep tests minimal and happy-path weighted per `docs/conventions/hackathon-rules.md`.
