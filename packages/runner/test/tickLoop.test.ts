import { describe, expect, it } from 'vitest';
import type { IConvexClient } from '@clan-world/shared/adapters';
import type {
  DeliveryStatus,
  IElderMemoryStore,
  IElderPeerInbox,
  IRunnerInbox,
} from '@clan-world/agents/seams';
import { composeSituationBlock } from '../src/composeSituationBlock';
import { tickLoop, type Logger, type PerElderDeps } from '../src/tickLoop';
import { ELDER_IDS, type ElderId, type RunnerConfig } from '../src/types';

function fakeConvex(tick: number): IConvexClient {
  return {
    async getSnapshot() {
      return {
        tick,
        tickEpoch: { startedAt: 0, durationMs: 60000 },
        regions: [],
        clans: [],
      };
    },
    async getClanFullView(clanId: string) {
      return {
        clan: { id: clanId, name: `Clan ${clanId}`, treasury: '0' },
        controlledRegions: [],
        pendingOrders: [],
        whispers: [],
      };
    },
    async postLog() {},
    async postRunnerStatus() {},
    async postWhisper() {},
    async postOrchEvent() {},
    async postHumanSteering() {},
    async postBulletin() {},
  };
}

function fakeMemory(): IElderMemoryStore {
  return {
    async recall() {
      return undefined;
    },
    async save() {},
    async snapshot() {
      return {};
    },
  };
}

function fakePeerInbox(): IElderPeerInbox {
  return {
    async send() {},
    async inbox() {
      return [];
    },
  };
}

function config(): RunnerConfig {
  return {
    pollIntervalMs: 1,
    settleWindowSec: 0,
    deliveryTimeoutMs: 100,
    ackTimeoutMs: 100,
    stateDir: '/tmp/clanworld-runner-test',
    tmuxSessionPrefix: 'elder',
    elderToClanId: { 1: '1', 2: '2', 3: '3', 4: '4' },
  };
}

describe('tickLoop', () => {
  it('treats duplicate-tick delivery as an idempotent success without retries', async () => {
    const abort = new AbortController();
    const delivered: Array<{ elder: ElderId; tick: number }> = [];
    const perElder = {} as Record<ElderId, PerElderDeps>;

    for (const elder of ELDER_IDS) {
      const inbox: IRunnerInbox = {
        async deliverSituationBlock(tick: number): Promise<DeliveryStatus> {
          delivered.push({ elder, tick });
          if (delivered.length === ELDER_IDS.length) abort.abort();
          return { ok: false, reason: 'duplicate-tick' };
        },
        async waitForAckAndClear() {
          return 'ack';
        },
      };
      perElder[elder] = {
        inbox,
        memory: fakeMemory(),
        peerInbox: fakePeerInbox(),
      };
    }

    const logs = {
      info: [] as unknown[][],
      warn: [] as unknown[][],
      error: [] as unknown[][],
    };
    const log: Logger = {
      info: (...args) => logs.info.push(args),
      warn: (...args) => logs.warn.push(args),
      error: (...args) => logs.error.push(args),
    };

    await tickLoop({
      convex: fakeConvex(9),
      perElder,
      config: config(),
      signal: abort.signal,
      log,
    });

    expect(delivered).toEqual(ELDER_IDS.map(elder => ({ elder, tick: 9 })));
    expect(logs.info.flat().join('\n')).toContain('tick 9 already processed');
    expect(logs.warn).toEqual([]);
    expect(logs.error).toEqual([]);
  });

  it('waits for ack-clear and resets every elder on tick 50', async () => {
    const abort = new AbortController();
    const delivered: Array<{ elder: ElderId; tick: number; block: string }> = [];
    const resets: Array<{ elder: ElderId; timeoutMs: number }> = [];
    const perElder = {} as Record<ElderId, PerElderDeps>;

    for (const elder of ELDER_IDS) {
      const inbox: IRunnerInbox = {
        async deliverSituationBlock(tick: number, block: string): Promise<DeliveryStatus> {
          delivered.push({ elder, tick, block });
          return { ok: true };
        },
        async waitForAckAndClear(timeoutMs: number) {
          resets.push({ elder, timeoutMs });
          if (resets.length === ELDER_IDS.length) abort.abort();
          return elder === 1 ? 'timeout' : 'ack';
        },
      };
      perElder[elder] = {
        inbox,
        memory: fakeMemory(),
        peerInbox: fakePeerInbox(),
      };
    }

    const logs = {
      info: [] as unknown[][],
      warn: [] as unknown[][],
      error: [] as unknown[][],
    };
    const log: Logger = {
      info: (...args) => logs.info.push(args),
      warn: (...args) => logs.warn.push(args),
      error: (...args) => logs.error.push(args),
    };

    await tickLoop({
      convex: fakeConvex(50),
      perElder,
      config: config(),
      signal: abort.signal,
      log,
    });

    expect(delivered).toEqual(
      ELDER_IDS.map(elder => ({
        elder,
        tick: 50,
        block: composeSituationBlock({ elder, clanId: String(elder), tick: 50 }),
      })),
    );
    expect(resets).toEqual(ELDER_IDS.map(elder => ({ elder, timeoutMs: 100 })));
    expect(logs.info.flat().join('\n')).toContain('context reset boundary reached');
    expect(logs.warn.flat().join('\n')).toContain('elder 1: ack-clear timeout');
  });

  it('does not reset on the tick-49 warning', async () => {
    const abort = new AbortController();
    const resets: ElderId[] = [];
    const perElder = {} as Record<ElderId, PerElderDeps>;

    for (const elder of ELDER_IDS) {
      const inbox: IRunnerInbox = {
        async deliverSituationBlock(): Promise<DeliveryStatus> {
          if (elder === ELDER_IDS[ELDER_IDS.length - 1]) abort.abort();
          return { ok: true };
        },
        async waitForAckAndClear() {
          resets.push(elder);
          return 'ack';
        },
      };
      perElder[elder] = {
        inbox,
        memory: fakeMemory(),
        peerInbox: fakePeerInbox(),
      };
    }

    await tickLoop({
      convex: fakeConvex(49),
      perElder,
      config: config(),
      signal: abort.signal,
    });

    expect(resets).toEqual([]);
  });
});
