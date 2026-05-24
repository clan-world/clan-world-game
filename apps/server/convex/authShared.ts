/**
 * Shared auth helper for public mutations that must be gated by INDEXER_SECRET.
 *
 * Pattern mirrors `inft.ts.requireIndexerSecret`: callers (orchestrator,
 * indexer, demo seed scripts) pass `secret: <string>` as a mutation arg, and
 * the handler calls this helper before doing any writes. If INDEXER_SECRET is
 * unset on the Convex deployment, mutations reject all writes (fail-closed).
 *
 * Used by: bulletins.seedBulletin, comms.sendWhisper,
 * comms.seed{OrchEvent,HumanSteering}.
 *
 * For mutations that have NO external callers (memory.seedEntry,
 * memory.seedEvent, clansmen.seedClansmen) we use `internalMutation` instead;
 * those don't need this helper.
 */
export function requireIndexerSecret(supplied: string): void {
  const expected = process.env.INDEXER_SECRET;
  if (!expected) {
    throw new Error("INDEXER_SECRET is not configured on this Convex deployment");
  }
  if (supplied !== expected) {
    throw new Error("invalid indexer secret");
  }
}

/**
 * Shared auth helper for admin/operator mutations.
 *
 * The web cockpit API reads BUS_OPERATOR_SECRET_FILE from its own server
 * environment and passes the file contents as `secret`. Convex validates that
 * value against its own BUS_OPERATOR_SECRET env var because Convex cannot read
 * the Docker secret file directly.
 */
export function requireBusOperatorSecret(supplied: string): void {
  const expected = process.env.BUS_OPERATOR_SECRET;
  if (!expected) {
    throw new Error("BUS_OPERATOR_SECRET is not configured on this Convex deployment");
  }
  if (supplied !== expected) {
    throw new Error("invalid bus operator secret");
  }
}
