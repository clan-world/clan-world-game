import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  RunnerCastHeartbeat,
} from '../src/runnerCastHeartbeat';
import { writeHeartbeatSuccessFile } from '../src/heartbeatSuccessFile';

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

    expect(existsSync(heartbeatSuccessFile)).toBe(true);
    expect(readFileSync(heartbeatSuccessFile, 'utf8')).toBe('123');
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
});
