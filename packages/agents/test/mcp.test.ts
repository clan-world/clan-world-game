import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IChainClient, IConvexClient } from '@clan-world/shared/adapters';
import type { ClanFullView, Tick, WorldSnapshot } from '@clan-world/shared';
import { callElderTool } from '../src/mcp.js';
import { ackFile, inboxFile, memoryFile } from '../src/cli.js';
import type { WalrusKvStore } from '../src/walrusKvStore.js';

/** Minimal in-memory fake WalrusKvStore for wiring tests. */
function makeWalrusKv(opts: {
  available?: boolean;
  saveOk?: boolean;
  recallValue?: string | undefined;
  onSave?: (key: string, value: string) => void;
} = {}): WalrusKvStore {
  return {
    async isAvailable() { return opts.available ?? true; },
    async save(key: string, value: string) {
      opts.onSave?.(key, value);
      return opts.saveOk === false
        ? { ok: false as const, reason: 'fake-unavailable' }
        : { ok: true as const, blobId: 'fakeblob' };
    },
    async recall(_key: string) { return opts.recallValue; },
  } as unknown as WalrusKvStore;
}

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
    async mirrorMemoryEntry() {},
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
  it('clan_view defaults clanId from ELDER_N', async () => {
    const calls: string[] = [];
    const out = await callElderTool('clan_view', {}, {
      convex: makeConvex(),
      chain: makeChain({
        async getClanFullView(clanId) {
          calls.push(clanId);
          return { ...STUB_CLAN_VIEW, clan: { ...STUB_CLAN_VIEW.clan, id: clanId } };
        },
      }),
      env: { ELDER_N: '3' },
      homeBase: tmpDir,
    });

    const parsed = JSON.parse(out.content[0]?.text ?? '') as ClanFullView;
    expect(parsed.clan.id).toBe('3');
    expect(calls).toEqual(['3']);
  });

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

  it('memory_recall returns no-memory text for missing key', async () => {
    const out = await callElderTool('memory_recall', { key: 'active-strategy' }, {
      convex: makeConvex(),
      chain: makeChain(),
      env: { ELDER_N: '1' },
      homeBase: tmpDir,
    });

    expect(out.content[0]?.text).toBe('no memory for active-strategy');
  });

  it('memory_save then memory_recall round-trips a value', async () => {
    const deps = {
      convex: makeConvex(),
      chain: makeChain(),
      env: { ELDER_N: '1' },
      homeBase: tmpDir,
    };

    const saved = await callElderTool('memory_save', { key: 'active-strategy', value: 'deposit fish at base 6' }, deps);
    const recalled = await callElderTool('memory_recall', { key: 'active-strategy' }, deps);

    expect(saved.content[0]?.text).toBe('saved active-strategy');
    expect(recalled.content[0]?.text).toBe('deposit fish at base 6');
  });

  it('peer_inbox reads newline-separated messages for ELDER_N', async () => {
    const file = inboxFile(2, tmpDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'first message\nsecond message\n', 'utf8');

    const out = await callElderTool('peer_inbox', {}, {
      convex: makeConvex(),
      chain: makeChain(),
      env: { ELDER_N: '2' },
      homeBase: tmpDir,
    });

    expect(out.content[0]?.text).toBe('first message\nsecond message');
  });

  it('ack_clear writes the ack flag for ELDER_N', async () => {
    const out = await callElderTool('ack_clear', {}, {
      convex: makeConvex(),
      chain: makeChain(),
      env: { ELDER_N: '4' },
      homeBase: tmpDir,
    });

    expect(out.content[0]?.text).toBe('ack cleared');
    expect(fs.existsSync(ackFile(4, tmpDir))).toBe(true);
  });

  it('memory_save writes the local file AND mirrors a successful Walrus save to Convex (source: walrus)', async () => {
    const mirrors: Array<{ clanId: number; key: string; value: string; source: string }> = [];
    let savedToWalrus: { key: string; value: string } | undefined;
    const out = await callElderTool(
      'memory_save',
      { key: 'active-strategy', value: 'hold the ridge' },
      {
        convex: makeConvex({
          async mirrorMemoryEntry(args) { mirrors.push(args); },
        }),
        chain: makeChain(),
        env: { ELDER_N: '3' },
        homeBase: tmpDir,
        walrusKv: makeWalrusKv({ onSave: (key, value) => { savedToWalrus = { key, value }; } }),
      },
    );

    expect(out.content[0]?.text).toBe('saved active-strategy');
    // Local file path preserved.
    const file = JSON.parse(fs.readFileSync(memoryFile(3, tmpDir), 'utf8'));
    expect(file['active-strategy']).toBe('hold the ridge');
    // Walrus write happened.
    expect(savedToWalrus).toEqual({ key: 'active-strategy', value: 'hold the ridge' });
    // Convex mirror happened with source "walrus" + the elder's clanId.
    expect(mirrors).toEqual([
      { clanId: 3, key: 'active-strategy', value: 'hold the ridge', source: 'walrus' },
    ]);
  });

  it('memory_save still succeeds + writes the file when Walrus is unavailable (no mirror)', async () => {
    const mirrors: unknown[] = [];
    const out = await callElderTool(
      'memory_save',
      { key: 'k', value: 'v' },
      {
        convex: makeConvex({ async mirrorMemoryEntry(args) { mirrors.push(args); } }),
        chain: makeChain(),
        env: { ELDER_N: '1' },
        homeBase: tmpDir,
        walrusKv: makeWalrusKv({ saveOk: false }),
      },
    );

    expect(out.content[0]?.text).toBe('saved k');
    const file = JSON.parse(fs.readFileSync(memoryFile(1, tmpDir), 'utf8'));
    expect(file['k']).toBe('v');
    expect(mirrors).toEqual([]); // no mirror when Walrus save failed
  });

  it('memory_recall prefers a Walrus hit over the local file', async () => {
    fs.mkdirSync(path.dirname(memoryFile(2, tmpDir)), { recursive: true });
    fs.writeFileSync(memoryFile(2, tmpDir), JSON.stringify({ k: 'file-value' }));
    const out = await callElderTool(
      'memory_recall',
      { key: 'k' },
      {
        convex: makeConvex(),
        chain: makeChain(),
        env: { ELDER_N: '2' },
        homeBase: tmpDir,
        walrusKv: makeWalrusKv({ recallValue: 'walrus-value' }),
      },
    );
    expect(out.content[0]?.text).toBe('walrus-value');
  });

  it('memory_recall falls back to the local file when Walrus has no hit', async () => {
    fs.mkdirSync(path.dirname(memoryFile(2, tmpDir)), { recursive: true });
    fs.writeFileSync(memoryFile(2, tmpDir), JSON.stringify({ k: 'file-value' }));
    const out = await callElderTool(
      'memory_recall',
      { key: 'k' },
      {
        convex: makeConvex(),
        chain: makeChain(),
        env: { ELDER_N: '2' },
        homeBase: tmpDir,
        walrusKv: makeWalrusKv({ recallValue: undefined }),
      },
    );
    expect(out.content[0]?.text).toBe('file-value');
  });
});
