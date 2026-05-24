import { describe, expect, it } from "vitest";
import {
  consumePendingMessages,
  getRunnerStartupState,
  hasTickReceive,
  recordResetEvent,
  recordTickSend,
} from "./runner";

function createDb(tables: Record<string, any[]> = {}) {
  return {
    query(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        withIndex(_name: string, apply: (q: any) => unknown) {
          const clauses: Array<{ field: string; value: unknown }> = [];
          const q = {
            eq(field: string, value: unknown) {
              clauses.push({ field, value });
              return q;
            },
          };
          apply(q);
          rows = rows.filter((row) => clauses.every((clause) => row[clause.field] === clause.value));
          return builder;
        },
        order(direction: "asc" | "desc") {
          rows = [...rows].sort((a, b) =>
            direction === "desc"
              ? (b._creationTime ?? 0) - (a._creationTime ?? 0)
              : (a._creationTime ?? 0) - (b._creationTime ?? 0),
          );
          return builder;
        },
        async first() { return rows[0] ?? null; },
        async take(n: number) { return rows.slice(0, n); },
      };
      return builder;
    },
    async insert(table: string, row: Record<string, unknown>) {
      const id = `${table}:${(tables[table] ?? []).length + 1}`;
      tables[table] ??= [];
      tables[table].push({ _id: id, _creationTime: tables[table].length + 1, ...row });
      return id;
    },
    async patch(id: string, patch: Record<string, unknown>) {
      for (const rows of Object.values(tables)) {
        const row = rows.find(candidate => candidate._id === id);
        if (row) {
          Object.assign(row, patch);
          return;
        }
      }
      throw new Error(`missing row ${id}`);
    },
  };
}

function call(fn: any, db: any, args: any) {
  return fn._handler({ db }, args);
}

describe("convex runner functions", () => {
  it("returns startup state with last received tick and sent flag", async () => {
    const db = createDb({
      tickClock: [{ _id: "tickClock:1", _creationTime: 1, tick: 8, tickEpochStartedAt: 0, tickEpochDurationMs: 60_000, seasonStartTick: 0, seasonEndTick: 360, winterActive: false }],
      tickReceiveLog: [{ _id: "tickReceiveLog:1", _creationTime: 1, elderId: "elder-1", receivedAt: 1, prefix: "tick", tickNumber: 7, messagePreview: "" }],
      tickSendLog: [{ _id: "tickSendLog:1", _creationTime: 1, elderId: "elder-1", tickNumber: 8, sentAt: 1, messageHash: "abc" }],
    });

    const result = await call(getRunnerStartupState, db, { elderId: "elder-1" });
    expect(result.lastReceivedTick).toBe(7);
    expect(result.sentForCurrentTick).toBe(true);
    expect(result.gameSettings.memoryWipeTickInterval).toBe(50);
  });

  it("records tick sends and reset events", async () => {
    const tables: Record<string, any[]> = {};
    const db = createDb(tables);
    const resetEventId = await call(recordResetEvent, db, {
      elderId: "elder-1",
      resetTick: 50,
      reason: "scheduled",
    });
    const sendId = await call(recordTickSend, db, {
      elderId: "elder-1",
      tickNumber: 50,
      messageHash: "hash",
      resetMetadata: { resetTick: 50, resetReason: "scheduled", resetEventId },
    });
    expect(sendId).toBe("tickSendLog:1");
    expect(tables.tickSendLog?.[0]?.resetMetadata.resetReason).toBe("scheduled");
  });

  it("checks tick receive and consumes pending messages", async () => {
    const tables: Record<string, any[]> = {
      tickReceiveLog: [{ _id: "tickReceiveLog:1", _creationTime: 1, elderId: "elder-1", receivedAt: 1, prefix: "tick", tickNumber: 9, messagePreview: "" }],
      pendingMessages: [{ _id: "pendingMessages:1", _creationTime: 1, targetElderId: "elder-1", text: "x", source: "user-message", insertedAt: 1, consumedAt: undefined }],
    };
    const db = createDb(tables);
    expect(await call(hasTickReceive, db, { elderId: "elder-1", tickNumber: 9 })).toBe(true);
    await call(consumePendingMessages, db, { messageIds: ["pendingMessages:1"], consumedAt: 123 });
    expect(tables.pendingMessages?.[0]?.consumedAt).toBe(123);
  });
});
