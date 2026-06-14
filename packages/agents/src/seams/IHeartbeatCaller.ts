/**
 * IHeartbeatCaller — caller of ClanWorld.heartbeat() on-chain.
 *
 * Live driver: the dockerized `packages/heartbeat` runner calls heartbeat() via
 *   viem writeContract using a dedicated runner wallet, self-scheduling off the
 *   on-chain `heartbeatIntervalSeconds()` (30s canonical). The external KeeperHub
 *   keeper layer is retired; the runner is the canonical tick driver (Convex cron
 *   is a disaster-only fallback).
 *
 * Contract:
 * - Caller must be permissionless: anyone may call heartbeat(); the contract self-rate-limits.
 * - callHeartbeat() must wait for tx confirmation before resolving (not fire-and-forget).
 * - If the chain rejects because the rate limit hasn't elapsed, implementations must
 *   surface HeartbeatRateLimitedError, not a generic Error, so the runner can back off.
 * - Implementations must NOT use the same wallet as any Elder (Elder wallets sign clan orders;
 *   mixing nonces causes order submission failures).
 */
export interface IHeartbeatCaller {
  /**
   * Call ClanWorld.heartbeat() and wait for confirmation.
   *
   * @returns confirmed tx hash on success
   * @throws HeartbeatRateLimitedError if the on-chain rate limit has not elapsed
   * @throws Error on other chain/network failures
   */
  callHeartbeat(): Promise<{ txHash: string }>;

  /**
   * Read the owner-configured on-chain heartbeat interval.
   * Runners read this once at boot; changing it operationally means calling
   * setHeartbeatIntervalSeconds() on-chain, then restarting the runner.
   */
  readHeartbeatIntervalSeconds(): Promise<number>;

  /**
   * Read the chain's next accepted heartbeat timestamp (Unix seconds).
   * This drives runner scheduling; no local heartbeat-duration env var exists.
   */
  readNextHeartbeatAtTs(): Promise<number>;
}

/** Thrown when heartbeat() is called before nextHeartbeatAtTs has elapsed. */
export class HeartbeatRateLimitedError extends Error {
  constructor(
    /** Unix seconds when the next heartbeat will be accepted. */
    public readonly nextAllowedAt: number,
  ) {
    super(`heartbeat rate-limited: next allowed at ${new Date(nextAllowedAt * 1000).toISOString()}`);
    this.name = 'HeartbeatRateLimitedError';
  }
}
