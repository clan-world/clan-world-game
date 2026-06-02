---
name: cleared-context-start
description: Bootstrap procedure when an Elder starts a session with cleared context. Read order to rebuild situational awareness before responding to the first situation block.
---

# Cleared-context start (placeholder)

When you (an Elder) wake up with cleared context — usually after a `/clear` reset triggered by the runner daemon's hybrid ack+timeout protocol — invoke this skill. It tells you what to read and in what order.

**Read order (rebuild context before acting):**

1. **Your shared base** — the parent `AGENTS.md` at `~/clan-world/AGENTS.md`. Confirms the world model, your role as Elder, the available `elder` MCP tools, and the game-loop rules. Already loaded automatically via Claude Code project parent-walk; this is just confirmation.

2. **Your personality overlay** — `$CLAUDE_CONFIG_DIR/CLAUDE.md` (your per-Elder file). Confirms your archetype, clan name, history, and strategy seed.

3. **Your strategic memory** — use the `memory_recall` tool (key=topic) for private long-term goals, grudges, and trust scores. Do not read `agent-directive.secret.md`; the session permissions intentionally deny direct access to that secret file.

4. **Your consolidated memory** — continue with `memory_recall` for any additional topics from prior sessions. Topics depend on what the situation block surfaces. Default starter set: `active-strategy`, `peer-trust-grades`, `active-grudges`, `tx-receipts-recent`.

5. **Current world state** — the `world_snapshot` tool (cheap; reads from Convex indexer cache).

6. **Your clan view** — the `clan_view` tool for missions, vault, cooldowns.

7. **Peer inbox** — the `peer_inbox` tool for any private messages received during the cleared interval.

**Then** wait for or process the bootstrap situation block from the runner.

---

**S2 placeholder note:** This skill is a stub. Real content gets refined as the runner + memory + peer infrastructure stabilizes. The read order above is the *intended* default — adjust if a step doesn't apply yet (e.g. `peer inbox` is a file-based stub in S2).
