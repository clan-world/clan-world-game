import { describe, expect, it, vi } from "vitest";
import {
  enqueueCommand,
  claimNext,
  ackCommand,
  completeCommand,
  failCommand,
  getQueuedFor,
  sweepStaleDelivered,
  heartbeat,
} from "./commandBus";

vi.stubEnv("BUS_OPERATOR_SECRET", "op-secret");
vi.stubEnv("BUS_ELDER_SECRET_1", "elder-1-secret");
vi.stubEnv("BUS_ELDER_SECRET_2", "elder-2-secret");

function createDb(tables: Record<string, any[]> = {}) {
  return {
    tables,
    db: {
      async get(id: string) {
        for (const rows of Object.values(tables)) {
          const row = rows.find((r) => r._id === id);
          if (row) return row;
        }
        return null;
      },
      async insert(table: string, value: Record<string, unknown>) {
        tables[table] ??= [];
        const doc = {
          ...value,
          _id: `${table}:${tables[table].length}`,
          _creationTime: tables[table].length,
        };
        tables[table].push(doc);
        return doc._id;
      },
      async patch(id: string, value: Record<string, unknown>) {
        for (const rows of Object.values(tables)) {
          const index = rows.findIndex((row) => row._id === id);
          if (index >= 0) {
            const updated = { ...rows[index] };
            for (const [k, v] of Object.entries(value)) {
              if (v === undefined) delete (updated as any)[k];
              else (updated as any)[k] = v;
            }
            rows[index] = updated;
          }
        }
      },
      query(table: string) {
        let rows = [...(tables[table] ?? [])];
        const builder = {
          withIndex(_name: string, apply?: (q: any) => unknown) {
            if (apply) {
              const eqClauses: Array<{ field: string; value: unknown }> = [];
              const ltClauses: Array<{ field: string; value: unknown }> = [];
              const q = {
                eq(field: string, value: unknown) {
                  eqClauses.push({ field, value });
                  return q;
                },
                lt(field: string, value: unknown) {
                  ltClauses.push({ field, value });
                  return q;
                },
              };
              apply(q);
              rows = rows.filter((row) =>
                eqClauses.every((clause) => row[clause.field] === clause.value) &&
                ltClauses.every((clause) => (row[clause.field] as number) < (clause.value as number)),
              );
            }
            return builder;
          },
          filter(predicate: (q: any) => boolean) {
            rows = rows.filter((row) => {
              const rowQ = {
                eq(a: unknown, b: unknown) {
                  const aVal = typeof a === "function" ? (a as any)(row) : a;
                  const bVal = typeof b === "function" ? (b as any)(row) : b;
                  return aVal === bVal;
                },
                field(name: string) {
                  return row[name];
                },
              };
              return predicate(rowQ);
            });
            return builder;
          },
          order(direction: "asc" | "desc") {
            rows = [...rows].sort((a, b) =>
              direction === "desc"
                ? b._creationTime - a._creationTime
                : a._creationTime - b._creationTime,
            );
            return builder;
          },
          async first() {
            return rows[0] ?? null;
          },
          async collect() {
            return [...rows];
          },
        };
        return builder;
      },
    },
  };
}

describe("enqueueCommand", () => {
  it("inserts a command at status=queued", async () => {
    const { db, tables } = createDb();
    await (enqueueCommand as any)._handler(
      { db },
      {
        secret: "op-secret",
        targetAgentId: "elder-1",
        kind: "user_message",
        payload: { text: "hello" },
        source: "orchestrator",
      },
    );
    expect(tables.agentCommands).toHaveLength(1);
    expect(tables.agentCommands![0].status).toBe("queued");
    expect(tables.agentCommands![0].retryCount).toBe(0);
    expect(tables.agentCommands![0].payloadVersion).toBe(1);
  });

  it("throws on wrong operator secret", async () => {
    const { db } = createDb();
    await expect(
      (enqueueCommand as any)._handler(
        { db },
        {
          secret: "wrong-secret",
          targetAgentId: "elder-1",
          kind: "user_message",
          payload: {},
          source: "orchestrator",
        },
      ),
    ).rejects.toThrow("Unauthorized");
  });

  it("throws on invalid targetAgentId", async () => {
    const { db } = createDb();
    await expect(
      (enqueueCommand as any)._handler(
        { db },
        { secret: "op-secret", targetAgentId: "elder-99", kind: "reset", payload: {}, source: "orchestrator" },
      ),
    ).rejects.toThrow("Invalid targetAgentId");
  });

  it("fan-out: inserts one row per elder for targetAgentId='*'", async () => {
    vi.stubEnv("ELDER_IDS", "elder-1,elder-2,elder-3,elder-4");
    const { db, tables } = createDb();
    const result = await (enqueueCommand as any)._handler(
      { db },
      {
        secret: "op-secret",
        targetAgentId: "*",
        kind: "system_message",
        payload: { text: "freeze" },
        source: "orchestrator",
      },
    );
    expect(Array.isArray(result)).toBe(true);
    expect(tables.agentCommands).toHaveLength(4);
    const targets = tables.agentCommands!.map((c: any) => c.targetAgentId);
    expect(targets).toEqual(["elder-1", "elder-2", "elder-3", "elder-4"]);
    const seqs = tables.agentCommands!.map((c: any) => c.broadcastSequence);
    expect(new Set(seqs).size).toBe(1); // all same broadcastSequence
  });
});

describe("claimNext", () => {
  it("claims oldest queued command for targetAgentId", async () => {
    const { db, tables } = createDb({
      agentCommands: [
        {
          _id: "agentCommands:0",
          _creationTime: 0,
          targetAgentId: "elder-1",
          status: "queued",
          createdAt: 1000,
          retryCount: 0,
        },
        {
          _id: "agentCommands:1",
          _creationTime: 1,
          targetAgentId: "elder-1",
          status: "queued",
          createdAt: 2000,
          retryCount: 0,
        },
      ],
    });
    const claimedId = await (claimNext as any)._handler(
      { db },
      { secret: "elder-1-secret", agentId: "elder-1" },
    );
    expect(claimedId).toBe("agentCommands:0");
    expect(tables.agentCommands![0].status).toBe("leased");
    expect(tables.agentCommands![0].leaseOwner).toBe("elder-1");
  });

  it("returns null on empty queue", async () => {
    const { db } = createDb({ agentCommands: [] });
    const result = await (claimNext as any)._handler(
      { db },
      { secret: "elder-1-secret", agentId: "elder-1" },
    );
    expect(result).toBeNull();
  });

  it("claims fan-out broadcast row targeted at this elder", async () => {
    const { db, tables } = createDb({
      agentCommands: [
        {
          _id: "agentCommands:0",
          _creationTime: 0,
          targetAgentId: "elder-1",
          status: "queued",
          createdAt: 1000,
          retryCount: 0,
          broadcastSequence: 1,
        },
      ],
    });
    const claimedId = await (claimNext as any)._handler(
      { db },
      { secret: "elder-1-secret", agentId: "elder-1" },
    );
    expect(claimedId).toBe("agentCommands:0");
    expect(tables.agentCommands![0].status).toBe("leased");
  });
});

describe("ackCommand", () => {
  it("transitions leased to acked", async () => {
    const { db, tables } = createDb({
      agentCommands: [
        {
          _id: "agentCommands:0",
          _creationTime: 0,
          targetAgentId: "elder-1",
          status: "leased",
          leaseOwner: "elder-1",
          createdAt: 1000,
          retryCount: 0,
        },
      ],
    });
    await (ackCommand as any)._handler(
      { db },
      {
        secret: "elder-1-secret",
        agentId: "elder-1",
        commandId: "agentCommands:0",
      },
    );
    expect(tables.agentCommands![0].status).toBe("acked");
    expect(tables.agentCommands![0].ackedAt).toBeDefined();
  });
});

describe("completeCommand", () => {
  it("transitions acked to completed and writes commandResults row", async () => {
    const { db, tables } = createDb({
      agentCommands: [
        {
          _id: "agentCommands:0",
          _creationTime: 0,
          targetAgentId: "elder-1",
          status: "acked",
          leaseOwner: "elder-1",
          createdAt: 1000,
          retryCount: 0,
        },
      ],
    });
    await (completeCommand as any)._handler(
      { db },
      {
        secret: "elder-1-secret",
        agentId: "elder-1",
        commandId: "agentCommands:0",
        resultPayload: { ok: true },
        tookMs: 42,
      },
    );
    expect(tables.agentCommands![0].status).toBe("completed");
    expect(tables.agentCommands![0].completedAt).toBeDefined();
    expect(tables.commandResults).toHaveLength(1);
    expect(tables.commandResults![0].tookMs).toBe(42);
    expect(tables.commandResults![0].commandId).toBe("agentCommands:0");
  });
});

describe("completeCommand (lease-expiry)", () => {
  it("throws on expired lease when completing", async () => {
    const { db } = createDb({
      agentCommands: [
        {
          _id: "agentCommands:0",
          _creationTime: 0,
          targetAgentId: "elder-1",
          status: "acked",
          leaseOwner: "elder-1",
          leaseExpiresAt: Date.now() - 1000, // expired
          createdAt: 1000,
          retryCount: 0,
        },
      ],
    });
    await expect(
      (completeCommand as any)._handler(
        { db },
        {
          secret: "elder-1-secret",
          agentId: "elder-1",
          commandId: "agentCommands:0",
          resultPayload: { ok: true },
          tookMs: 42,
        },
      ),
    ).rejects.toThrow("Lease expired");
  });
});

describe("failCommand", () => {
  it("increments retryCount and re-queues if < MAX_RETRIES", async () => {
    const { db, tables } = createDb({
      agentCommands: [
        {
          _id: "agentCommands:0",
          _creationTime: 0,
          targetAgentId: "elder-1",
          status: "leased",
          leaseOwner: "elder-1",
          ackedAt: 999,
          createdAt: 1000,
          retryCount: 1,
        },
      ],
      commandResults: [],
    });
    await (failCommand as any)._handler(
      { db },
      {
        secret: "elder-1-secret",
        agentId: "elder-1",
        commandId: "agentCommands:0",
        reason: "timeout",
      },
    );
    expect(tables.agentCommands![0].status).toBe("queued");
    expect(tables.agentCommands![0].retryCount).toBe(2);
    expect(tables.agentCommands![0].leaseOwner).toBeUndefined();
    expect(tables.agentCommands![0].ackedAt).toBeUndefined();
    expect(tables.commandResults).toHaveLength(1);
    expect(tables.commandResults![0].resultPayload.reason).toBe("timeout");
  });

  it("marks failed if retryCount reaches MAX_RETRIES (3)", async () => {
    const { db, tables } = createDb({
      agentCommands: [
        {
          _id: "agentCommands:0",
          _creationTime: 0,
          targetAgentId: "elder-1",
          status: "leased",
          leaseOwner: "elder-1",
          createdAt: 1000,
          retryCount: 2,
        },
      ],
    });
    await (failCommand as any)._handler(
      { db },
      {
        secret: "elder-1-secret",
        agentId: "elder-1",
        commandId: "agentCommands:0",
        reason: "timeout",
      },
    );
    expect(tables.agentCommands![0].status).toBe("failed");
    expect(tables.agentCommands![0].retryCount).toBe(3);
  });

  it("throws on expired lease when failing", async () => {
    const { db } = createDb({
      agentCommands: [
        {
          _id: "agentCommands:0",
          _creationTime: 0,
          targetAgentId: "elder-1",
          status: "leased",
          leaseOwner: "elder-1",
          leaseExpiresAt: Date.now() - 1000, // expired
          createdAt: 1000,
          retryCount: 0,
        },
      ],
    });
    await expect(
      (failCommand as any)._handler(
        { db },
        {
          secret: "elder-1-secret",
          agentId: "elder-1",
          commandId: "agentCommands:0",
          reason: "timeout",
        },
      ),
    ).rejects.toThrow("Lease expired");
  });
});

describe("sweepStaleDelivered", () => {
  it("re-queues expired leases", async () => {
    const now = Date.now();
    const { db, tables } = createDb({
      agentCommands: [
        {
          _id: "agentCommands:0",
          _creationTime: 0,
          targetAgentId: "elder-1",
          status: "leased",
          leaseOwner: "elder-1",
          leaseExpiresAt: now - 1000, // expired
          createdAt: 1000,
          retryCount: 0,
        },
        {
          _id: "agentCommands:1",
          _creationTime: 1,
          targetAgentId: "elder-2",
          status: "leased",
          leaseOwner: "elder-2",
          leaseExpiresAt: now + 999999, // not expired
          createdAt: 2000,
          retryCount: 0,
        },
      ],
    });
    const result = await (sweepStaleDelivered as any)._handler({ db }, {});
    expect(result.swept).toBe(1);
    expect(tables.agentCommands![0].status).toBe("queued");
    expect(tables.agentCommands![1].status).toBe("leased"); // untouched
  });

  it("re-queues expired acked commands (stuck after elder crash)", async () => {
    const now = Date.now();
    const { db, tables } = createDb({
      agentCommands: [
        {
          _id: "agentCommands:0",
          _creationTime: 0,
          targetAgentId: "elder-1",
          status: "acked",
          leaseOwner: "elder-1",
          leaseExpiresAt: now - 1000,
          ackedAt: now - 2000,
          createdAt: 1000,
          retryCount: 0,
        },
      ],
    });
    const result = await (sweepStaleDelivered as any)._handler({ db }, {});
    expect(result.swept).toBe(1);
    expect(tables.agentCommands![0].status).toBe("queued");
    expect(tables.agentCommands![0].leaseOwner).toBeUndefined();
    expect(tables.agentCommands![0].ackedAt).toBeUndefined();
  });
});

describe("getQueuedFor", () => {
  it("returns queued commands for agentId", async () => {
    const { db } = createDb({
      agentCommands: [
        { _id: "agentCommands:0", _creationTime: 0, targetAgentId: "elder-1", status: "queued", createdAt: 1000, retryCount: 0 },
      ],
    });
    const result = await (getQueuedFor as any)._handler(
      { db },
      { secret: "elder-1-secret", agentId: "elder-1" },
    );
    expect(result).toHaveLength(1);
  });

  it("rejects wrong secret", async () => {
    const { db } = createDb();
    await expect(
      (getQueuedFor as any)._handler({ db }, { secret: "wrong", agentId: "elder-1" }),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("heartbeat", () => {
  it("inserts a new row on first call", async () => {
    const { db, tables } = createDb();
    await (heartbeat as any)._handler(
      { db },
      {
        secret: "elder-1-secret",
        agentId: "elder-1",
        lastTickProcessed: 42,
        health: "green",
      },
    );
    expect(tables.elderHeartbeat).toHaveLength(1);
    expect(tables.elderHeartbeat![0].agentId).toBe("elder-1");
    expect(tables.elderHeartbeat![0].health).toBe("green");
  });

  it("patches existing row on second call", async () => {
    const { db, tables } = createDb();
    await (heartbeat as any)._handler(
      { db },
      {
        secret: "elder-1-secret",
        agentId: "elder-1",
        lastTickProcessed: 42,
        health: "green",
      },
    );
    await (heartbeat as any)._handler(
      { db },
      {
        secret: "elder-1-secret",
        agentId: "elder-1",
        lastTickProcessed: 43,
        health: "yellow",
      },
    );
    expect(tables.elderHeartbeat).toHaveLength(1);
    expect(tables.elderHeartbeat![0].lastTickProcessed).toBe(43);
    expect(tables.elderHeartbeat![0].health).toBe("yellow");
  });
});

describe("auth", () => {
  it("throws on wrong elder secret", async () => {
    const { db } = createDb();
    await expect(
      (heartbeat as any)._handler(
        { db },
        {
          secret: "wrong-secret",
          agentId: "elder-1",
          lastTickProcessed: 1,
          health: "green",
        },
      ),
    ).rejects.toThrow("Unauthorized");
  });
});
