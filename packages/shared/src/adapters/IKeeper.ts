// IKeeper — legacy abstraction over the heartbeat driver. The CANONICAL live
// driver is now the dockerized `packages/heartbeat` runner (30s, owner-settable
// on-chain), NOT any impl below. These stubs are retained only as a documented
// seam pattern; the external KeeperHub keeper layer is retired.
//   - FoundryLoopKeeper   — early-submission/local-dev loop (historical)
//   - KeeperHubKeeper     — RETIRED external keeper (was Base Sepolia cron) — do not use
//   - ConvexCronKeeper    — disaster fallback only (HEARTBEAT_CALLER_ENABLED=true)
import { readEnv } from './_env';

export interface IKeeper {
  start(): Promise<void>;
  stop(): Promise<void>;
}

class FoundryLoopKeeper implements IKeeper {
  async start(): Promise<void> {
    throw new Error('FoundryLoopKeeper: not implemented (Wave 1+)');
  }
  async stop(): Promise<void> {
    // no-op stub
  }
}

class KeeperHubKeeper implements IKeeper {
  async start(): Promise<void> {
    throw new Error('KeeperHubKeeper: not implemented (Submission 2)');
  }
  async stop(): Promise<void> {
    // no-op stub
  }
}

class ConvexCronKeeper implements IKeeper {
  async start(): Promise<void> {
    throw new Error('ConvexCronKeeper: not implemented (fallback only)');
  }
  async stop(): Promise<void> {
    // no-op stub
  }
}

export function createKeeper(): IKeeper {
  const mode = readEnv('KEEPER_MODE') ?? 'foundry-loop';
  switch (mode) {
    case 'foundry-loop':
      return new FoundryLoopKeeper();
    case 'keeperhub':
      return new KeeperHubKeeper();
    case 'convex':
      return new ConvexCronKeeper();
    default:
      throw new Error(`unknown KEEPER_MODE=${mode}`);
  }
}
