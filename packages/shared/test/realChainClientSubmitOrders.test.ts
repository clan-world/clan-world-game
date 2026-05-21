import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClanOrder } from '../src/types';
import { ActionType } from '../src/generated/enums';

const mocks = vi.hoisted(() => {
  const readContract = vi.fn(async () => [3, '0x0102030000000000']);
  const writeContract = vi.fn(
    async (_request: unknown) => `0x${'12'.repeat(32)}`,
  );
  const simulateContract = vi.fn(
    async (request: { args: [number, ContractOrder[]] }) => ({
      result: request.args[1].map((order) => ({
        clansmanId: BigInt(order.clansmanId),
        status: 0,
        cooldownEndsAtTs: 0n,
        missionNonce: 1n,
        marketMode: 0,
      })),
      request,
    }),
  );

  return { readContract, simulateContract, writeContract };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');

  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: mocks.readContract,
      simulateContract: mocks.simulateContract,
    })),
    createWalletClient: vi.fn(() => ({
      writeContract: mocks.writeContract,
    })),
    http: vi.fn((url?: string) => ({ type: 'http', url })),
    fallback: vi.fn((transports: unknown[]) => ({
      type: 'fallback',
      transports,
    })),
  };
});

import { createChainClient } from '../src/adapters/IChainClient';

interface ContractOrder {
  clansmanId: number;
  gotoRegion: number;
  action: number;
  targetClanId: number;
  marketToken: `0x${string}`;
  marketAmount: bigint;
  maxGoldIn: bigint;
  withdrawResources: {
    wood: bigint;
    iron: bigint;
    wheat: bigint;
    fish: bigint;
  };
}

const submitAndCaptureOrders = async (
  orders: ClanOrder[],
): Promise<ContractOrder[]> => {
  const client = createChainClient();

  await client.submitOrders('2', orders);

  const request = mocks.writeContract.mock.calls.at(-1)?.[0] as unknown as {
    args: [number, ContractOrder[]];
  };
  return request.args[1];
};

const mission = (payload: Record<string, unknown>): ClanOrder => ({
  kind: 'mission',
  payload: {
    clansmanId: 7,
    gotoRegion: 1,
    ...payload,
  },
});

describe('RealChainClient.submitOrders order field mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAN_WORLD_USE_STUB_CHAIN = 'false';
    process.env.CLAN_WORLD_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000def';
    process.env.DEPLOYER_PRIVATE_KEY = '11'.repeat(32);
    process.env.ALLOW_DEPLOYER_KEY_FALLBACK = 'true';
    process.env.CLAN_WORLD_LENS_ADDRESS = '0x0000000000000000000000000000000000000abc';
    delete process.env.ELDER_WALLET_KEY_PATH;
  });

  it('preserves DefendBase targetClanId', async () => {
    const orders = await submitAndCaptureOrders([
      mission({ action: ActionType.DefendBase, targetClanId: 5 }),
    ]);
    const order = orders[0]!;

    expect(order.targetClanId).toBe(5);
  });

  it('preserves MarketBuy market fields', async () => {
    const marketToken = '0x00000000000000000000000000000000000000a1';

    const orders = await submitAndCaptureOrders([
      mission({
        action: ActionType.MarketBuy,
        marketToken,
        marketAmount: '3000000000000000000',
        maxGoldIn: 42n,
      }),
    ]);
    const order = orders[0]!;

    expect(order.marketToken).toBe(marketToken);
    expect(order.marketAmount).toBe(3000000000000000000n);
    expect(order.maxGoldIn).toBe(42n);
  });

  it('preserves MarketSell marketAmount', async () => {
    const orders = await submitAndCaptureOrders([
      mission({ action: ActionType.MarketSell, marketAmount: 99n }),
    ]);
    const order = orders[0]!;

    expect(order.marketAmount).toBe(99n);
  });

  it('keeps default fields for basic chop wood and deposit orders', async () => {
    const orders = await submitAndCaptureOrders([
      mission({ action: ActionType.ChopWood }),
      mission({ action: ActionType.DepositResources }),
    ]);
    const chop = orders[0]!;
    const deposit = orders[1]!;

    expect(chop.targetClanId).toBe(0);
    expect(chop.marketToken).toBe('0x0000000000000000000000000000000000000000');
    expect(chop.marketAmount).toBe(0n);
    expect(chop.maxGoldIn).toBe(0n);
    expect(deposit.targetClanId).toBe(0);
    expect(deposit.marketToken).toBe('0x0000000000000000000000000000000000000000');
    expect(deposit.marketAmount).toBe(0n);
    expect(deposit.maxGoldIn).toBe(0n);
  });

  it('keeps withdrawResources mapping unchanged', async () => {
    const orders = await submitAndCaptureOrders([
      mission({
        action: ActionType.WithdrawResources,
        withdrawResources: {
          wood: 1,
          iron: '2',
          wheat: 3n,
          fish: null,
        },
      }),
    ]);
    const order = orders[0]!;

    expect(order.withdrawResources).toEqual({
      wood: 1n,
      iron: 2n,
      wheat: 3n,
      fish: 0n,
    });
  });

  it('reads quoteTravel from the configured lens address', async () => {
    const client = createChainClient();

    const result = await client.quoteTravel(1, 8);

    expect(result).toEqual({
      travelTicks: 3,
      path: '0x0102030000000000',
    });
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0x0000000000000000000000000000000000000abc',
        functionName: 'quoteTravel',
        args: [1, 8],
      }),
    );
  });

  it('fails loudly when CLAN_WORLD_LENS_ADDRESS is missing', () => {
    const previous = process.env.CLAN_WORLD_LENS_ADDRESS;
    delete process.env.CLAN_WORLD_LENS_ADDRESS;

    try {
      expect(() => createChainClient()).toThrowError(
        'CLAN_WORLD_LENS_ADDRESS must be set to a 0x-prefixed 20-byte address; see .env.template',
      );
    } finally {
      if (previous === undefined) delete process.env.CLAN_WORLD_LENS_ADDRESS;
      else process.env.CLAN_WORLD_LENS_ADDRESS = previous;
    }
  });

  it('fails loudly when CLAN_WORLD_LENS_ADDRESS is empty/whitespace', () => {
    const previous = process.env.CLAN_WORLD_LENS_ADDRESS;
    process.env.CLAN_WORLD_LENS_ADDRESS = '   ';

    try {
      expect(() => createChainClient()).toThrowError(
        'CLAN_WORLD_LENS_ADDRESS must be set to a 0x-prefixed 20-byte address; see .env.template',
      );
    } finally {
      if (previous === undefined) delete process.env.CLAN_WORLD_LENS_ADDRESS;
      else process.env.CLAN_WORLD_LENS_ADDRESS = previous;
    }
  });

  it('fails loudly when CLAN_WORLD_LENS_ADDRESS is malformed (not 0x+40 hex)', () => {
    const previous = process.env.CLAN_WORLD_LENS_ADDRESS;
    process.env.CLAN_WORLD_LENS_ADDRESS = '0x123';

    try {
      expect(() => createChainClient()).toThrowError(
        'CLAN_WORLD_LENS_ADDRESS must be set to a 0x-prefixed 20-byte address; see .env.template',
      );
    } finally {
      if (previous === undefined) delete process.env.CLAN_WORLD_LENS_ADDRESS;
      else process.env.CLAN_WORLD_LENS_ADDRESS = previous;
    }
  });
});
