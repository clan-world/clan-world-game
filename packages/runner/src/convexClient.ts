import type { AgentCommand, ElderN, Health } from "./types.js";

export class BusClient {
  constructor(_url: string, _secret: string, _agentId: ElderN) {
    // TODO(PR2): replace command-bus calls with pendingMessages reads and
    // tickSendLog/tickReceiveLog writes. PR1 keeps the old runtime bootable
    // after deleting the old Convex bus module.
  }

  async claimNext(): Promise<AgentCommand | null> {
    // TODO(PR2): read the next pending message for this elder.
    return null;
  }

  async ackCommand(_commandId: string): Promise<void> {
    // TODO(PR2): mark a received tick/message in tickReceiveLog.
  }

  async completeCommand(_commandId: string, _resultPayload: unknown, _tookMs: number): Promise<void> {
    // TODO(PR2): replace command completion with Bundle 4 runner logs.
  }

  async failCommand(_commandId: string, _reason: string): Promise<void> {
    // TODO(PR2): write runnerEvents rows for delivery/handler failures.
  }

  async releaseLease(_commandId: string): Promise<void> {
    // TODO(PR2): remove lease semantics entirely.
  }

  async heartbeat(_lastTickProcessed: number, _health: Health, _currentStrategy?: string): Promise<void> {
    // TODO(PR2): replace old heartbeat writes with runnerEvents/readiness logs.
  }
}
