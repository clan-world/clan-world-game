# Prize Strategy

## Active Target

ClanWorld V3 targets the Walrus storage and agent-memory narrative:

1. Persist autonomous clan Elder memory across context resets.
2. Let the Elder play through live Base Sepolia ticks.
3. Surface memory continuity in the cockpit.
4. Keep the onchain game loop visibly alive.

## What Matters

- The onchain game engine must be visibly alive.
- The cockpit must show four Elders acting at the same time.
- Agent memory should be legible to judges without a lecture.
- Whispers and owner steering should feel like a real multi-agent command surface.

## Demo Fallbacks

- Until Walrus lands, use the file memory store and clearly label it as a local fallback.
- If KeeperHub is unavailable, use the runner/foundry heartbeat loop.
- If live chain state is unavailable, use explicit demo mode rather than hidden mock behavior.
