import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IConvexClient, IChainClient } from '@clan-world/shared/adapters';
import type { WorldSnapshot, ClanFullView, Tick } from '@clan-world/shared';
import { runCommand, UsageError, inboxFile, recipientInboxFile, ackFile, resolveHelp } from '../src/cli.js';

// ---------------------------------------------------------------------------
// Stub data
// ---------------------------------------------------------------------------

const STUB_SNAPSHOT: WorldSnapshot = {
  tick: 7,
  tickEpoch: { startedAt: 1700000000, durationMs: 60000 },
  regions: [{ id: 'r1', name: 'Forest', ownerClanId: '1' }],
  clans: [{ id: '1', name: 'Wolfclan', treasury: '1000' }],
};

const STUB_CLAN_VIEW: ClanFullView = {
  clan: { id: '1', name: 'Wolfclan', treasury: '1000' },
  controlledRegions: [{ id: 'r1', name: 'Forest', ownerClanId: '1' }],
  pendingOrders: [],
  whispers: [],
};

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

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
    async submitOrders() { return { txHash: '0xdeadbeef', results: [] }; },
    async getCurrentTick(_signal?: AbortSignal): Promise<Tick> { return 0; },
    async getClanFullView(clanId: string): Promise<ClanFullView> {
      return {
        clan: { id: clanId, name: `chain-${clanId}`, treasury: '0' },
        controlledRegions: [],
        pendingOrders: [],
        whispers: [],
      };
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

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let deps: { convex: ReturnType<typeof makeConvex>; chain: ReturnType<typeof makeChain> };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elder-cli-test-'));
  deps = { convex: makeConvex(), chain: makeChain() };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// world snapshot
// ---------------------------------------------------------------------------

describe('world snapshot', () => {
  it('returns JSON-parseable WorldSnapshot with correct tick', async () => {
    const out = await runCommand('world', 'snapshot', [], deps, {}, tmpDir);
    const parsed = JSON.parse(out) as WorldSnapshot;
    expect(parsed.tick).toBe(7);
    expect(parsed.regions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// clan view
// ---------------------------------------------------------------------------

describe('clan view', () => {
  it('returns ClanFullView with correct clan name', async () => {
    const out = await runCommand('clan', 'view', ['1'], deps, {}, tmpDir);
    const parsed = JSON.parse(out) as ClanFullView;
    expect(parsed.clan.name).toBe('chain-1');
    expect(parsed.clan.id).toBe('1');
  });

  it('throws UsageError when clanId is missing', async () => {
    await expect(
      runCommand('clan', 'view', [], deps, {}, tmpDir),
    ).rejects.toBeInstanceOf(UsageError);
  });
});

// ---------------------------------------------------------------------------
// clan submit-orders
// ---------------------------------------------------------------------------

describe('clan submit-orders', () => {
  it('reads orders file, calls chain.submitOrders, returns txHash', async () => {
    const ordersFile = path.join(tmpDir, 'orders.json');
    fs.writeFileSync(ordersFile, JSON.stringify({ clanId: '1', orders: [{ kind: 'mission', payload: {} }] }));
    const out = await runCommand('clan', 'submit-orders', [ordersFile], deps, { ELDER_N: '1' }, tmpDir);
    expect(out).toContain('0xdeadbeef');
  });

  it('throws UsageError when file does not exist', async () => {
    await expect(
      runCommand('clan', 'submit-orders', [path.join(tmpDir, 'no-such-file.json')], deps, {}, tmpDir),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it('throws UsageError on bad JSON', async () => {
    const badFile = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badFile, 'not valid json {{');
    await expect(
      runCommand('clan', 'submit-orders', [badFile], deps, {}, tmpDir),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it('throws UsageError when clanId is missing from file', async () => {
    const ordersFile = path.join(tmpDir, 'orders.json');
    fs.writeFileSync(ordersFile, JSON.stringify({ orders: [{ kind: 'mission', payload: {} }] }));
    await expect(
      runCommand('clan', 'submit-orders', [ordersFile], deps, {}, tmpDir),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it('throws UsageError when orders is not an array', async () => {
    const ordersFile = path.join(tmpDir, 'orders.json');
    fs.writeFileSync(ordersFile, JSON.stringify({ clanId: '1', orders: 'not-an-array' }));
    await expect(
      runCommand('clan', 'submit-orders', [ordersFile], deps, {}, tmpDir),
    ).rejects.toBeInstanceOf(UsageError);
  });
});

// ---------------------------------------------------------------------------
// memory recall / save
// ---------------------------------------------------------------------------

describe('memory recall/save', () => {
  const env = { ELDER_N: '1' };

  it('recall with no saved memory returns "no memory for <key>"', async () => {
    const out = await runCommand('memory', 'recall', ['strategy'], deps, env, tmpDir);
    expect(out).toBe('no memory for strategy\n');
  });

  it('save + recall round-trips value (including multi-word)', async () => {
    await runCommand('memory', 'save', ['plan', 'expand', 'east', 'now'], deps, env, tmpDir);
    const out = await runCommand('memory', 'recall', ['plan'], deps, env, tmpDir);
    expect(out.trim()).toBe('expand east now');
  });

  it('throws UsageError when topic is missing from recall', async () => {
    await expect(
      runCommand('memory', 'recall', [], deps, env, tmpDir),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it('throws UsageError when value is missing from save', async () => {
    await expect(
      runCommand('memory', 'save', ['key'], deps, env, tmpDir),
    ).rejects.toBeInstanceOf(UsageError);
  });
});

// ---------------------------------------------------------------------------
// peer whisper
// ---------------------------------------------------------------------------

describe('peer whisper', () => {
  it('rejects unsafe recipient clan ids before resolving an inbox path', async () => {
    await expect(
      runCommand('peer', 'whisper', ['../escape', 'attack at dawn'], deps, { ELDER_N: '2' }, tmpDir),
    ).rejects.toThrow(/unsafe inbox key/);
    expect(fs.existsSync(path.join(tmpDir, '.world', 'clanworld-runner', 'state', 'escape.jsonl'))).toBe(false);
  });

  it('allows safe hyphenated recipient clan ids', async () => {
    await runCommand('peer', 'whisper', ['valid-clan', 'hold position'], deps, { ELDER_N: '2' }, tmpDir);
    expect(fs.existsSync(recipientInboxFile('valid-clan', tmpDir))).toBe(true);
  });

  it('writes JSON line to recipientInboxFile with correct from/to/msg', async () => {
    await runCommand('peer', 'whisper', ['5', 'attack at dawn'], deps, { ELDER_N: '2' }, tmpDir);

    const file = recipientInboxFile('5', tmpDir);
    expect(fs.existsSync(file)).toBe(true);

    const line = fs.readFileSync(file, 'utf8').trim();
    const entry = JSON.parse(line) as { from: number; to: string; msg: string };
    expect(entry.from).toBe(2);
    expect(entry.to).toBe('5');
    expect(entry.msg).toBe('attack at dawn');
  });

  it('mirrors successful local whispers to Convex best-effort', async () => {
    const postWhisper = vi.fn().mockResolvedValue(undefined);
    const getCurrentTick = vi.fn().mockResolvedValue(42);
    deps = {
      convex: makeConvex({ postWhisper }),
      chain: makeChain({ getCurrentTick }),
    };

    await runCommand('peer', 'whisper', ['5', 'attack at dawn'], deps, { ELDER_N: '2' }, tmpDir);

    expect(postWhisper).toHaveBeenCalledWith(expect.objectContaining({
      tick: 42,
      fromClanId: 2,
      toClanIds: [5],
      body: 'attack at dawn',
    }));
    expect(postWhisper.mock.calls[0]?.[0].msgId).toMatch(/^2:42:/);
  });

  it('keeps the local whisper when Convex mirroring fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deps = {
      convex: makeConvex({ postWhisper: vi.fn().mockRejectedValue(new Error('convex down')) }),
      chain: makeChain(),
    };

    await expect(
      runCommand('peer', 'whisper', ['5', 'attack at dawn'], deps, { ELDER_N: '2' }, tmpDir),
    ).resolves.toBe('whisper sent\n');
    expect(fs.existsSync(recipientInboxFile('5', tmpDir))).toBe(true);

    warn.mockRestore();
  });

  it('skips cockpit mirror entirely for non-numeric clan ids (local-only inbox key)', async () => {
    const postWhisper = vi.fn().mockResolvedValue(undefined);
    const getCurrentTick = vi.fn().mockResolvedValue(7);
    deps = {
      convex: makeConvex({ postWhisper }),
      chain: makeChain({ getCurrentTick }),
    };

    await expect(
      runCommand('peer', 'whisper', ['valid-clan', 'hold position'], deps, { ELDER_N: '2' }, tmpDir),
    ).resolves.toBe('whisper sent\n');

    expect(fs.existsSync(recipientInboxFile('valid-clan', tmpDir))).toBe(true);
    expect(postWhisper).not.toHaveBeenCalled();
    expect(getCurrentTick).not.toHaveBeenCalled();
  });

  it('keeps the local whisper when chain.getCurrentTick hangs (mirror bounded by timeout)', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const postWhisper = vi.fn().mockResolvedValue(undefined);
    // getCurrentTick stays pending until the timeout aborts it — must not pin the CLI.
    const getCurrentTick = vi.fn().mockImplementation((signal?: AbortSignal) => new Promise<number>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    deps = {
      convex: makeConvex({ postWhisper }),
      chain: makeChain({ getCurrentTick }),
    };

    const runPromise = runCommand('peer', 'whisper', ['5', 'attack at dawn'], deps, { ELDER_N: '2' }, tmpDir);

    // Advance fake timers past the 5s withTimeout window so the mirror rejects + falls into catch.
    await vi.advanceTimersByTimeAsync(5_001);

    await expect(runPromise).resolves.toBe('whisper sent\n');
    expect(fs.existsSync(recipientInboxFile('5', tmpDir))).toBe(true);
    expect(postWhisper).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('cockpit mirror failed'),
      expect.objectContaining({ message: expect.stringContaining('timed out') }),
    );

    warn.mockRestore();
    vi.useRealTimers();
  });

  it('aborts the underlying chain call when timeout fires', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let receivedSignal: AbortSignal | undefined;
    const getCurrentTick = vi.fn().mockImplementation((signal?: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<number>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    deps = {
      convex: makeConvex(),
      chain: makeChain({ getCurrentTick }),
    };

    const runPromise = runCommand('peer', 'whisper', ['5', 'attack'], deps, { ELDER_N: '2' }, tmpDir);
    await vi.advanceTimersByTimeAsync(5_001);
    await runPromise;

    expect(receivedSignal?.aborted).toBe(true);

    warn.mockRestore();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// peer inbox
// ---------------------------------------------------------------------------

describe('peer inbox', () => {
  it('returns "inbox empty" when no messages', async () => {
    const out = await runCommand('peer', 'inbox', [], deps, { ELDER_N: '1' }, tmpDir);
    expect(out).toBe('inbox empty\n');
  });

  it('returns formatted message line after whisper written to own inbox', async () => {
    // Write a whisper entry directly to elder-1's inbox (ELDER_N=1 reads elder-1.jsonl)
    const inboxPath = inboxFile(1, tmpDir);
    fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
    const entry = JSON.stringify({ from: 2, to: '1', msg: 'hello from elder 2', ts: '2024-01-01T00:00:00.000Z' });
    fs.writeFileSync(inboxPath, entry + '\n', 'utf8');

    const out = await runCommand('peer', 'inbox', [], deps, { ELDER_N: '1' }, tmpDir);
    expect(out).toContain('from=2');
    expect(out).toContain('hello from elder 2');
  });
});

// ---------------------------------------------------------------------------
// bulletin post
// ---------------------------------------------------------------------------

describe('bulletin post', () => {
  it('posts a public bulletin for ELDER_N using current snapshot tick as slot', async () => {
    const posted: Array<{ clanId: number; slot: number; body: string }> = [];
    deps.convex = makeConvex({
      async postBulletin(args) {
        posted.push(args);
      },
    });

    const out = await runCommand('bulletin', 'post', ['defense', 'alliance', 'forming'], deps, { ELDER_N: '3' }, tmpDir);

    expect(out).toBe('bulletin posted\n');
    expect(posted).toEqual([{ clanId: 3, slot: 7, body: 'defense alliance forming' }]);
  });

  it('throws UsageError when bulletin body is missing', async () => {
    await expect(
      runCommand('bulletin', 'post', [], deps, { ELDER_N: '3' }, tmpDir),
    ).rejects.toBeInstanceOf(UsageError);
  });
});

// ---------------------------------------------------------------------------
// ack-clear
// ---------------------------------------------------------------------------

describe('ack-clear', () => {
  it('writes the ack flag file and returns "ack cleared"', async () => {
    const out = await runCommand('ack-clear', undefined, [], deps, { ELDER_N: '1' }, tmpDir);
    expect(out).toBe('ack cleared\n');

    const flagPath = ackFile(1, tmpDir);
    expect(fs.existsSync(flagPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// unknown command
// ---------------------------------------------------------------------------

describe('unknown command', () => {
  it('throws UsageError with usage text', async () => {
    await expect(
      runCommand('mystery', 'cmd', [], deps, {}, tmpDir),
    ).rejects.toBeInstanceOf(UsageError);

    try {
      await runCommand('mystery', 'cmd', [], deps, {}, tmpDir);
    } catch (err) {
      expect(err).toBeInstanceOf(UsageError);
      expect((err as UsageError).message).toContain('usage:');
    }
  });
});

// ---------------------------------------------------------------------------
// rules subcommand
// ---------------------------------------------------------------------------

describe('rules subcommand', () => {
  it('returns rules text containing canonical action codes', async () => {
    const out = await runCommand('rules', undefined, [], deps, {}, tmpDir);
    expect(out).toContain('ACTION CODES');
    expect(out).toContain('1  = ChopWood');
    expect(out).toContain('6  = DepositResources');
    expect(out).toContain('14 = WithdrawResources');
  });

  it('rules text references the generated source file', async () => {
    const out = await runCommand('rules', undefined, [], deps, {}, tmpDir);
    expect(out).toContain('generated/');
  });

  it('rules text covers regions, capacities, timing, error codes', async () => {
    const out = await runCommand('rules', undefined, [], deps, {}, tmpDir);
    expect(out).toContain('REGION CODES');
    expect(out).toContain('Forest');
    expect(out).toContain('CLANSMAN_CARRY_CAP');
    expect(out).toContain('SEASON_DURATION_TICKS');
    expect(out).toContain('ERR_CLAN_DEAD');
  });
});

// ---------------------------------------------------------------------------
// resolveHelp — argv parsing for --help / -h before positional consumption
// ---------------------------------------------------------------------------

describe('resolveHelp', () => {
  it('returns top-level help for empty argv', () => {
    const out = resolveHelp([]);
    expect(out).toBeDefined();
    expect(out).toContain('elder — Clan World CLI for Elder agents');
    expect(out).toContain('clan submit-orders');
  });

  it('returns top-level help for --help', () => {
    expect(resolveHelp(['--help'])).toContain('Clan World CLI for Elder agents');
  });

  it('returns top-level help for -h', () => {
    expect(resolveHelp(['-h'])).toContain('Clan World CLI for Elder agents');
  });

  it('returns submit-orders help for `clan submit-orders --help` (the bug elder-1 hit)', () => {
    const out = resolveHelp(['clan', 'submit-orders', '--help']);
    expect(out).toBeDefined();
    expect(out).toContain('elder clan submit-orders <ordersJsonFile>');
    expect(out).toContain('JSON SCHEMA');
    expect(out).toContain('"kind": "mission"');
    expect(out).toContain('"payload":');
    expect(out).toContain('clansmanId');
    expect(out).toContain('COMMON ERRORS');
  });

  it('returns clan-namespace help for `clan --help`', () => {
    const out = resolveHelp(['clan', '--help']);
    expect(out).toBeDefined();
    expect(out).toContain('elder clan <subcommand>');
  });

  it('returns world-snapshot help for `world snapshot --help`', () => {
    const out = resolveHelp(['world', 'snapshot', '--help']);
    expect(out).toBeDefined();
    expect(out).toContain('elder world snapshot');
    expect(out).toContain('tick');
  });

  it('returns rules help for `rules --help`', () => {
    const out = resolveHelp(['rules', '--help']);
    expect(out).toBeDefined();
    expect(out).toContain('elder rules');
  });

  it('returns peer-whisper help for `peer whisper --help`', () => {
    const out = resolveHelp(['peer', 'whisper', '--help']);
    expect(out).toBeDefined();
    expect(out).toContain('elder peer whisper');
  });

  it('returns bulletin-post help for `bulletin post --help`', () => {
    const out = resolveHelp(['bulletin', 'post', '--help']);
    expect(out).toBeDefined();
    expect(out).toContain('elder bulletin post');
  });

  it('returns memory-save help for `memory save --help`', () => {
    const out = resolveHelp(['memory', 'save', '--help']);
    expect(out).toBeDefined();
    expect(out).toContain('elder memory save');
  });

  it('returns ack-clear help for `ack-clear --help`', () => {
    const out = resolveHelp(['ack-clear', '--help']);
    expect(out).toBeDefined();
    expect(out).toContain('elder ack-clear');
  });

  it('returns undefined when no --help flag and args present (let runCommand take over)', () => {
    expect(resolveHelp(['world', 'snapshot'])).toBeUndefined();
    expect(resolveHelp(['clan', 'view', '1'])).toBeUndefined();
    expect(resolveHelp(['clan', 'submit-orders', '/tmp/orders.json'])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Issue #94 regression: peer whisper/inbox desync when ELDER_N != clanId
// ---------------------------------------------------------------------------

describe('issue #94 regression — peer whisper/inbox desync', () => {
  it('demonstrates desync when ELDER_N != clanId', async () => {
    // Issue #94: inbox reads by ELDER_N, whisper writes by clanId.
    // Round-trip works only when clanId === String(elderN) (S2 default).
    // Fix tracked in issue #94.

    // Elder 2 whispers to clan "5" (which is NOT elder 5's default clanId in S2 1:1 mapping)
    await runCommand('peer', 'whisper', ['5', 'hello'], deps, { ELDER_N: '2' }, tmpDir);

    // Whisper written to elder-5.jsonl (keyed by recipient clanId)
    expect(fs.existsSync(recipientInboxFile('5', tmpDir))).toBe(true);

    // But peer inbox for ELDER_N=1 reads elder-1.jsonl — NOT elder-5.jsonl
    // If elder 1's actual clanId were "5", it would miss this whisper
    const out = await runCommand('peer', 'inbox', [], deps, { ELDER_N: '1' }, tmpDir);
    expect(out).toBe('inbox empty\n');

    // Document: fix tracked in issue #94 (option A: ELDER_CLAN_ID env + read by clanId)
  });
});
