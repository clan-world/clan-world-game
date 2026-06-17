import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeResetEvent,
  consumePendingMessages,
  getRunnerAuxiliary,
  getRunnerStartupState,
  hasMessageUidReceive,
  hasTickReceive,
  recordRunnerEvent,
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
    async get(id: string) {
      for (const rows of Object.values(tables)) {
        const row = rows.find(candidate => candidate._id === id);
        if (row) return row;
      }
      return null;
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

beforeEach(() => {
  vi.stubEnv("BUS_ELDER_SECRET_1", "secret-1");
  vi.stubEnv("BUS_ELDER_SECRET_2", "secret-2");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("convex runner functions", () => {
  it("returns startup state with last received tick and sent flag", async () => {
    const db = createDb({
      tickClock: [{ _id: "tickClock:1", _creationTime: 1, tick: 8, tickEpochStartedAt: 0, tickEpochDurationMs: 60_000, seasonStartTick: 0, seasonEndTick: 360, winterActive: false }],
      tickReceiveLog: [{ _id: "tickReceiveLog:1", _creationTime: 1, elderId: "elder-1", receivedAt: 1, prefix: "tick", tickNumber: 7, messagePreview: "" }],
      tickSendLog: [{ _id: "tickSendLog:1", _creationTime: 1, elderId: "elder-1", tickNumber: 8, sentAt: 1, messageHash: "abc" }],
    });

    const result = await call(getRunnerStartupState, db, { elderId: "elder-1", secret: "secret-1" });
    expect(result.lastReceivedTick).toBe(7);
    expect(result.sentForCurrentTick).toBe(true);
    expect(result.gameSettings.memoryWipeTickInterval).toBe(50);
  });

  it("returns auxiliary state only with the elder secret", async () => {
    const db = createDb({
      tickClock: [{ _id: "tickClock:1", _creationTime: 1, tick: 8, tickEpochStartedAt: 0, tickEpochDurationMs: 60_000, seasonStartTick: 0, seasonEndTick: 360, winterActive: false }],
      pendingMessages: [
        { _id: "pendingMessages:1", _creationTime: 1, targetElderId: "elder-1", text: "x", source: "user-message", insertedAt: 1, consumedAt: undefined },
      ],
    });

    await expect(call(getRunnerAuxiliary, db, { elderId: "elder-1", secret: "wrong" }))
      .rejects.toThrow("invalid bus elder secret");
    const result = await call(getRunnerAuxiliary, db, { elderId: "elder-1", secret: "secret-1" });
    expect(result.pendingMessages).toHaveLength(1);
  });

  it("records tick sends and reset events", async () => {
    const tables: Record<string, any[]> = {};
    const db = createDb(tables);
    const resetEventId = await call(recordResetEvent, db, {
      elderId: "elder-1",
      secret: "secret-1",
      resetTick: 50,
      reason: "scheduled",
    });
    const sendId = await call(recordTickSend, db, {
      elderId: "elder-1",
      secret: "secret-1",
      tickNumber: 50,
      messageHash: "hash",
      resetMetadata: { resetTick: 50, resetReason: "scheduled", resetEventId },
    });
    await call(completeResetEvent, db, {
      elderId: "elder-1",
      secret: "secret-1",
      resetEventId,
    });
    await call(recordRunnerEvent, db, {
      elderId: "elder-1",
      secret: "secret-1",
      kind: "hook_failure",
      message: "x",
    });
    expect(sendId).toBe("tickSendLog:1");
    expect(tables.tickSendLog?.[0]?.resetMetadata.resetReason).toBe("scheduled");
    expect(tables.resetEventLog?.[0]?.completedAt).toEqual(expect.any(Number));
    expect(tables.runnerEvents?.[0]?.kind).toBe("hook_failure");
  });

  it("checks tick receive and consumes pending messages", async () => {
    const tables: Record<string, any[]> = {
      tickReceiveLog: [{ _id: "tickReceiveLog:1", _creationTime: 1, elderId: "elder-1", receivedAt: 1, prefix: "tick", tickNumber: 9, messagePreview: "" }],
      pendingMessages: [{ _id: "pendingMessages:1", _creationTime: 1, targetElderId: "elder-1", text: "x", source: "user-message", insertedAt: 1, consumedAt: undefined }],
    };
    const db = createDb(tables);
    expect(await call(hasTickReceive, db, { elderId: "elder-1", secret: "secret-1", tickNumber: 9 })).toBe(true);
    await call(consumePendingMessages, db, {
      elderId: "elder-1",
      secret: "secret-1",
      messageIds: ["pendingMessages:1"],
      consumedAt: 123,
    });
    expect(tables.pendingMessages?.[0]?.consumedAt).toBe(123);
  });

  it("scopes message uid receipt checks to the requesting elder", async () => {
    const db = createDb({
      tickReceiveLog: [
        { _id: "tickReceiveLog:1", _creationTime: 1, elderId: "elder-2", receivedAt: 1, prefix: "whisper", whisperUid: "same-uid", messagePreview: "" },
        { _id: "tickReceiveLog:2", _creationTime: 2, elderId: "elder-1", receivedAt: 2, prefix: "special-msg", specialMsgUid: "own-uid", messagePreview: "" },
      ],
    });

    expect(await call(hasMessageUidReceive, db, {
      elderId: "elder-1",
      secret: "secret-1",
      uid: "same-uid",
    })).toBe(false);
    expect(await call(hasMessageUidReceive, db, {
      elderId: "elder-1",
      secret: "secret-1",
      uid: "own-uid",
    })).toBe(true);
  });

  it("does not consume or complete rows owned by another elder", async () => {
    const tables: Record<string, any[]> = {
      pendingMessages: [
        { _id: "pendingMessages:1", _creationTime: 1, targetElderId: "elder-2", text: "x", source: "user-message", insertedAt: 1, consumedAt: undefined },
      ],
      resetEventLog: [
        { _id: "resetEventLog:1", _creationTime: 1, elderId: "elder-2", resetTick: 50, reason: "scheduled", startedAt: 1 },
      ],
    };
    const db = createDb(tables);

    await expect(call(consumePendingMessages, db, {
      elderId: "elder-1",
      secret: "secret-1",
      messageIds: ["pendingMessages:1"],
      consumedAt: 123,
    })).rejects.toThrow("does not belong to elder-1");
    expect(tables.pendingMessages?.[0]?.consumedAt).toBeUndefined();

    await expect(call(completeResetEvent, db, {
      elderId: "elder-1",
      secret: "secret-1",
      resetEventId: "resetEventLog:1",
    })).rejects.toThrow("does not belong to elder-1");
    expect(tables.resetEventLog?.[0]?.completedAt).toBeUndefined();
  });

  // ---- additional error-path coverage (Agent A: untested error paths) ----
  //
  // The existing tests above cover happy paths + cross-elder ownership rejects.
  // The branches below cover the remaining throw sites in runner.ts that
  // would silently no-op or corrupt state if a regression dropped them.

  it("rejects every mutation when supplied a foreign-elder secret", async () => {
    // baseline runner.test.ts only verifies wrong-secret on getRunnerAuxiliary.
    // Every other mutation calls requireBusElderSecret too — sweep them all so
    // a refactor that drops the call on (e.g.) recordTickSend is caught.
    const tables: Record<string, any[]> = {};
    const db = createDb(tables);

    await expect(call(recordTickSend, db, {
      elderId: "elder-1",
      secret: "secret-2",
      tickNumber: 1,
      messageHash: "h",
    })).rejects.toThrow("invalid bus elder secret");
    expect(tables.tickSendLog).toBeUndefined();

    await expect(call(recordResetEvent, db, {
      elderId: "elder-1",
      secret: "secret-2",
      resetTick: 1,
      reason: "scheduled",
    })).rejects.toThrow("invalid bus elder secret");
    expect(tables.resetEventLog).toBeUndefined();

    await expect(call(recordRunnerEvent, db, {
      elderId: "elder-1",
      secret: "secret-2",
      kind: "hook_failure",
      message: "x",
    })).rejects.toThrow("invalid bus elder secret");
    expect(tables.runnerEvents).toBeUndefined();

    await expect(call(consumePendingMessages, db, {
      elderId: "elder-1",
      secret: "secret-2",
      messageIds: [],
      consumedAt: 1,
    })).rejects.toThrow("invalid bus elder secret");

    await expect(call(completeResetEvent, db, {
      elderId: "elder-1",
      secret: "secret-2",
      resetEventId: "resetEventLog:nonexistent",
    })).rejects.toThrow("invalid bus elder secret");

    await expect(call(hasTickReceive, db, {
      elderId: "elder-1",
      secret: "secret-2",
      tickNumber: 1,
    })).rejects.toThrow("invalid bus elder secret");

    await expect(call(getRunnerStartupState, db, {
      elderId: "elder-1",
      secret: "secret-2",
    })).rejects.toThrow("invalid bus elder secret");
  });

  it("consumePendingMessages throws when ANY id in batch is missing (atomic check)", async () => {
    // The loop in consumePendingMessages collects owned ids first, then
    // patches them. If id #2 doesn't exist, the throw happens BEFORE any
    // patches run — so id #1's consumedAt should stay undefined too. This
    // protects the all-or-nothing semantics of the batch consume.
    const tables: Record<string, any[]> = {
      pendingMessages: [
        { _id: "pendingMessages:1", _creationTime: 1, targetElderId: "elder-1", text: "x", source: "user-message", insertedAt: 1, consumedAt: undefined },
      ],
    };
    const db = createDb(tables);

    await expect(call(consumePendingMessages, db, {
      elderId: "elder-1",
      secret: "secret-1",
      messageIds: ["pendingMessages:1", "pendingMessages:999"],
      consumedAt: 123,
    })).rejects.toThrow("pending message not found: pendingMessages:999");
    expect(tables.pendingMessages?.[0]?.consumedAt).toBeUndefined();
  });

  it("completeResetEvent throws when resetEventId doesn't exist", async () => {
    // Distinct from cross-elder ownership: this path catches a typo'd /
    // already-deleted reset id, with a specific "reset event not found"
    // message vs. the "does not belong" rejection.
    const tables: Record<string, any[]> = {};
    const db = createDb(tables);

    await expect(call(completeResetEvent, db, {
      elderId: "elder-1",
      secret: "secret-1",
      resetEventId: "resetEventLog:does-not-exist",
    })).rejects.toThrow("reset event not found: resetEventLog:does-not-exist");
  });

  it("getRunnerStartupState falls back to default clock when tickClock is empty", async () => {
    // The latestClock() helper has TWO branches: row present vs. row missing.
    // The baseline test only exercises the present branch. If a refactor
    // drops the cold-start default, runners would deserialize undefined and
    // crash on first boot of a fresh deployment.
    const db = createDb({});
    const result = await call(getRunnerStartupState, db, { elderId: "elder-1", secret: "secret-1" });
    expect(result.tickClock.tick).toBe(0);
    expect(result.lastReceivedTick).toBeNull();
    expect(result.sentForCurrentTick).toBe(false);
  });

  it("returns sentForCurrentTick=false when a send exists for a DIFFERENT tick", async () => {
    // by_elder_tick uses an .eq(tickNumber) on the CURRENT tick. A send row
    // logged at tick N-1 must NOT satisfy the "current tick" check at tick N.
    // Without this guard, the runner skips sending after a restart.
    const db = createDb({
      tickClock: [{ _id: "tickClock:1", _creationTime: 1, tick: 10, tickEpochStartedAt: 0, tickEpochDurationMs: 60_000, seasonStartTick: 0, seasonEndTick: 360, winterActive: false }],
      tickSendLog: [{ _id: "tickSendLog:1", _creationTime: 1, elderId: "elder-1", tickNumber: 9, sentAt: 1, messageHash: "abc" }],
    });
    const result = await call(getRunnerStartupState, db, { elderId: "elder-1", secret: "secret-1" });
    expect(result.sentForCurrentTick).toBe(false);
  });
});
