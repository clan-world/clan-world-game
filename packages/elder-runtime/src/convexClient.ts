import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { AgentCommand, ElderN, Health } from "./types.js";

type Mut<A extends Record<string, unknown>, R = null> = FunctionReference<"mutation", "public", A, R>;
type Qry<A extends Record<string, unknown>, R> = FunctionReference<"query", "public", A, R>;

const api = anyApi as unknown as {
  commandBus: {
    claimNext: Mut<{ secret: string; agentId: string }, string | null>;
    ackCommand: Mut<{ secret: string; agentId: string; commandId: string }>;
    completeCommand: Mut<{
      secret: string; agentId: string; commandId: string;
      resultPayload: unknown; tookMs: number;
    }>;
    failCommand: Mut<{
      secret: string; agentId: string; commandId: string; reason: string;
    }>;
    getQueuedFor: Qry<{ secret: string; agentId: string }, AgentCommand[]>;
    heartbeat: Mut<{
      secret: string; agentId: string;
      lastTickProcessed: number; currentStrategy?: string; health: Health;
    }>;
    getCommand: Qry<{ commandId: string }, AgentCommand | null>;
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

  async claimNext(): Promise<string | null> {
    return this.http.mutation(api.commandBus.claimNext, {
      secret: this.secret, agentId: this.agentId,
    });
  }

  async ackCommand(commandId: string): Promise<void> {
    await this.http.mutation(api.commandBus.ackCommand, {
      secret: this.secret, agentId: this.agentId, commandId,
    });
  }

  async completeCommand(commandId: string, resultPayload: unknown, tookMs: number): Promise<void> {
    await this.http.mutation(api.commandBus.completeCommand, {
      secret: this.secret, agentId: this.agentId, commandId, resultPayload, tookMs,
    });
  }

  async failCommand(commandId: string, reason: string): Promise<void> {
    await this.http.mutation(api.commandBus.failCommand, {
      secret: this.secret, agentId: this.agentId, commandId, reason,
    });
  }

  async heartbeat(lastTickProcessed: number, health: Health, currentStrategy?: string): Promise<void> {
    await this.http.mutation(api.commandBus.heartbeat, {
      secret: this.secret, agentId: this.agentId,
      lastTickProcessed, health, currentStrategy,
    });
  }

  async getCommand(commandId: string): Promise<AgentCommand | null> {
    return this.http.query(api.commandBus.getCommand, { commandId });
  }
}
