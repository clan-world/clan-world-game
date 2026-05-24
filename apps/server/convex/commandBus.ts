import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

const LEASE_MS = 6 * 60 * 1000; // 6 minutes
const COMPLETION_GRACE_MS = 30 * 1000;
const MAX_RETRIES = 3;
const CONTROL_COMMAND_KINDS = ["reset", "freeze", "unfreeze"] as const;
type ControlCommandKind = typeof CONTROL_COMMAND_KINDS[number];

function checkOperatorAuth(secret: string) {
  if (!process.env.BUS_OPERATOR_SECRET || secret !== process.env.BUS_OPERATOR_SECRET) {
    throw new Error("Unauthorized: BUS_OPERATOR_SECRET required");
  }
}

function checkElderAuth(secret: string, agentId: string) {
  const m = agentId.match(/^elder-(\d+)$/);
  if (!m) throw new Error("Invalid agentId format");
  const expected = process.env[`BUS_ELDER_SECRET_${m[1]}`];
  if (!expected || secret !== expected) {
    throw new Error(`Unauthorized: BUS_ELDER_SECRET_${m[1]} required`);
  }
}

// 1. enqueueCommand — operator enqueues a command
export const enqueueCommand = mutation({
  args: {
    secret: v.string(),
    targetAgentId: v.string(),
    kind: v.union(
      v.literal("user_message"), v.literal("system_message"),
      v.literal("snapshot_request"), v.literal("reset"),
      v.literal("freeze"), v.literal("unfreeze"),
    ),
    payload: v.any(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    checkOperatorAuth(args.secret);
    const validElderIds = (process.env.ELDER_IDS ?? "elder-1,elder-2,elder-3,elder-4")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (args.targetAgentId !== "*" && !validElderIds.includes(args.targetAgentId)) {
      throw new Error(`Invalid targetAgentId: ${args.targetAgentId}`);
    }
    let broadcastSequence: number | undefined;
    if (args.targetAgentId === "*") {
      const last = await ctx.db.query("agentCommands")
        .withIndex("by_broadcast_sequence")
        .order("desc")
        .first();
      broadcastSequence = (last?.broadcastSequence ?? 0) + 1;
      const ids: string[] = [];
      for (const elderId of validElderIds) {
        ids.push(await ctx.db.insert("agentCommands", {
          targetAgentId: elderId,
          kind: args.kind,
          payload: args.payload,
          payloadVersion: 1,
          source: args.source,
          createdAt: Date.now(),
          status: "queued",
          retryCount: 0,
          broadcastSequence,
        }));
      }
      return ids;
    }
    return await ctx.db.insert("agentCommands", {
      targetAgentId: args.targetAgentId,
      kind: args.kind,
      payload: args.payload,
      payloadVersion: 1,
      source: args.source,
      createdAt: Date.now(),
      status: "queued",
      retryCount: 0,
      broadcastSequence,
    });
  },
});

// 2. claimNext — elder claims oldest queued command
export const claimNext = mutation({
  args: { secret: v.string(), agentId: v.string() },
  handler: async (ctx, args) => {
    checkElderAuth(args.secret, args.agentId);

    let cmd = await ctx.db.query("agentCommands")
      .withIndex("by_target_status", q =>
        q.eq("targetAgentId", args.agentId).eq("status", "queued"),
      )
      .filter(q => q.or(
        ...CONTROL_COMMAND_KINDS.map((kind: ControlCommandKind) =>
          q.eq(q.field("kind"), kind),
        ),
      ))
      .order("asc")
      .first();

    if (!cmd) {
      cmd = await ctx.db.query("agentCommands")
        .withIndex("by_target_status", q =>
          q.eq("targetAgentId", args.agentId).eq("status", "queued"),
        )
        .order("asc")
        .first();
    }

    if (!cmd) return null;
    const now = Date.now();
    await ctx.db.patch(cmd._id, {
      status: "leased",
      leaseOwner: args.agentId,
      leaseExpiresAt: now + LEASE_MS,
    });
    return { ...cmd, status: "leased" as const, leaseOwner: args.agentId, leaseExpiresAt: now + LEASE_MS };
  },
});

// 3. ackCommand — elder acks receipt
export const ackCommand = mutation({
  args: { secret: v.string(), agentId: v.string(), commandId: v.id("agentCommands") },
  handler: async (ctx, args) => {
    checkElderAuth(args.secret, args.agentId);
    const cmd = await ctx.db.get(args.commandId);
    if (!cmd || cmd.status !== "leased" || cmd.leaseOwner !== args.agentId) {
      throw new Error("Command not found or not leased by this elder");
    }
    // Keep this grace symmetric with completeCommand/failCommand/sweepStaleDelivered.
    if (cmd.leaseExpiresAt !== undefined && cmd.leaseExpiresAt + COMPLETION_GRACE_MS <= Date.now()) {
      throw new Error("Lease expired beyond grace — re-claim the command before acking");
    }
    await ctx.db.patch(args.commandId, { status: "acked", ackedAt: Date.now() });
  },
});

// 4. completeCommand — elder marks done + writes result
export const completeCommand = mutation({
  args: {
    secret: v.string(),
    agentId: v.string(),
    commandId: v.id("agentCommands"),
    resultPayload: v.any(),
    tookMs: v.number(),
  },
  handler: async (ctx, args) => {
    checkElderAuth(args.secret, args.agentId);
    const cmd = await ctx.db.get(args.commandId);
    if (!cmd) throw new Error("Command not found");
    if (cmd.status === "completed") return;
    if ((cmd.status !== "acked" && cmd.status !== "leased") || cmd.leaseOwner !== args.agentId) {
      throw new Error("Command not found or not owned by this elder");
    }
    if (cmd.leaseExpiresAt !== undefined && cmd.leaseExpiresAt + COMPLETION_GRACE_MS <= Date.now()) {
      throw new Error("Lease expired beyond grace — re-claim the command before completing");
    }
    const now = Date.now();
    await ctx.db.patch(args.commandId, { status: "completed", completedAt: now, leaseOwner: undefined, leaseExpiresAt: undefined });
    await ctx.db.insert("commandResults", {
      commandId: args.commandId,
      agentId: args.agentId,
      resultPayload: args.resultPayload,
      tookMs: args.tookMs,
      createdAt: now,
    });
  },
});

// 5. failCommand — elder gives up; retry or mark failed
export const failCommand = mutation({
  args: {
    secret: v.string(),
    agentId: v.string(),
    commandId: v.id("agentCommands"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    checkElderAuth(args.secret, args.agentId);
    const cmd = await ctx.db.get(args.commandId);
    if (!cmd || (cmd.status !== "leased" && cmd.status !== "acked") || cmd.leaseOwner !== args.agentId) {
      throw new Error("Command not found or not owned by this elder");
    }
    // Keep this grace symmetric with ackCommand/completeCommand/sweepStaleDelivered.
    if (cmd.leaseExpiresAt !== undefined && cmd.leaseExpiresAt + COMPLETION_GRACE_MS <= Date.now()) {
      throw new Error("Lease expired beyond grace — re-claim the command before failing");
    }
    const newRetryCount = cmd.retryCount + 1;
    const now = Date.now();
    await ctx.db.insert("commandResults", {
      commandId: args.commandId,
      agentId: args.agentId,
      resultPayload: { reason: args.reason, retryCount: newRetryCount },
      tookMs: 0,
      createdAt: now,
    });
    await ctx.db.patch(args.commandId, {
      status: newRetryCount >= MAX_RETRIES ? "failed" : "queued",
      retryCount: newRetryCount,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      ackedAt: undefined,
    });
  },
});

// 6. releaseLease — return a leased/acked command to queued without bumping retryCount
export const releaseLease = mutation({
  args: {
    secret: v.string(),
    agentId: v.string(),
    commandId: v.id("agentCommands"),
  },
  handler: async (ctx, args) => {
    checkElderAuth(args.secret, args.agentId);
    const cmd = await ctx.db.get(args.commandId);
    if (!cmd || cmd.leaseOwner !== args.agentId ||
        (cmd.status !== "leased" && cmd.status !== "acked")) {
      throw new Error("Command not found or not owned by this elder, or not in releasable state");
    }
    await ctx.db.patch(args.commandId, {
      status: "queued",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      ackedAt: undefined,
    });
  },
});

// 8. getQueuedFor — reactive query for elder's queue
export const getQueuedFor = query({
  args: { secret: v.string(), agentId: v.string() },
  handler: async (ctx, args) => {
    checkElderAuth(args.secret, args.agentId);
    return await ctx.db.query("agentCommands")
      .withIndex("by_target_status", q =>
        q.eq("targetAgentId", args.agentId).eq("status", "queued"),
      )
      .collect();
  },
});

// 9. sweepStaleDelivered — cron: re-queue expired leases
export const sweepStaleDelivered = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sweepBefore = now - COMPLETION_GRACE_MS;
    const expiredLeased = await ctx.db.query("agentCommands")
      .withIndex("by_status_lease", q =>
        q.eq("status", "leased").lt("leaseExpiresAt", sweepBefore)
      )
      .collect();
    const expiredAcked = await ctx.db.query("agentCommands")
      .withIndex("by_status_lease", q =>
        q.eq("status", "acked").lt("leaseExpiresAt", sweepBefore)
      )
      .collect();
    const expired = [...expiredLeased, ...expiredAcked];
    let swept = 0;
    for (const cmd of expired) {
      const newRetryCount = cmd.retryCount + 1;
      await ctx.db.patch(cmd._id, {
        status: newRetryCount >= MAX_RETRIES ? "failed" : "queued",
        retryCount: newRetryCount,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        ackedAt: undefined,
      });
      swept++;
    }
    return { swept };
  },
});

// 10. heartbeat — elder-runtime upserts heartbeat row
export const heartbeat = mutation({
  args: {
    secret: v.string(),
    agentId: v.string(),
    lastTickProcessed: v.number(),
    currentStrategy: v.optional(v.string()),
    health: v.union(v.literal("green"), v.literal("yellow"), v.literal("red")),
  },
  handler: async (ctx, args) => {
    checkElderAuth(args.secret, args.agentId);
    const existing = await ctx.db.query("elderHeartbeat")
      .withIndex("by_agentId", q => q.eq("agentId", args.agentId))
      .first();
    const data = {
      agentId: args.agentId,
      lastSeenAt: Date.now(),
      lastTickProcessed: args.lastTickProcessed,
      currentStrategy: args.currentStrategy,
      health: args.health,
    };
    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("elderHeartbeat", data);
    }
  },
});
