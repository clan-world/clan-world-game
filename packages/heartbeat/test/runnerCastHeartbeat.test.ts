import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const viemMocks = vi.hoisted(() => ({
  getBlock: vi.fn(),
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn(),
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBlock: viemMocks.getBlock,
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

import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from 'viem';
import { HeartbeatRateLimitedError } from '@clan-world/agents/seams';
import {
  configFromEnv,
  RunnerCastHeartbeat,
} from '../src/runnerCastHeartbeat';
import { writeHeartbeatSuccessFile } from '../src/heartbeatSuccessFile';

const HEARTBEAT_ABI_FRAGMENT = [
  { type: 'function', name: 'heartbeat', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const;

// Solidity `Error(string)` selector ABI — encodes a require/revert reason the way
// the chain actually returns it, so ContractFunctionRevertedError decodes `.reason`.
const ERROR_STRING_ABI = [
  { type: 'error', name: 'Error', inputs: [{ type: 'string', name: 'reason' }] },
] as const;

let heartbeatSuccessDir = '';
let heartbeatSuccessFile = '';

function cleanupHeartbeatSuccessFile(): void {
  if (!heartbeatSuccessFile) return;
  rmSync(heartbeatSuccessFile, { force: true });
  rmSync(`${heartbeatSuccessFile}.${process.pid}.tmp`, { force: true });
}

beforeEach(() => {
  heartbeatSuccessDir = mkdtempSync(join(tmpdir(), 'hb-test-'));
  heartbeatSuccessFile = join(heartbeatSuccessDir, 'last-heartbeat-success');
  vi.stubEnv('HEARTBEAT_SUCCESS_FILE_OVERRIDE', heartbeatSuccessFile);
  cleanupHeartbeatSuccessFile();
  viemMocks.getBlock.mockReset();
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

describe('configFromEnv', () => {
  it('falls back to RPC_URL_FALLBACK when RPC_URL_PRIMARY is blank', () => {
    const cfg = configFromEnv({
      RUNNER_PRIVATE_KEY: '1'.repeat(64),
      CLAN_WORLD_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      RPC_URL_PRIMARY: '',
      RPC_URL_FALLBACK: 'https://fallback.example',
    });

    expect(cfg.rpcUrl).toBe('https://fallback.example');
  });

  it('enables fork time advance only for dev local fork RPCs by default', () => {
    const devCfg = configFromEnv({
      RUNNER_PRIVATE_KEY: '1'.repeat(64),
      CLAN_WORLD_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      CHAIN_NETWORK: 'dev',
      RPC_URL_PRIMARY: 'http://anvil-fork:8545',
    });
    expect(devCfg.advanceForkTime).toBe(true);
    expect(devCfg.gasLimit).toBe(25_000_000n);

    const prodCfg = configFromEnv({
      RUNNER_PRIVATE_KEY: '1'.repeat(64),
      CLAN_WORLD_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      CHAIN_NETWORK: 'prod',
      RPC_URL_PRIMARY: 'https://base-sepolia.example',
    });
    expect(prodCfg.advanceForkTime).toBe(false);
    expect(prodCfg.gasLimit).toBeUndefined();
  });

  it('honors explicit HEARTBEAT_GAS_LIMIT', () => {
    expect(configFromEnv({
      RUNNER_PRIVATE_KEY: '1'.repeat(64),
      CLAN_WORLD_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      CHAIN_NETWORK: 'prod',
      RPC_URL_PRIMARY: 'https://base-sepolia.example',
      HEARTBEAT_GAS_LIMIT: '1234567',
    }).gasLimit).toBe(1_234_567n);
  });

  it('does not let HEARTBEAT_ADVANCE_FORK_TIME enable a non-local RPC', () => {
    const cfg = configFromEnv({
      RUNNER_PRIVATE_KEY: '1'.repeat(64),
      CLAN_WORLD_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      CHAIN_NETWORK: 'dev',
      RPC_URL_PRIMARY: 'https://base-sepolia.example',
      HEARTBEAT_ADVANCE_FORK_TIME: '1',
    });

    expect(cfg.advanceForkTime).toBe(false);
  });

  it('derives CONVEX_WEBHOOK_URL from CONVEX_DEPLOY_URL when explicit URL is unset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const cfg = configFromEnv({
      RUNNER_PRIVATE_KEY: '1'.repeat(64),
      CLAN_WORLD_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      CONVEX_DEPLOY_URL: 'https://oceanic-hound-951.convex.cloud',
    });

    expect(cfg.convexWebhookUrl).toBe('https://oceanic-hound-951.convex.site');
    expect(warn).toHaveBeenCalledWith(
      'Deriving CONVEX_WEBHOOK_URL from CONVEX_DEPLOY_URL — set CONVEX_WEBHOOK_URL explicitly in env',
    );
    warn.mockRestore();
  });

  it('does not derive webhook URL from non-standard CONVEX_DEPLOY_URL', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const hash = `0x${'a'.repeat(64)}` as const;
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 123n,
    });

    const cfg = configFromEnv({
      RUNNER_PRIVATE_KEY: '1'.repeat(64),
      CLAN_WORLD_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      CONVEX_DEPLOY_URL: 'https://convex.mycompany.com',
    });

    expect(cfg.convexWebhookUrl).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'CONVEX_DEPLOY_URL is non-standard; CONVEX_WEBHOOK_URL required for webhook ingest',
    );

    const heartbeat = new RunnerCastHeartbeat({
      ...cfg,
      rpcUrl: 'https://rpc.example',
    });
    await expect(heartbeat.callHeartbeat()).resolves.toEqual({ txHash: hash });
    expect(fetchMock).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects hostnames that contain .convex.cloud as a substring (R5 hardening)', () => {
    // Substring match would incorrectly rewrite https://attacker.convex.cloud.evil.com
    // to https://attacker.convex.site.evil.com — defeats the security intent.
    // Hostname-suffix check via URL parsing prevents this.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const cfg = configFromEnv({
      RUNNER_PRIVATE_KEY: '1'.repeat(64),
      CLAN_WORLD_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      CONVEX_DEPLOY_URL: 'https://attacker.convex.cloud.evil.com',
    });

    expect(cfg.convexWebhookUrl).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'CONVEX_DEPLOY_URL is non-standard; CONVEX_WEBHOOK_URL required for webhook ingest',
    );
    warn.mockRestore();
  });

  it('correctly derives webhook URL for legitimate .convex.cloud hostnames', () => {
    const cfg = configFromEnv({
      RUNNER_PRIVATE_KEY: '1'.repeat(64),
      CLAN_WORLD_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      CONVEX_DEPLOY_URL: 'https://oceanic-hound-951.convex.cloud',
    });

    expect(cfg.convexWebhookUrl).toBe('https://oceanic-hound-951.convex.site');
  });

  it('treats explicit empty CONVEX_WEBHOOK_URL as disabled without derivation warning', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const cfg = configFromEnv({
      RUNNER_PRIVATE_KEY: '1'.repeat(64),
      CLAN_WORLD_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
      CONVEX_WEBHOOK_URL: '',
      CONVEX_DEPLOY_URL: 'https://oceanic-hound-951.convex.cloud',
    });

    expect(cfg.convexWebhookUrl).toBeUndefined();
    expect(info).toHaveBeenCalledWith('CONVEX_WEBHOOK_URL is empty; heartbeat webhook disabled');
    expect(warn).not.toHaveBeenCalled();
    info.mockRestore();
    warn.mockRestore();
  });
});

describe('RunnerCastHeartbeat', () => {
  it('writes heartbeat success file after receipt confirmation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(123_000);
    const hash = `0x${'a'.repeat(64)}` as const;
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 123n,
    });
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://rpc.example',
    });

    await expect(heartbeat.callHeartbeat()).resolves.toEqual({ txHash: hash });

    expect(viemMocks.writeContract.mock.calls[0]?.[0]).not.toHaveProperty('gas');
    expect(existsSync(heartbeatSuccessFile)).toBe(true);
    expect(readFileSync(heartbeatSuccessFile, 'utf8')).toBe('123');
  });

  it('sends heartbeat with an explicit gas limit when configured', async () => {
    const hash = `0x${'a'.repeat(64)}` as const;
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 123n,
    });
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://rpc.example',
      gasLimit: 25_000_000n,
    });

    await expect(heartbeat.callHeartbeat()).resolves.toEqual({ txHash: hash });

    expect(viemMocks.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 25_000_000n }),
    );
  });

  it('swallows EACCES when heartbeat success file cannot be written', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unwritableDir = mkdtempSync(join(tmpdir(), 'heartbeat-success-'));
    chmodSync(unwritableDir, 0o500);

    try {
      expect(() => writeHeartbeatSuccessFile(join(unwritableDir, 'success'))).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        '[heartbeatSuccessFile] heartbeat success file write failed:',
        expect.objectContaining({ code: 'EACCES' }),
      );
    } finally {
      chmodSync(unwritableDir, 0o700);
      rmSync(unwritableDir, { recursive: true, force: true });
      warn.mockRestore();
    }
  });

  it('reads heartbeatIntervalSeconds from the canonical ABI', async () => {
    viemMocks.readContract.mockResolvedValue(42n);
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://rpc.example',
    });

    await expect(heartbeat.readHeartbeatIntervalSeconds()).resolves.toBe(42);
    expect(viemMocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0x0000000000000000000000000000000000000001',
        functionName: 'heartbeatIntervalSeconds',
        args: [],
      }),
    );
  });

  it('posts a best-effort heartbeat webhook after receipt confirmation', async () => {
    const hash = `0x${'a'.repeat(64)}` as const;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 123n,
    });
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://rpc.example',
      convexWebhookUrl: 'https://convex.example',
      webhookSharedSecret: 'shared-secret',
    });

    await expect(heartbeat.callHeartbeat()).resolves.toEqual({ txHash: hash });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://convex.example/api/heartbeat-webhook');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer shared-secret',
      },
    });
    expect(JSON.parse(init.body)).toMatchObject({
      engineAddress: '0x0000000000000000000000000000000000000001',
      txHash: hash,
      blockNumber: 123,
      source: 'ts-runner',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports heartbeat success when webhook URL is malformed', async () => {
    const hash = `0x${'a'.repeat(64)}` as const;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 123n,
    });
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://rpc.example',
      convexWebhookUrl: 'not-a-url',
    });

    await expect(heartbeat.callHeartbeat()).resolves.toEqual({ txHash: hash });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[RunnerCastHeartbeat] heartbeat webhook POST failed:',
      expect.any(TypeError),
    );
    warn.mockRestore();
  });

  it('bounds hung heartbeat webhook POSTs with a timeout', async () => {
    const hash = `0x${'a'.repeat(64)}` as const;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn((_url: URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 123n,
    });
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://rpc.example',
      convexWebhookUrl: 'https://convex.example',
    });

    const result = heartbeat.callHeartbeat();

    await expect(result).resolves.toEqual({ txHash: hash });
    expect(warn).toHaveBeenCalledWith(
      '[RunnerCastHeartbeat] heartbeat webhook POST failed:',
      expect.any(Error),
    );
    warn.mockRestore();
  }, 7_000);

  it('detects a mined rate-limit revert using the reverted block timestamp, not wall clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(135_000);
    const hash = `0x${'a'.repeat(64)}` as const;
    viemMocks.writeContract.mockResolvedValue(hash);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      blockNumber: 7n,
    });
    viemMocks.readContract.mockResolvedValue({ nextHeartbeatAtTs: 130n });
    viemMocks.getBlock.mockResolvedValue({ timestamp: 127n });

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://rpc.example',
    });

    const err = await heartbeat.callHeartbeat().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(HeartbeatRateLimitedError);
    expect(viemMocks.getBlock).toHaveBeenCalledWith({ blockNumber: 7n });
  });

  it('does NOT use wall-clock Date.now() to classify a mined revert when the block timestamp is unreadable', async () => {
    // MUTATION GUARD (super-swarm #683 HIGH, 2026-06-14): the classifier must
    // derive "still in window?" from the on-chain block timestamp ONLY. If the
    // block read fails it must fail CONSERVATIVELY (real failure, NOT a benign
    // rate-limit). The pre-fix code did `.catch(() => Date.now())`, so with a
    // wall clock BEHIND nextHeartbeatAtTs it would wrongly upgrade a real mined
    // revert to HeartbeatRateLimitedError, masking the fault. This test reverts
    // (fails) if the wall-clock fallback is reintroduced.
    vi.useFakeTimers();
    // Wall clock = 100s, nextHeartbeatAtTs = 130s ⇒ Date.now() < next*1000, so the
    // OLD wall-clock fallback would (wrongly) classify this as rate-limited.
    vi.setSystemTime(100_000);
    try {
      const hash = `0x${'b'.repeat(64)}` as const;
      viemMocks.writeContract.mockResolvedValue(hash);
      viemMocks.waitForTransactionReceipt.mockResolvedValue({
        status: 'reverted',
        blockNumber: 9n,
      });
      viemMocks.readContract.mockResolvedValue({ nextHeartbeatAtTs: 130n });
      // Block timestamp genuinely unreadable — no on-chain basis to classify.
      viemMocks.getBlock.mockRejectedValue(new Error('rpc getBlock unavailable'));

      const heartbeat = new RunnerCastHeartbeat({
        privateKey: '1'.repeat(64),
        contractAddress: '0x0000000000000000000000000000000000000001',
        rpcUrl: 'https://rpc.example',
      });

      const err = await heartbeat.callHeartbeat().then(() => null, (e: unknown) => e);
      // Conservative fail: surfaced as a real revert, NOT a benign rate-limit.
      expect(err).not.toBeInstanceOf(HeartbeatRateLimitedError);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/reverted on-chain/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('advances a dev fork to the requested heartbeat timestamp and mines a block', async () => {
    viemMocks.getBlock.mockResolvedValue({ timestamp: 10n });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ result: '0x1' }),
    } satisfies Partial<Response>);
    vi.stubGlobal('fetch', fetch);
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'http://anvil-fork:8545',
      advanceForkTime: true,
    });

    await expect(heartbeat.advanceForkTimeTo(12)).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith(
      'http://anvil-fork:8545',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"method":"evm_setNextBlockTimestamp"'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://anvil-fork:8545',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"method":"evm_mine"'),
      }),
    );
  });

  it('does not move fork time backward when the chain timestamp is already ahead', async () => {
    viemMocks.getBlock.mockResolvedValue({ timestamp: 130n });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'http://anvil-fork:8545',
      advanceForkTime: true,
    });

    await expect(heartbeat.advanceForkTimeTo(120)).resolves.toBe(false);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses fork time RPCs against a non-local URL even if constructed enabled', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://base-sepolia.example',
      advanceForkTime: true,
    });

    await expect(heartbeat.advanceForkTimeTo(120)).rejects.toThrow(/non-local RPC URL/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes chain time before evm_increaseTime fallback delta', async () => {
    viemMocks.getBlock
      .mockResolvedValueOnce({ timestamp: 10n })
      .mockResolvedValueOnce({ timestamp: 11n });
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ error: { message: 'set timestamp unsupported' } }),
      } satisfies Partial<Response>)
      .mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ result: '0x1' }),
      } satisfies Partial<Response>);
    vi.stubGlobal('fetch', fetch);
    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'http://anvil-fork:8545',
      advanceForkTime: true,
    });

    await expect(heartbeat.advanceForkTimeTo(12)).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith(
      'http://anvil-fork:8545',
      expect.objectContaining({
        body: expect.stringContaining('"method":"evm_increaseTime"'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://anvil-fork:8545',
      expect.objectContaining({
        body: expect.stringContaining('"params":["0x1"]'),
      }),
    );
  });

  it('detects a viem-wrapped rate-limit revert by reason ALONE (no timestamp help)', async () => {
    // viem wraps the on-chain revert in a BaseError (e.g. ContractFunctionExecutionError)
    // whose cause is the ContractFunctionRevertedError; a bare `instanceof` misses it.
    // Crucially: the readNextHeartbeatAtTs() read FAILS here, so the timestamp fallback
    // cannot fire — only the reason-based detection can. This is the load-bearing case
    // (the prod failure mode) and it fails on pre-fix code.
    const reverted = new ContractFunctionRevertedError({
      abi: HEARTBEAT_ABI_FRAGMENT,
      functionName: 'heartbeat',
      data: encodeErrorResult({
        abi: ERROR_STRING_ABI,
        errorName: 'Error',
        args: ['ClanWorld: heartbeat rate limited'],
      }),
    });
    const wrapped = new BaseError('Execution reverted for an unknown reason.', { cause: reverted });
    viemMocks.writeContract.mockRejectedValue(wrapped);
    viemMocks.readContract.mockRejectedValue(new Error('rpc unavailable'));

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://rpc.example',
    });

    const err = await heartbeat.callHeartbeat().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(HeartbeatRateLimitedError);
  });

  it('does NOT mis-classify a world-paused revert as rate-limited even when nextHeartbeatAtTs is in the future', async () => {
    // heartbeat() runs _requireWorldNotPaused() BEFORE the rate-limit guard, so a
    // paused world reverts with a DIFFERENT decoded reason. With nextHeartbeatAtTs
    // far in the future, a naive timestamp-fallback would wrongly upgrade this to a
    // rate-limit (masking the real fault). The decoded reason must win.
    const reverted = new ContractFunctionRevertedError({
      abi: HEARTBEAT_ABI_FRAGMENT,
      functionName: 'heartbeat',
      data: encodeErrorResult({
        abi: ERROR_STRING_ABI,
        errorName: 'Error',
        args: ['ClanWorld: world paused'],
      }),
    });
    const wrapped = new BaseError('Execution reverted for an unknown reason.', { cause: reverted });
    viemMocks.writeContract.mockRejectedValue(wrapped);
    viemMocks.readContract.mockResolvedValue({ nextHeartbeatAtTs: 9_999_999_999n });

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://rpc.example',
    });

    const err = await heartbeat.callHeartbeat().then(() => null, (e: unknown) => e);
    expect(err).not.toBeInstanceOf(HeartbeatRateLimitedError);
    expect(err).toBe(wrapped);
  });

  it('falls back to the timestamp heuristic for an UNDECODED revert (no reason)', async () => {
    // A custom error with no ABI match has no decoded reason; only here may the
    // nextHeartbeatAtTs timestamp heuristic classify it as rate-limited.
    const reverted = new ContractFunctionRevertedError({
      abi: HEARTBEAT_ABI_FRAGMENT,
      functionName: 'heartbeat',
      data: '0xdeadbeef',
    });
    expect(reverted.reason).toBeUndefined(); // guards the test's premise
    const wrapped = new BaseError('Execution reverted for an unknown reason.', { cause: reverted });
    viemMocks.writeContract.mockRejectedValue(wrapped);
    viemMocks.readContract.mockResolvedValue({ nextHeartbeatAtTs: 9_999_999_999n });
    // Classification derives from on-chain time (latest block), NOT wall clock:
    // chain now (1_000s) < nextHeartbeatAtTs (9_999_999_999s) ⇒ still in window.
    viemMocks.getBlock.mockResolvedValue({ timestamp: 1_000n });

    const heartbeat = new RunnerCastHeartbeat({
      privateKey: '1'.repeat(64),
      contractAddress: '0x0000000000000000000000000000000000000001',
      rpcUrl: 'https://rpc.example',
    });

    const err = await heartbeat.callHeartbeat().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(HeartbeatRateLimitedError);
  });
});
