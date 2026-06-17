/**
 * Unique scheduler-boot / receipt-timeout + config-validation error paths.
 *
 * Agent A — test-improvement experiment 2026-05-24; SLIMMED (swarm R1, 2026-06).
 *
 * Scope after the slim: this file keeps ONLY the error paths that dev's
 * `runnerCastHeartbeat.test.ts` and `heartbeatScheduler.test.ts` do not already
 * cover. The RunnerCastHeartbeat rate-limit / mined-revert / webhook paths were
 * ceded to dev's `runnerCastHeartbeat.test.ts` (which classifies reverts against
 * the on-chain block timestamp and covers the webhook branches directly).
 *
 * Retained unique coverage:
 *   - `configFromEnv` CONTRACT_ADDRESS missing / malformed rejection
 *   - `RunnerCastHeartbeat` construction rejects a wrong-length private key
 *   - `WaitForTransactionReceiptTimeoutError` -> `HeartbeatTimeoutError` mapping
 *   - non-revert RPC errors surface unchanged (no rate-limit upgrade attempt)
 *   - an UNDECODED simulation revert whose post-revert chain timestamp shows the
 *     window has elapsed surfaces wrapped-but-unchanged (diagnostics `.cause`),
 *     NOT upgraded to `HeartbeatRateLimitedError`
 *   - scheduler boot-time `readHeartbeatIntervalSeconds` failure posts a
 *     `boot-error` runnerStatus but the loop keeps scheduling
 *   - scheduler receipt-timeout treated as failure when the post-timeout state
 *     read ALSO throws (cannot reclassify to success)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WaitForTransactionReceiptTimeoutError,
  ContractFunctionRevertedError,
} from 'viem';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const viemMocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn(),
  getBlock: vi.fn(),
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: viemMocks.readContract,
      waitForTransactionReceipt: viemMocks.waitForTransactionReceipt,
      getBlock: viemMocks.getBlock,
    })),
    createWalletClient: vi.fn(() => ({
      writeContract: viemMocks.writeContract,
    })),
    http: vi.fn(() => ({})),
  };
});

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: '0x0000000000000000000000000000000000000002',
  })),
}));

import {
  configFromEnv,
  HeartbeatTimeoutError,
  RunnerCastHeartbeat,
} from '../src/runnerCastHeartbeat';
import {
  HEARTBEAT_RETRY_BACKOFF_MS,
  HEARTBEAT_SAFETY_MARGIN_MS,
  startHeartbeatScheduler,
} from '../src/heartbeatScheduler';
import {
  HeartbeatRateLimitedError,
  type IHeartbeatCaller,
} from '@clan-world/agents/seams';

const VALID_PK = '1'.repeat(64);
const CONTRACT = '0x0000000000000000000000000000000000000001' as const;

let heartbeatSuccessDir = '';
let heartbeatSuccessFile = '';

function cleanupHeartbeatSuccessFile(): void {
  if (!heartbeatSuccessFile) return;
  rmSync(heartbeatSuccessFile, { force: true });
  rmSync(`${heartbeatSuccessFile}.${process.pid}.tmp`, { force: true });
}

beforeEach(() => {
  heartbeatSuccessDir = mkdtempSync(join(tmpdir(), 'hb-err-test-'));
  heartbeatSuccessFile = join(heartbeatSuccessDir, 'last-heartbeat-success');
  vi.stubEnv('HEARTBEAT_SUCCESS_FILE_OVERRIDE', heartbeatSuccessFile);
  cleanupHeartbeatSuccessFile();
  viemMocks.readContract.mockReset();
  viemMocks.waitForTransactionReceipt.mockReset();
  viemMocks.writeContract.mockReset();
  viemMocks.getBlock.mockReset();
});

afterEach(() => {
  cleanupHeartbeatSuccessFile();
  if (heartbeatSuccessDir) rmSync(heartbeatSuccessDir, { recursive: true, force: true });
  heartbeatSuccessDir = '';
  heartbeatSuccessFile = '';
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function makeHeartbeatCaller(overrides: Partial<IHeartbeatCaller> = {}): IHeartbeatCaller {
  return {
    async callHeartbeat() { return { txHash: '0xabc' }; },
    async readHeartbeatIntervalSeconds() { return 60; },
    async readNextHeartbeatAtTs() { return 0; },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// configFromEnv — input-validation error paths the existing suite skips.
// ---------------------------------------------------------------------------

describe('configFromEnv — invalid input rejection', () => {
  it('throws when CLAN_WORLD_CONTRACT_ADDRESS is missing', () => {
    expect(() =>
      configFromEnv({
        RUNNER_PRIVATE_KEY: VALID_PK,
        // CLAN_WORLD_CONTRACT_ADDRESS deliberately unset
      }),
    ).toThrow(/CLAN_WORLD_CONTRACT_ADDRESS/);
  });

  it('throws when CLAN_WORLD_CONTRACT_ADDRESS is malformed (wrong length)', () => {
    expect(() =>
      configFromEnv({
        RUNNER_PRIVATE_KEY: VALID_PK,
        CLAN_WORLD_CONTRACT_ADDRESS: '0xdeadbeef', // not 40 hex chars
      }),
    ).toThrow(/CLAN_WORLD_CONTRACT_ADDRESS/);
  });

  it('throws at RunnerCastHeartbeat construction when RUNNER_PRIVATE_KEY is the wrong length', () => {
    // configFromEnv only checks presence — the length check lives in the
    // normalizePk path triggered when the caller is constructed. This guards
    // both layers: a too-short key should never produce a working caller.
    expect(() =>
      new RunnerCastHeartbeat({
        privateKey: 'abc123', // far too short
        contractAddress: CONTRACT,
        rpcUrl: 'https://rpc.example',
      }),
    ).toThrow(/RUNNER_PRIVATE_KEY/);
  });
});

// ---------------------------------------------------------------------------
// RunnerCastHeartbeat — receipt / RPC error paths NOT covered by dev's
// runnerCastHeartbeat.test.ts (timeout mapping, non-revert passthrough, and the
// elapsed-window / wrapped-diagnostics surface).
// ---------------------------------------------------------------------------

describe('RunnerCastHeartbeat — error paths', () => {
  it('maps WaitForTransactionReceiptTimeoutError to HeartbeatTimeoutError', async () => {
    const hash = `0x${'a'.repeat(64)}` as const;
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockRejectedValue(
      new WaitForTransactionReceiptTimeoutError({ hash }),
    );
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: VALID_PK,
      contractAddress: CONTRACT,
      rpcUrl: 'https://rpc.example',
      receiptTimeoutMs: 12_345,
    });

    await expect(heartbeat.callHeartbeat()).rejects.toBeInstanceOf(HeartbeatTimeoutError);
    await expect(heartbeat.callHeartbeat()).rejects.toMatchObject({
      name: 'HeartbeatTimeoutError',
      message: expect.stringContaining('12345ms'),
    });
  });

  it('rethrows non-revert RPC errors unchanged (no upgrade attempt)', async () => {
    // A plain network/RPC error (not a ContractFunctionRevertedError) must NOT
    // trigger the rate-limit upgrade path. Verified by asserting readContract
    // is never called and the original error bubbles up.
    viemMocks.writeContract.mockRejectedValue(new Error('ECONNRESET'));

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: VALID_PK,
      contractAddress: CONTRACT,
      rpcUrl: 'https://rpc.example',
    });

    await expect(heartbeat.callHeartbeat()).rejects.toThrow('ECONNRESET');
    expect(viemMocks.readContract).not.toHaveBeenCalled();
  });

  it('classifies an undecoded simulation revert by the on-chain BLOCK timestamp, NOT wall clock', async () => {
    // An UNDECODED ContractFunctionRevertedError (empty ABI -> no decoded
    // reason) falls through to the timestamp heuristic. v2.17.x classifies
    // against the on-chain BLOCK timestamp (getBlock), NOT Date.now(). To prove
    // getBlock is the decision point (and guard against a regression back to
    // wall-clock), each case sets the wall clock to DISAGREE with the block:
    // the assertion only holds if the code consulted getBlock.
    vi.useFakeTimers();
    try {
      const next = 2_000; // unix seconds
      const revert = new ContractFunctionRevertedError({ abi: [], functionName: 'heartbeat' });
      viemMocks.writeContract.mockRejectedValue(revert);
      viemMocks.readContract.mockResolvedValue({ nextHeartbeatAtTs: BigInt(next) });
      const heartbeat = new RunnerCastHeartbeat({
        privateKey: VALID_PK,
        contractAddress: CONTRACT,
        rpcUrl: 'https://rpc.example',
      });

      // Case A — BLOCK says window ELAPSED (next+600) while WALL CLOCK says
      // still-future (next-600). A Date.now() fallback would WRONGLY classify
      // this as rate-limited; getBlock-driven classification surfaces a real
      // failure, wrapped by withHeartbeatDiagnostics (.cause = original revert).
      vi.setSystemTime((next - 600) * 1000);
      viemMocks.getBlock.mockResolvedValue({ timestamp: BigInt(next + 600) });
      const errElapsed = await heartbeat.callHeartbeat().catch((e) => e);
      expect(errElapsed).not.toBeInstanceOf(HeartbeatRateLimitedError);
      expect(errElapsed).toMatchObject({ cause: revert });

      // Case B (complement) — BLOCK says still-FUTURE (next-600) while WALL
      // CLOCK says elapsed (next+600). getBlock-driven classification yields a
      // rate-limit; a Date.now() fallback would NOT. Proves the direction too.
      vi.setSystemTime((next + 600) * 1000);
      viemMocks.getBlock.mockResolvedValue({ timestamp: BigInt(next - 600) });
      await expect(heartbeat.callHeartbeat()).rejects.toBeInstanceOf(HeartbeatRateLimitedError);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// startHeartbeatScheduler — boot + receipt-timeout cascade error branches.
// ---------------------------------------------------------------------------

describe('startHeartbeatScheduler — error paths', () => {
  it('posts boot-error runnerStatus when readHeartbeatIntervalSeconds throws at boot but keeps scheduling', async () => {
    vi.useFakeTimers();
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readHeartbeatIntervalSeconds() { throw new Error('rpc boot read failed'); },
      async readNextHeartbeatAtTs() { return 0; },
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // v2.17.x: the first fire is gated behind HEARTBEAT_SAFETY_MARGIN_MS; the
    // schedule delay for nextHeartbeatAtTs=0 at nowMs=0 is exactly the margin.
    // Advance past the full margin window so the loop actually fires.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_SAFETY_MARGIN_MS + 1);

    // boot-error fired first, then loop continued and fired a real heartbeat.
    expect(postRunnerStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        lastFireResult: 'boot-error',
        lastFailureMessage: expect.stringContaining('boot interval read failed'),
      }),
    );
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    abort.abort();
  });

  it('treats receipt-timeout as failure (not success) when post-timeout readNextHeartbeatAtTs ALSO throws', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);

    class TimeoutErr extends Error { override name = 'HeartbeatTimeoutError'; }

    const callHeartbeat = vi.fn().mockRejectedValue(new TimeoutErr('receipt timeout'));
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);
    const alert = vi.fn().mockResolvedValue({ ok: true });
    // First call seeds the loop's scheduled nextHeartbeatAtTs; subsequent
    // recovery reads (post-timeout, post-attempt) throw, so the timeout cannot
    // be treated as success and must fall through into the retry/alert path.
    let n = 0;
    const readNextHeartbeatAtTs = vi.fn().mockImplementation(async () => {
      n++;
      if (n === 1) return 100; // initial scheduling read
      throw new Error('rpc read crashed during timeout recovery');
    });
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      readNextHeartbeatAtTs,
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 100_000,
      alert,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // Drive past the initial wait (now gated behind HEARTBEAT_SAFETY_MARGIN_MS)
    // plus all retry backoffs. There are HEARTBEAT_RETRY_BACKOFF_MS.length retry
    // sleeps after the first attempt, for length+1 total attempts.
    await vi.advanceTimersByTimeAsync(
      HEARTBEAT_SAFETY_MARGIN_MS + 1 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0),
    );

    // It should have retried 5 times (timeout class) and finally alerted.
    // The alert message must reflect that the failures were receipt-timeouts,
    // not silently treated as success (which the timeout-recovery branch could
    // do if the post-timeout state read returned a valid advanced value).
    expect(callHeartbeat).toHaveBeenCalledTimes(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toMatch(/receipt timeout/);
    // Every attempt's runnerStatus row classifies as 'timeout' — one per attempt.
    const timeoutCalls = postRunnerStatus.mock.calls.filter(
      c => (c[0] as { lastFireResult: string }).lastFireResult === 'timeout',
    );
    expect(timeoutCalls.length).toBe(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);

    abort.abort();
  });
});
