/**
 * Untested error-path coverage for the heartbeat loop service.
 *
 * Agent A — test-improvement experiment 2026-05-24.
 * Focus: error branches the existing suites don't exercise:
 *   - webhook non-2xx, missing Authorization header, sync-thrown fetch errors
 *   - mined-but-reverted receipt with the post-revert `readNextHeartbeatAtTs`
 *     ALSO failing (regression guard for `.catch(() => undefined)`)
 *   - `WaitForTransactionReceiptTimeoutError` → `HeartbeatTimeoutError` mapping
 *   - `ContractFunctionRevertedError` thrown by simulation upgrades to
 *     `HeartbeatRateLimitedError` only when rate-limit is still in effect
 *   - `configFromEnv` private-key length validation (deferred until construct)
 *   - scheduler boot-time `readHeartbeatIntervalSeconds` failure posts
 *     `boot-error` runnerStatus but the loop keeps running
 *   - scheduler `nextHeartbeatAtTs` backoff caps at the final index
 *   - scheduler timeout-recovery when the post-timeout state read also throws
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
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: viemMocks.readContract,
      waitForTransactionReceipt: viemMocks.waitForTransactionReceipt,
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
// RunnerCastHeartbeat — receipt / RPC error paths.
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

  it('upgrades mined-but-reverted receipt to HeartbeatRateLimitedError when nextHeartbeatAtTs is in the future', async () => {
    const hash = `0x${'a'.repeat(64)}` as const;
    const futureTs = Math.floor(Date.now() / 1000) + 600;
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      blockNumber: 123n,
    });
    // First (and only) readContract call resolves the post-revert state read.
    viemMocks.readContract.mockResolvedValue({ nextHeartbeatAtTs: BigInt(futureTs) });

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: VALID_PK,
      contractAddress: CONTRACT,
      rpcUrl: 'https://rpc.example',
    });

    await expect(heartbeat.callHeartbeat()).rejects.toBeInstanceOf(HeartbeatRateLimitedError);
  });

  it('surfaces generic revert error when the post-revert readNextHeartbeatAtTs ALSO fails', async () => {
    // Regression guard: the `.catch(() => undefined)` chain on the recovery
    // read must NOT swallow into a `HeartbeatRateLimitedError`. The user MUST
    // see the underlying revert string when state read fails too.
    const hash = `0x${'a'.repeat(64)}` as const;
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      blockNumber: 123n,
    });
    viemMocks.readContract.mockRejectedValue(new Error('rpc state read crashed'));

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: VALID_PK,
      contractAddress: CONTRACT,
      rpcUrl: 'https://rpc.example',
    });

    await expect(heartbeat.callHeartbeat()).rejects.toThrow(/reverted on-chain/);
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

  it('upgrades simulation ContractFunctionRevertedError to HeartbeatRateLimitedError when rate-limit is active', async () => {
    const futureTs = Math.floor(Date.now() / 1000) + 600;
    viemMocks.writeContract.mockRejectedValue(
      new ContractFunctionRevertedError({ abi: [], functionName: 'heartbeat' }),
    );
    viemMocks.readContract.mockResolvedValue({ nextHeartbeatAtTs: BigInt(futureTs) });

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: VALID_PK,
      contractAddress: CONTRACT,
      rpcUrl: 'https://rpc.example',
    });

    await expect(heartbeat.callHeartbeat()).rejects.toBeInstanceOf(HeartbeatRateLimitedError);
  });

  it('rethrows simulation revert unchanged when rate-limit window has elapsed', async () => {
    // ContractFunctionRevertedError + state shows we're PAST the window means
    // the revert was for some other reason (paused, etc) and must surface as-is.
    const pastTs = Math.floor(Date.now() / 1000) - 600;
    const revert = new ContractFunctionRevertedError({ abi: [], functionName: 'heartbeat' });
    viemMocks.writeContract.mockRejectedValue(revert);
    viemMocks.readContract.mockResolvedValue({ nextHeartbeatAtTs: BigInt(pastTs) });

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: VALID_PK,
      contractAddress: CONTRACT,
      rpcUrl: 'https://rpc.example',
    });

    await expect(heartbeat.callHeartbeat()).rejects.toBeInstanceOf(ContractFunctionRevertedError);
    await expect(heartbeat.callHeartbeat()).rejects.not.toBeInstanceOf(HeartbeatRateLimitedError);
  });
});

// ---------------------------------------------------------------------------
// Webhook delivery error branches.
// ---------------------------------------------------------------------------

describe('RunnerCastHeartbeat — webhook delivery failures', () => {
  it('warns with HTTP status text and still resolves successfully on non-2xx webhook response', async () => {
    const hash = `0x${'a'.repeat(64)}` as const;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });
    vi.stubGlobal('fetch', fetchMock);
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 123n,
    });

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: VALID_PK,
      contractAddress: CONTRACT,
      rpcUrl: 'https://rpc.example',
      convexWebhookUrl: 'https://convex.example',
      webhookSharedSecret: 'shh',
    });

    // Heartbeat itself must succeed — the webhook is best-effort observability.
    await expect(heartbeat.callHeartbeat()).resolves.toEqual({ txHash: hash });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('503 Service Unavailable'),
    );
    warn.mockRestore();
  });

  it('omits Authorization header when no shared secret is configured', async () => {
    const hash = `0x${'a'.repeat(64)}` as const;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 123n,
    });

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: VALID_PK,
      contractAddress: CONTRACT,
      rpcUrl: 'https://rpc.example',
      convexWebhookUrl: 'https://convex.example',
      // No webhookSharedSecret
    });

    await heartbeat.callHeartbeat();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('still resolves successfully when fetch throws synchronously (e.g. DNS failure)', async () => {
    const hash = `0x${'a'.repeat(64)}` as const;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(() => { throw new TypeError('ENOTFOUND convex.example'); });
    vi.stubGlobal('fetch', fetchMock);
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 123n,
    });

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: VALID_PK,
      contractAddress: CONTRACT,
      rpcUrl: 'https://rpc.example',
      convexWebhookUrl: 'https://convex.example',
    });

    await expect(heartbeat.callHeartbeat()).resolves.toEqual({ txHash: hash });
    expect(warn).toHaveBeenCalledWith(
      '[RunnerCastHeartbeat] heartbeat webhook POST failed:',
      expect.any(TypeError),
    );
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// startHeartbeatScheduler — boot + retry-exhaustion + cascade error branches.
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

    await vi.advanceTimersByTimeAsync(501);

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

  it('caps nextHeartbeatAtTs read backoff at the final (10s) entry across many consecutive failures', async () => {
    vi.useFakeTimers();
    // After 4 failures, every subsequent retry uses the largest backoff (10s).
    const readNextHeartbeatAtTs = vi.fn().mockRejectedValue(new Error('rpc read down'));
    const caller = makeHeartbeatCaller({ readNextHeartbeatAtTs });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // Drive past all 4 backoff steps (1s+2s+5s+10s = 18s) plus one extra cap-tier (10s).
    await vi.advanceTimersByTimeAsync(1_000); // 1st backoff
    await vi.advanceTimersByTimeAsync(2_000); // 2nd backoff
    await vi.advanceTimersByTimeAsync(5_000); // 3rd backoff
    await vi.advanceTimersByTimeAsync(10_000); // 4th backoff (largest)
    expect(readNextHeartbeatAtTs.mock.calls.length).toBeGreaterThanOrEqual(5);

    // 5th attempt should also wait the full 10s (capped), not less.
    const beforeFifth = readNextHeartbeatAtTs.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(readNextHeartbeatAtTs.mock.calls.length).toBe(beforeFifth);
    await vi.advanceTimersByTimeAsync(1);
    expect(readNextHeartbeatAtTs.mock.calls.length).toBe(beforeFifth + 1);

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

    // Drive past the initial wait + all 4 retry backoffs.
    await vi.advanceTimersByTimeAsync(
      501 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0),
    );

    // It should have retried 5 times (timeout class) and finally alerted.
    // The alert message must reflect that the failures were receipt-timeouts,
    // not silently treated as success (which the timeout-recovery branch could
    // do if the post-timeout state read returned a valid advanced value).
    expect(callHeartbeat).toHaveBeenCalledTimes(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toMatch(/receipt timeout/);
    // At least one runnerStatus row during the retry loop classifies as 'timeout'.
    const timeoutCalls = postRunnerStatus.mock.calls.filter(
      c => (c[0] as { lastFireResult: string }).lastFireResult === 'timeout',
    );
    expect(timeoutCalls.length).toBe(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);

    abort.abort();
  });

  it('does not alert when aborted during the final retry-loop backoff sleep', async () => {
    vi.useFakeTimers();
    const callHeartbeat = vi.fn().mockRejectedValue(new Error('rpc down'));
    const alert = vi.fn().mockResolvedValue({ ok: true });
    const caller = makeHeartbeatCaller({ callHeartbeat });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      alert,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // Walk into the middle of the 10s (last) backoff, then abort.
    const into10s = 501 + 1_000 + 2_000 + 5_000 + 1; // last sleep just started
    await vi.advanceTimersByTimeAsync(into10s);
    abort.abort();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(alert).not.toHaveBeenCalled();
  });
});
