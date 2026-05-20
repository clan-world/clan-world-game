import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { configFromEnv, RunnerCastHeartbeat } from '../src/runnerCastHeartbeat';

beforeEach(() => {
  viemMocks.readContract.mockReset();
  viemMocks.waitForTransactionReceipt.mockReset();
  viemMocks.writeContract.mockReset();
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
});

describe('RunnerCastHeartbeat', () => {
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
});
