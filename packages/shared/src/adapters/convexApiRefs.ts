import type { FunctionReference } from 'convex/server';
import { anyApi } from 'convex/server';
import type { WorldSnapshot } from '../types';

type PublicQuery<Args extends Record<string, unknown>, Result> = FunctionReference<'query', 'public', Args, Result>;
type PublicMutation<Args extends Record<string, unknown>, Result = null> = FunctionReference<'mutation', 'public', Args, Result>;

type SendWhisperArgs = {
  secret: string;
  tick: number;
  fromClanId: number;
  toClanIds: number[];
  body: string;
  msgId?: string;
};

type SeedOrchEventArgs = {
  secret: string;
  tick: number;
  kind: 'world_event' | 'directive' | 'narration';
  body: string;
  targetClanId?: number;
};

type SeedHumanSteeringArgs = {
  secret: string;
  tick: number;
  targetClanId: number;
  body: string;
  sentBy?: string;
};

type SeedBulletinArgs = {
  secret: string;
  clanId: number;
  slot: number;
  body: string;
  dataHash?: string;
  txHash?: string;
};

type UpdateRunnerStatusArgs = {
  secret: string;
  runnerId: string;
  lastFireAt?: number;
  lastFireResult: 'success' | 'revert' | 'timeout' | 'error' | 'rate-limited' | 'boot-error';
  lastFailureMessage?: string;
  heartbeatIntervalSeconds?: number;
  nextHeartbeatAtTs?: number;
};

type ClanWorldConvexApi = {
  getSnapshot: {
    getSnapshot: PublicQuery<Record<string, never>, WorldSnapshot>;
  };
  comms: {
    sendWhisper: PublicMutation<SendWhisperArgs>;
    seedOrchEvent: PublicMutation<SeedOrchEventArgs>;
    seedHumanSteering: PublicMutation<SeedHumanSteeringArgs>;
  };
  bulletins: {
    seedBulletin: PublicMutation<SeedBulletinArgs>;
  };
  runnerStatus: {
    updateRunnerStatus: PublicMutation<UpdateRunnerStatusArgs, string>;
  };
};

// shared cannot import apps/server/convex/_generated/api: the server already
// depends on shared, and crossing that package boundary would create a cycle.
// Keep this narrow shim aligned with the public Convex functions this adapter
// calls, and let ConvexHttpClient enforce args/results from here onward.
export const convexApiRefs = anyApi as unknown as ClanWorldConvexApi;
