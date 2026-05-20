import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IChainClient, IConvexClient } from '@clan-world/shared/adapters';
import type { ClanFullView, Tick, WorldSnapshot } from '@clan-world/shared';
import { callElderTool } from '../src/mcp.js';

const STUB_SNAPSHOT: WorldSnapshot = {
  tick: 9,
  tickEpoch: { startedAt: 1700000000, durationMs: 60000 },
  regions: [],
  clans: [],
};

const STUB_CLAN_VIEW: ClanFullView = {
  clan: { id: '1', name: 'Wolfclan', treasury: '1000' },
  controlledRegions: [],
  pendingOrders: [],
  whispers: [],
};

function makeConvex(overrides: Partial<IConvexClient> = {}): IConvexClient {
  return {
    async getSnapshot() { return STUB_SNAPSHOT; },
    async getClanFullView() { return STUB_CLAN_VIEW; },
    async postLog() {},
    async postRunnerStatus() {},
    async postWhisper() {},
    async postOrchEvent() {},
    async postHumanSteering() {},
    async postBulletin() {},
    ...overrides,
  };
}

function makeChain(overrides: Partial<IChainClient> = {}): IChainClient {
  return {
    async submitOrders() { return { txHash: '0xorders', results: [] }; },
    async getCurrentTick(): Promise<Tick> { return 0; },
    async getClanFullView(clanId: string): Promise<ClanFullView> {
      return { ...STUB_CLAN_VIEW, clan: { ...STUB_CLAN_VIEW.clan, id: clanId } };
    },
    async getWallUpgradeCost() { return { wood: 0n, iron: 0n }; },
    async getBaseUpgradeCost() { return { wood: 0n, iron: 0n, wheat: 0n }; },
    async getMonumentUpgradeCost() { return { wood: 0n, iron: 0n, wheat: 0n, blueprint: 0n }; },
    async quoteTravel() { return { travelTicks: 0, path: '0x0000000000000000' as `0x${string}` }; },
    async getClanScore() { return { score: 0n, monumentReachedAtTick: 0n, monumentLevel: 0 }; },
    async getRankings() { return { clanIdsRanked: [], scores: [] }; },
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elder-mcp-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('elder MCP tools', () => {
  it('submit_orders accepts direct JSON and defaults clanId from ELDER_N', async () => {
    const calls: Array<{ clanId: string; orders: unknown[] }> = [];
    const deps = {
      convex: makeConvex(),
      chain: makeChain({
        async submitOrders(clanId, orders) {
          calls.push({ clanId, orders });
          return { txHash: '0xorders', results: [] };
        },
      }),
      env: { ELDER_N: '2' },
      homeBase: tmpDir,
    };

    const out = await callElderTool('submit_orders', { orders: [{ kind: 'mission', payload: { clansmanId: 1 } }] }, deps);

    expect(out.content[0]?.text).toContain('0xorders');
    expect(calls).toEqual([{ clanId: '2', orders: [{ kind: 'mission', payload: { clansmanId: 1 } }] }]);
  });

  it('submit_orders rejects cross-clan submissions', async () => {
    await expect(
      callElderTool('submit_orders', { clanId: '3', orders: [] }, {
        convex: makeConvex(),
        chain: makeChain(),
        env: { ELDER_N: '2' },
        homeBase: tmpDir,
      }),
    ).rejects.toThrow(/cross-clan access denied/);
  });

  it('post_bulletin accepts direct JSON and uses the current snapshot tick', async () => {
    const posted: Array<{ clanId: number; slot: number; body: string }> = [];
    const out = await callElderTool('post_bulletin', { body: 'public defense bid' }, {
      convex: makeConvex({
        async postBulletin(args) {
          posted.push(args);
        },
      }),
      chain: makeChain(),
      env: { ELDER_N: '4' },
      homeBase: tmpDir,
    });

    expect(out.content[0]?.text).toBe('bulletin posted');
    expect(posted).toEqual([{ clanId: 4, slot: 9, body: 'public defense bid' }]);
  });
});
