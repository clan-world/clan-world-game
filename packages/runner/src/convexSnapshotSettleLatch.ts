import type { IConvexClient } from '@clan-world/shared/adapters';
import type { SettleLatch } from './settleLatch';

const SNAPSHOT_LATCH_POLL_MS = 1_000;

/**
 * Standalone heartbeat-loop latch.
 *
 * The full runner has Cycle B call markSettled() after it has processed the
 * new tick. The standalone heartbeat launcher has no Cycle B, so it gates on
 * Convex ingest instead: each heartbeat is allowed only after worldSnapshot.tick
 * has advanced beyond the tick used for the previous heartbeat.
 */
export function makeConvexSnapshotSettleLatch(args: {
  convex: Pick<IConvexClient, 'getSnapshot'>;
  signal: AbortSignal;
  log?: Pick<Console, 'warn'>;
  pollMs?: number;
}): SettleLatch {
  let lastSeenTick = -1;
  const pollMs = args.pollMs ?? SNAPSHOT_LATCH_POLL_MS;

  const poll = async (): Promise<void> => {
    while (!args.signal.aborted) {
      try {
        const snapshot = await args.convex.getSnapshot();
        if (snapshot.tick > lastSeenTick) lastSeenTick = snapshot.tick;
      } catch (err) {
        args.log?.warn('[heartbeat-loop] worldSnapshot.tick read failed:', err);
      }
      await sleepWithSignal(pollMs, args.signal);
    }
  };

  void poll();

  return {
    lastSettledTick: () => lastSeenTick,
    markSettled: (tick) => {
      if (tick > lastSeenTick) lastSeenTick = tick;
    },
  };
}

export function makeHeartbeatLoopSettleLatch(args: {
  convex: Pick<IConvexClient, 'getSnapshot' | 'isStub'>;
  signal: AbortSignal;
  log?: Pick<Console, 'warn'>;
  pollMs?: number;
}): SettleLatch | undefined {
  if (args.convex.isStub) {
    args.log?.warn('[heartbeatLoopMain] stub Convex detected — running without settle latch');
    return undefined;
  }
  return makeConvexSnapshotSettleLatch(args);
}

async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    signal.addEventListener('abort', onAbort);
  });
}
