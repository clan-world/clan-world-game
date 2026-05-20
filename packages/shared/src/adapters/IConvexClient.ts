import { ConvexHttpClient } from 'convex/browser';
import type { ClanFullView, WorldSnapshot } from '../types';
import { HEARTBEAT_INTERVAL_SECONDS } from '../generated/constants';
import { readEnv } from './_env';
import { convexApiRefs } from './convexApiRefs';

// Module augmentation: `setFetchOptions` is a real public method on the
// `ConvexHttpClient` runtime class (see `convex@1.17.4` source at
// `dist/esm/browser/http_client.js` → `setFetchOptions(opts)`), used by the
// official `convex/nextjs` helpers to thread `cache: 'no-store'` and other
// `RequestInit` fields through to `fetch`. The SDK does not declare it in
// its `.d.ts`, so this augmentation patches the typing gap rather than
// reaching through with an `as unknown as` cast. If a future SDK version
// removes the runtime method, the augmentation will keep compiling but
// calls will throw at runtime — surfacing the breakage immediately.
declare module 'convex/browser' {
  interface ConvexHttpClient {
    setFetchOptions(options: RequestInit): void;
  }
}

export interface IConvexClient {
  readonly isStub?: boolean;
  getSnapshot(): Promise<WorldSnapshot>;
  getClanFullView(clanId: string): Promise<ClanFullView>;
  postLog(level: 'info' | 'warn' | 'error', message: string): Promise<void>;
  postRunnerStatus(args: RunnerStatusUpdate): Promise<void>;

  // Cockpit Comms write-side. Each method is best-effort: callers wrap in
  // try/catch + treat failures as non-fatal so the cockpit display stays
  // decoupled from the underlying domain action (a chain whisper succeeds
  // even if the cockpit feed write fails).
  postWhisper(args: {
    tick: number;
    fromClanId: number;
    toClanIds: number[];
    body: string;
    msgId?: string;
    signal?: AbortSignal;
  }): Promise<void>;
  postOrchEvent(args: {
    tick: number;
    kind: 'world_event' | 'directive' | 'narration';
    body: string;
    targetClanId?: number;
  }): Promise<void>;
  postHumanSteering(args: {
    tick: number;
    targetClanId: number;
    body: string;
    sentBy?: string;
  }): Promise<void>;
  postBulletin(args: {
    clanId: number;
    slot: number;
    body: string;
    dataHash?: string;
    txHash?: string;
  }): Promise<void>;
}

export type RunnerStatusUpdate = {
  runnerId: string;
  lastFireAt?: number;
  lastFireResult: 'success' | 'revert' | 'timeout' | 'error' | 'rate-limited' | 'boot-error';
  lastFailureMessage?: string;
  heartbeatIntervalSeconds?: number;
  nextHeartbeatAtTs?: number;
};

const DEFAULT_TICK_DURATION_MS = Number(HEARTBEAT_INTERVAL_SECONDS) * 1000;

class StubConvexClient implements IConvexClient {
  readonly isStub = true;

  async getSnapshot(): Promise<WorldSnapshot> {
    return {
      tick: 0,
      heartbeatIntervalSeconds: Number(HEARTBEAT_INTERVAL_SECONDS),
      tickEpoch: { startedAt: 0, durationMs: DEFAULT_TICK_DURATION_MS },
      regions: [],
      clans: [],
    };
  }
  async getClanFullView(clanId: string): Promise<ClanFullView> {
    return {
      clan: { id: clanId, name: `Stub Clan ${clanId}`, treasury: '0' },
      controlledRegions: [],
      pendingOrders: [],
      whispers: [],
    };
  }
  async postLog(_level: 'info' | 'warn' | 'error', _message: string): Promise<void> {
    // no-op stub
  }
  async postRunnerStatus(_args: RunnerStatusUpdate): Promise<void> {
    // no-op stub
  }

  async postWhisper(_args: { tick: number; fromClanId: number; toClanIds: number[]; body: string; msgId?: string; signal?: AbortSignal }): Promise<void> {}
  async postOrchEvent(_args: { tick: number; kind: 'world_event' | 'directive' | 'narration'; body: string; targetClanId?: number }): Promise<void> {}
  async postHumanSteering(_args: { tick: number; targetClanId: number; body: string; sentBy?: string }): Promise<void> {}
  async postBulletin(_args: { clanId: number; slot: number; body: string; dataHash?: string; txHash?: string }): Promise<void> {}
}

const getSnapshotRef = convexApiRefs.getSnapshot.getSnapshot;
const sendWhisperRef = convexApiRefs.comms.sendWhisper;
const seedOrchEventRef = convexApiRefs.comms.seedOrchEvent;
const seedHumanSteeringRef = convexApiRefs.comms.seedHumanSteering;
const seedBulletinRef = convexApiRefs.bulletins.seedBulletin;
const updateRunnerStatusRef = convexApiRefs.runnerStatus.updateRunnerStatus;

class RealConvexClient implements IConvexClient {
  readonly isStub = false;

  private readonly http: ConvexHttpClient;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
    this.http = new ConvexHttpClient(url);
  }

  // Per-call client for signal-bearing mutations. `ConvexHttpClient.setFetchOptions`
  // mutates instance state, so calling it on the shared `this.http` creates a race
  // when two callers issue concurrent signal-bearing mutations (call B overwrites
  // call A's signal, then A's `finally` clears B's). A fresh client per call
  // isolates the fetch options per signal. Cheap — only constructed when a signal
  // is provided.
  private clientForSignal(signal: AbortSignal): ConvexHttpClient {
    const c = new ConvexHttpClient(this.url);
    c.setFetchOptions({ signal });
    return c;
  }

  async getSnapshot(): Promise<WorldSnapshot> {
    try {
      return await this.http.query(getSnapshotRef);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found') || msg.includes('Could not find')) {
        console.warn('[RealConvexClient] getSnapshot query not found on server, using stub data');
        return {
          tick: 0,
          heartbeatIntervalSeconds: Number(HEARTBEAT_INTERVAL_SECONDS),
          tickEpoch: { startedAt: 0, durationMs: DEFAULT_TICK_DURATION_MS },
          regions: [],
          clans: [],
        };
      }
      throw err;
    }
  }

  async getClanFullView(clanId: string): Promise<ClanFullView> {
    return {
      clan: { id: clanId, name: `Stub Clan ${clanId}`, treasury: '0' },
      controlledRegions: [],
      pendingOrders: [],
      whispers: [],
    };
  }

  async postLog(_level: 'info' | 'warn' | 'error', _message: string): Promise<void> {
    // Phase 4: postLog via Convex not yet used by CLI path
  }

  async postRunnerStatus(args: RunnerStatusUpdate): Promise<void> {
    const secret = this.indexerSecret();
    if (!secret) {
      console.warn('[ConvexClient] postRunnerStatus skipped: INDEXER_SECRET not set');
      return;
    }
    try {
      await this.http.mutation(updateRunnerStatusRef, { secret, ...args });
    } catch (err) {
      console.warn('[ConvexClient] postRunnerStatus failed (non-fatal):', err);
    }
  }

  // Cockpit Comms write-side — best-effort, swallow + warn on failure so the
  // domain operation that triggered the post (chain whisper, orchestrator
  // tick, etc.) is never blocked by a Convex outage.
  //
  // Each call attaches `secret: INDEXER_SECRET` (read from env) so the
  // server-side mutation passes its `requireIndexerSecret` gate. If the env
  // var is missing the call is short-circuited with a single warn — same
  // shape the user sees when the deployment URL is not configured.
  private indexerSecret(): string | undefined {
    return readEnv('INDEXER_SECRET');
  }

  async postWhisper(args: { tick: number; fromClanId: number; toClanIds: number[]; body: string; msgId?: string; signal?: AbortSignal }): Promise<void> {
    const secret = this.indexerSecret();
    if (!secret) {
      console.warn('[ConvexClient] postWhisper skipped: INDEXER_SECRET not set');
      return;
    }
    const { signal, ...mutationArgs } = args;
    signal?.throwIfAborted();
    const client = signal ? this.clientForSignal(signal) : this.http;
    try {
      await client.mutation(sendWhisperRef, { secret, ...mutationArgs });
    } catch (err) {
      console.warn('[ConvexClient] postWhisper failed (non-fatal):', err);
    }
  }

  async postOrchEvent(args: { tick: number; kind: 'world_event' | 'directive' | 'narration'; body: string; targetClanId?: number }): Promise<void> {
    const secret = this.indexerSecret();
    if (!secret) {
      console.warn('[ConvexClient] postOrchEvent skipped: INDEXER_SECRET not set');
      return;
    }
    try {
      await this.http.mutation(seedOrchEventRef, { secret, ...args });
    } catch (err) {
      console.warn('[ConvexClient] postOrchEvent failed (non-fatal):', err);
    }
  }

  async postHumanSteering(args: { tick: number; targetClanId: number; body: string; sentBy?: string }): Promise<void> {
    const secret = this.indexerSecret();
    if (!secret) {
      console.warn('[ConvexClient] postHumanSteering skipped: INDEXER_SECRET not set');
      return;
    }
    try {
      await this.http.mutation(seedHumanSteeringRef, { secret, ...args });
    } catch (err) {
      console.warn('[ConvexClient] postHumanSteering failed (non-fatal):', err);
    }
  }

  async postBulletin(args: { clanId: number; slot: number; body: string; dataHash?: string; txHash?: string }): Promise<void> {
    const secret = this.indexerSecret();
    if (!secret) {
      console.warn('[ConvexClient] postBulletin skipped: INDEXER_SECRET not set');
      return;
    }
    try {
      await this.http.mutation(seedBulletinRef, { secret, ...args });
    } catch (err) {
      console.warn('[ConvexClient] postBulletin failed (non-fatal):', err);
    }
  }
}

export function createConvexClient(): IConvexClient {
  if (readEnv('CLAN_WORLD_USE_STUB_CONVEX') === 'true') {
    return new StubConvexClient();
  }
  const url = readEnv('CONVEX_URL');
  if (!url) {
    console.warn('[ConvexClient] CONVEX_URL not set — using stub data. Set CLAN_WORLD_USE_STUB_CONVEX=true to silence.');
    return new StubConvexClient();
  }
  return new RealConvexClient(url);
}
