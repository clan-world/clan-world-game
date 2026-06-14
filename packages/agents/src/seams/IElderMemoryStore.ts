/**
 * IElderMemoryStore — durable Elder memory across context resets.
 *
 * Local JSON file at ~/.world/clanworld-runner/state/elder-{N}-memory.json
 *
 * Contract:
 * - Key/value store scoped to a single Elder (N).
 * - All keys are strings; values are JSON-serialisable strings.
 * - reads must not throw on missing keys (return undefined).
 * - writes must be durable: a read after a successful write must return the written value.
 * - Implementations must be safe for single-Elder single-writer use (no concurrent write guarantee required).
 */
export interface IElderMemoryStore {
  /**
   * Read the value stored for topic/key, or undefined if not set.
   */
  recall(key: string): Promise<string | undefined>;

  /**
   * Persist a value for key. Overwrites any previous value.
   *
   * Contract:
   * - Must complete before the tick loop continues (caller does not fire-and-forget).
   * - Must throw on storage failure (full disk, permission denied).
   */
  save(key: string, value: string): Promise<void>;

  /**
   * Return all stored key/value pairs (snapshot at call time).
   * Used by the runner to compose the continuity summary block on final-tick warning.
   */
  snapshot(): Promise<Record<string, string>>;
}
