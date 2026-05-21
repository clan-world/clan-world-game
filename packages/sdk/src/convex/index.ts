export type {
  DataModel,
  Doc,
  Id,
  TableNames,
} from '../../convex/_generated/dataModel';

import type { Doc } from '../../convex/_generated/dataModel';

export type TickEpoch = {
  startedAt: number;
  durationMs: number;
};

export type WorldSnapshotRow = Doc<'worldSnapshot'>;
export type SnapshotRegion = WorldSnapshotRow['regions'][number];
export type SnapshotClan = WorldSnapshotRow['clans'][number];

export type SnapshotBandit = {
  id: number;
  region: number;
  state: number;
  tier: number;
  attackPower: number;
  stateEnteredTick: number;
  nextActionTick: number;
  projectedTargetClanId: number;
};

export type WorldSnapshot = {
  tick: number;
  heartbeatIntervalSeconds?: number;
  tickEpoch: TickEpoch;
  regions: SnapshotRegion[];
  clans: SnapshotClan[];
  currentSeasonNumber?: number;
  seasonStartTick?: number;
  seasonEndTick?: number;
  winterActive?: boolean;
  winterStartsAtTick?: number;
  winterEndsAtTick?: number;
  worldPaused?: boolean;
  pausedAtTs?: number | null;
  activeBanditId?: number;
  bandit?: SnapshotBandit | null;
};
