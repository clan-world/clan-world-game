import { ConvexHttpClient, ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import type {
  AgentCommand,
  ElderN,
  GameSettings,
  Health,
  PendingMessage,
  ResetMetadata,
  ResetReason,
  RunnerAuxiliary,
  RunnerEventKind,
  RunnerStartupState,
  TickSendResult,
} from "./types.js";
import { withBackoff } from "./retry.js";

const api = anyApi as any;

export class RunnerConvexClient {
  private readonly http: ConvexHttpClient;
  private readonly live: ConvexClient;

  constructor(
    private readonly url: string,
    private readonly elderId: ElderN,
  ) {
    this.http = new ConvexHttpClient(url);
    this.live = new ConvexClient(url);
  }

  async getStartupState(signal?: AbortSignal): Promise<RunnerStartupState> {
    return await this.call("getRunnerStartupState", () =>
      this.http.query(api.runner.getRunnerStartupState, { elderId: this.elderId }) as Promise<RunnerStartupState>, signal);
  }

  async getAuxiliary(signal?: AbortSignal): Promise<RunnerAuxiliary> {
    return await this.call("getRunnerAuxiliary", () =>
      this.http.query(api.runner.getRunnerAuxiliary, { elderId: this.elderId }) as Promise<RunnerAuxiliary>, signal);
  }

  watchAuxiliary(signal: AbortSignal): AsyncIterable<RunnerAuxiliary> {
    const live = this.live as any;
    const elderId = this.elderId;
    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        const queue: Array<RunnerAuxiliary | Error> = [];
        let wake: (() => void) | undefined;
        const push = (item: RunnerAuxiliary | Error) => {
          queue.push(item);
          wake?.();
          wake = undefined;
        };
        const wakeOnAbort = () => {
          wake?.();
          wake = undefined;
        };
        signal.addEventListener("abort", wakeOnAbort, { once: true });
        const unsubscribe = live.onUpdate(
          api.runner.getRunnerAuxiliary,
          { elderId },
          (value: RunnerAuxiliary) => push(value),
          (err: Error) => push(err),
        );
        try {
          while (!signal.aborted) {
            if (queue.length === 0) {
              await new Promise<void>((resolve) => { wake = resolve; });
            }
            const item = queue.shift();
            if (!item) continue;
            if (item instanceof Error) {
              console.warn("[convex] subscription error; falling back to query retry:", item);
              yield await self.getAuxiliary(signal);
            } else {
              yield item;
            }
          }
        } finally {
          signal.removeEventListener("abort", wakeOnAbort);
          unsubscribe?.();
        }
      },
    };
  }

  async hasTickReceive(tickNumber: number, signal?: AbortSignal): Promise<boolean> {
    return await this.call("hasTickReceive", () =>
      this.http.query(api.runner.hasTickReceive, { elderId: this.elderId, tickNumber }) as Promise<boolean>, signal);
  }

  async isThematicUidTaken(uid: string, signal?: AbortSignal): Promise<boolean> {
    return await this.call("isThematicUidTaken", () =>
      this.http.query(api.runner.isThematicUidTaken, { uid }) as Promise<boolean>, signal);
  }

  async hasMessageUidReceive(uid: string, signal?: AbortSignal): Promise<boolean> {
    return await this.call("hasMessageUidReceive", () =>
      this.http.query(api.runner.hasMessageUidReceive, { uid }) as Promise<boolean>, signal);
  }

  async recordTickSend(
    tickNumber: number,
    messageHash: string,
    resetMetadata?: ResetMetadata,
    signal?: AbortSignal,
  ): Promise<TickSendResult> {
    const sendLogId = await this.call("recordTickSend", () =>
      this.http.mutation(api.runner.recordTickSend, {
        elderId: this.elderId,
        tickNumber,
        messageHash,
        ...(resetMetadata ? { resetMetadata } : {}),
      }) as Promise<string>, signal);
    return { sendLogId };
  }

  async consumePendingMessages(messageIds: string[], consumedAt: number, signal?: AbortSignal): Promise<void> {
    if (messageIds.length === 0) return;
    await this.call("consumePendingMessages", () =>
      this.http.mutation(api.runner.consumePendingMessages, { messageIds, consumedAt }) as Promise<void>, signal);
  }

  async recordResetEvent(resetTick: number, reason: ResetReason, signal?: AbortSignal): Promise<string> {
    return await this.call("recordResetEvent", () =>
      this.http.mutation(api.runner.recordResetEvent, {
        elderId: this.elderId,
        resetTick,
        reason,
      }) as Promise<string>, signal);
  }

  async completeResetEvent(resetEventId: string, signal?: AbortSignal): Promise<void> {
    await this.call("completeResetEvent", () =>
      this.http.mutation(api.runner.completeResetEvent, { resetEventId }) as Promise<void>, signal);
  }

  async recordRunnerEvent(kind: RunnerEventKind, message: string, signal?: AbortSignal): Promise<void> {
    await this.call("recordRunnerEvent", () =>
      this.http.mutation(api.runner.recordRunnerEvent, {
        elderId: this.elderId,
        kind,
        message,
      }) as Promise<void>, signal);
  }

  close(): void {
    (this.live as any).close?.();
  }

  private async call<T>(label: string, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return await withBackoff(run, {
      label: `convex:${label}`,
      signal,
      onRecovered: () => this.recordRunnerEventDirect("convex_outage_recovery", `${label} recovered after outage`),
    });
  }

  private async recordRunnerEventDirect(kind: RunnerEventKind, message: string): Promise<void> {
    try {
      await this.http.mutation(api.runner.recordRunnerEvent, {
        elderId: this.elderId,
        kind,
        message,
      });
    } catch {
      // Best effort only; the recovered foreground call already succeeded.
    }
  }
}

export class BusClient {
  constructor(_url: string, _secret: string, _agentId: ElderN) {}
  async claimNext(): Promise<AgentCommand | null> { return null; }
  async ackCommand(_commandId: string): Promise<void> {}
  async completeCommand(_commandId: string, _resultPayload: unknown, _tookMs: number): Promise<void> {}
  async failCommand(_commandId: string, _reason: string): Promise<void> {}
  async releaseLease(_commandId: string): Promise<void> {}
  async heartbeat(_lastTickProcessed: number, _health: Health, _currentStrategy?: string): Promise<void> {}
}

export type { GameSettings, PendingMessage, RunnerAuxiliary, RunnerStartupState };
