import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { AgentCommand, ElderN, Health } from "./types.js";

type Mut<A extends Record<string, unknown>, R = null> = FunctionReference<"mutation", "public", A, R>;
type Qry<A extends Record<string, unknown>, R> = FunctionReference<"query", "public", A, R>;

const api = anyApi as unknown as {
  commandBus: {
    claimNext: Mut<{ secret: string; agentId: string }, AgentCommand | null>;
    ackCommand: Mut<{ secret: string; agentId: string; commandId: string }>;
    completeCommand: Mut<{
      secret: string; agentId: string; commandId: string;
      resultPayload: unknown; tookMs: number;
    }>;
    failCommand: Mut<{
      secret: string; agentId: string; commandId: string; reason: string;
    }>;
    releaseLease: Mut<{ secret: string; agentId: string; commandId: string }>;
    getQueuedFor: Qry<{ secret: string; agentId: string }, AgentCommand[]>;
    heartbeat: Mut<{
      secret: string; agentId: string;
      lastTickProcessed: number; currentStrategy?: string; health: Health;
    }>;
  };
};

export class BusClient {
  private readonly http: ConvexHttpClient;
  private readonly secret: string;
  private readonly agentId: ElderN;

  constructor(url: string, secret: string, agentId: ElderN) {
    this.http = new ConvexHttpClient(url);
    this.secret = secret;
    this.agentId = agentId;
  }

  private mut<A extends Record<string, unknown>, R>(ref: Mut<A, R>, args: A): Promise<R> {
    return Promise.race([
      this.http.mutation(ref as any, args as any) as Promise<R>,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Convex mutation timeout")), 15_000)),
    ]);
  }

  private qry<A extends Record<string, unknown>, R>(ref: Qry<A, R>, args: A): Promise<R> {
    return Promise.race([
      this.http.query(ref as any, args as any) as Promise<R>,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Convex query timeout")), 15_000)),
    ]);
  }

  async claimNext(): Promise<AgentCommand | null> {
    return this.mut(api.commandBus.claimNext, {
      secret: this.secret, agentId: this.agentId,
    });
  }

  async ackCommand(commandId: string): Promise<void> {
    await this.mut(api.commandBus.ackCommand, {
      secret: this.secret, agentId: this.agentId, commandId,
    });
  }

  async completeCommand(commandId: string, resultPayload: unknown, tookMs: number): Promise<void> {
    await this.mut(api.commandBus.completeCommand, {
      secret: this.secret, agentId: this.agentId, commandId, resultPayload, tookMs,
    });
  }

  async failCommand(commandId: string, reason: string): Promise<void> {
    await this.mut(api.commandBus.failCommand, {
      secret: this.secret, agentId: this.agentId, commandId, reason,
    });
  }

  async releaseLease(commandId: string): Promise<void> {
    await this.mut(api.commandBus.releaseLease, {
      secret: this.secret, agentId: this.agentId, commandId,
    });
  }

  async heartbeat(lastTickProcessed: number, health: Health, currentStrategy?: string): Promise<void> {
    await this.mut(api.commandBus.heartbeat, {
      secret: this.secret, agentId: this.agentId,
      lastTickProcessed, health, currentStrategy,
    });
  }

}
