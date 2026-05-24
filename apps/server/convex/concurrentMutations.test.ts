/**
 * Concurrent-mutation pattern tests.
 *
 * Convex serializes individual mutations against a single document, but the
 * SDK callers (Python hooks, indexer, runner) can still interleave mutations
 * in ways that produce surprising state. These tests document the current
 * behavior of those interleavings — establishing the contract pre-fix so we
 * can detect regressions either way:
 *
 *   - duplicate `recordReceive` for the same (elderId, tickNumber) — opus 4.7
 *     M-6 documented: there is NO idempotency check, the row bloats freely.
 *     Tests below pin that behavior so the followup fix (insert-after-by_elder_tick
 *     lookup) will surface as a test diff, not silent semantics change.
 *   - duplicate `recordTickSend` for the same (elderId, tickNumber) — same shape.
 *     `getRunnerStartupState.sentForCurrentTick` boolean still returns true if
 *     even one row exists, so duplicates are wasted writes (not user-visible),
 *     but they bloat the log and skew per-tick auditing.
 *   - `ingestEvents` duplicate (txHash, logIndex) — DOES have an idempotency
 *     check (line 554-560 of indexer.ts). These tests pin that contract.
 *   - `ingestEvents` checkpoint monotonic guard — concurrent webhook + poller
 *     with out-of-order blockNumber must NOT regress the cursor.
 *   - reset event lifecycle — concurrent completion attempts from different
 *     elders rejected by per-elder ownership check (already tested in
 *     runner.test.ts); this file adds: same elder completing twice (currently
 *     succeeds — second patch just overwrites completedAt timestamp).
 *
 * Pattern matches the other in-memory-db tests in this package — no
 * convex-test harness. Each mutation handler is invoked via `._handler`.
 *
 * Pre-existing source bug intentionally exposed: recordReceive bloat. See
 * the dedicated `it.todo` near that test for the recommended fix.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordReceive } from "./tickReceiveLog";
import {
  completeResetEvent,
  consumePendingMessages,
  hasTickReceive,
  recordResetEvent,
  recordTickSend,
  getRunnerStartupState,
} from "./runner";
import { ingestEvents } from "./indexer";
import { sendWhisper } from "./comms";

// ---------- shared mock db --------------------------------------------------

function createDb(tables: Record<string, any[]> = {}) {
  return {
    tables,
    db: {
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
      async get(id: string) {
        for (const rows of Object.values(tables)) {
          const row = rows.find((r) => r._id === id);
          if (row) return row;
        }
        return null;
      },
      async patch(id: string, patch: Record<string, unknown>) {
        for (const rows of Object.values(tables)) {
          const idx = rows.findIndex((r) => r._id === id);
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...patch };
            return;
          }
        }
        throw new Error(`missing row ${id}`);
      },
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
            rows = rows.filter((row) =>
              clauses.every((clause) => row[clause.field] === clause.value),
            );
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
          async first() {
            return rows[0] ?? null;
          },
          async take(n: number) {
            return rows.slice(0, n);
          },
        };
        return builder;
      },
    },
  };
}

function call(fn: any, db: any, args: any) {
  return fn._handler({ db }, args);
}

// ---------- env setup -------------------------------------------------------

beforeEach(() => {
  vi.stubEnv("BUS_ELDER_SECRET_1", "secret-1");
  vi.stubEnv("BUS_ELDER_SECRET_2", "secret-2");
  vi.stubEnv("BUS_ELDER_SECRET_3", "secret-3");
  vi.stubEnv("BUS_ELDER_SECRET_4", "secret-4");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------- tests -----------------------------------------------------------

describe("recordReceive — concurrent duplicate-tick mutation pattern (opus 4.7 M-6)", () => {
  it("duplicate (elderId, tickNumber) recordReceive currently BLOATS the log — pin pre-fix behavior", async () => {
    // This test pins the documented M-6 bug. The Python hook can re-invoke
    // recordReceive for the same tick (e.g. webhook retry, two hook copies
    // racing on overlapping incoming-message buffers). There is NO idempotency
    // check on the (elderId, tickNumber) tuple — every call inserts a new
    // row. by_elder_tick lookup returns the latest by _creationTime, so
    // hasTickReceive still works, but the log grows linearly.
    //
    // After M-6 is fixed (lookup before insert), the expected row count
    // becomes 1, and this test MUST be updated as part of the fix PR — the
    // diff itself is the safety net.
    const { db, tables } = createDb();
    const args = {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "tick" as const,
      tickNumber: 42,
      messagePreview: "tick 42 received",
    };

    // Simulate three back-to-back identical recordReceive calls (e.g. hook
    // crash-and-restart mid-flight, or webhook delivery retries).
    await call(recordReceive, db, args);
    await call(recordReceive, db, args);
    await call(recordReceive, db, args);

    // PRE-FIX behavior: 3 rows. After M-6 fix this becomes 1.
    expect(tables.tickReceiveLog).toHaveLength(3);
    // All rows share the same (elderId, tickNumber); they're true duplicates.
    expect(
      tables.tickReceiveLog?.every(
        (row) => row.elderId === "elder-1" && row.tickNumber === 42,
      ),
    ).toBe(true);
  });

  it("hasTickReceive still returns true even when only ONE of N duplicates exists for the tick", async () => {
    // Defends against an over-eager fix that DELETES dupes instead of
    // de-duping at insert time: the lookup-by-index path must still surface
    // the tick regardless of how many duplicate rows live behind it.
    const { db } = createDb();
    await call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "tick",
      tickNumber: 7,
      messagePreview: "tick 7",
    });
    expect(
      await call(hasTickReceive, db, {
        elderId: "elder-1",
        secret: "secret-1",
        tickNumber: 7,
      }),
    ).toBe(true);
  });

  it("two elders writing the SAME tickNumber are independent — both rows persist", async () => {
    // Negative test for an over-eager fix: a (tickNumber)-only uniqueness
    // constraint would wrongly merge ticks across elders. The correct
    // uniqueness key is (elderId, tickNumber).
    const { db, tables } = createDb();
    await call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "tick",
      tickNumber: 100,
      messagePreview: "elder-1 tick 100",
    });
    await call(recordReceive, db, {
      secret: "secret-2",
      elderId: "elder-2",
      prefix: "tick",
      tickNumber: 100,
      messagePreview: "elder-2 tick 100",
    });

    expect(tables.tickReceiveLog).toHaveLength(2);
    expect(tables.tickReceiveLog?.map((r) => r.elderId).sort()).toEqual([
      "elder-1",
      "elder-2",
    ]);
  });

  it("interleaved whisper + tick for the same elder both persist (different prefixes)", async () => {
    // The fix for M-6 must key on (elderId, tickNumber, prefix) — or specifically
    // only on tick-prefix rows — because whispers/special-msg legitimately have
    // tickNumber=undefined and arrive in arbitrary quantities per tick.
    const { db, tables } = createDb();
    await call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "tick",
      tickNumber: 50,
      messagePreview: "tick 50",
    });
    await call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "whisper",
      whisperUid: "w-001",
      messagePreview: "whisper 1",
    });
    await call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "whisper",
      whisperUid: "w-002",
      messagePreview: "whisper 2",
    });

    expect(tables.tickReceiveLog).toHaveLength(3);
    const prefixes = tables.tickReceiveLog?.map((r) => r.prefix);
    expect(prefixes).toEqual(["tick", "whisper", "whisper"]);
  });
});

describe("recordTickSend — concurrent duplicate-tick mutation pattern", () => {
  it("duplicate (elderId, tickNumber) recordTickSend produces multiple tickSendLog rows (no insert-side guard)", async () => {
    // Mirrors the recordReceive issue but on the send side. The runner-status
    // dashboard query `sentForCurrentTick` does !== null on the first row, so
    // duplicates are not user-visible, BUT log bloat is real (one row per
    // hook retry per tick for the lifetime of the deployment).
    const { db, tables } = createDb();
    await call(recordTickSend, db, {
      elderId: "elder-1",
      secret: "secret-1",
      tickNumber: 9,
      messageHash: "hash-a",
    });
    await call(recordTickSend, db, {
      elderId: "elder-1",
      secret: "secret-1",
      tickNumber: 9,
      messageHash: "hash-a",
    });

    expect(tables.tickSendLog).toHaveLength(2);
  });

  it("getRunnerStartupState.sentForCurrentTick is true after the FIRST send (subsequent dupes don't flip it)", async () => {
    // This is the user-visible contract: a single send is sufficient. Pinned
    // so a future fix that REJECTS the duplicate (instead of silently
    // accepting it) doesn't accidentally also flip the flag back to false.
    const { db } = createDb({
      tickClock: [
        {
          _id: "tickClock:1",
          _creationTime: 1,
          tick: 9,
          tickEpochStartedAt: 0,
          tickEpochDurationMs: 60_000,
          seasonStartTick: 0,
          seasonEndTick: 360,
          winterActive: false,
        },
      ],
    });
    await call(recordTickSend, db, {
      elderId: "elder-1",
      secret: "secret-1",
      tickNumber: 9,
      messageHash: "hash",
    });
    const after1 = await call(getRunnerStartupState, db, {
      elderId: "elder-1",
      secret: "secret-1",
    });
    expect(after1.sentForCurrentTick).toBe(true);

    await call(recordTickSend, db, {
      elderId: "elder-1",
      secret: "secret-1",
      tickNumber: 9,
      messageHash: "hash",
    });
    const after2 = await call(getRunnerStartupState, db, {
      elderId: "elder-1",
      secret: "secret-1",
    });
    expect(after2.sentForCurrentTick).toBe(true);
  });

  it("two elders sending the same tickNumber are isolated by elderId index", async () => {
    // Cross-elder isolation: same tickNumber for elder-1 and elder-2 must NOT
    // mask each other's sentForCurrentTick flag. This is the runner's read-
    // your-writes invariant — without isolation, elder-2 would think it had
    // already sent for the current tick whenever elder-1 sent first.
    const { db } = createDb({
      tickClock: [
        {
          _id: "tickClock:1",
          _creationTime: 1,
          tick: 50,
          tickEpochStartedAt: 0,
          tickEpochDurationMs: 60_000,
          seasonStartTick: 0,
          seasonEndTick: 360,
          winterActive: false,
        },
      ],
    });
    await call(recordTickSend, db, {
      elderId: "elder-1",
      secret: "secret-1",
      tickNumber: 50,
      messageHash: "elder-1-hash",
    });
    const elder1Sent = await call(getRunnerStartupState, db, {
      elderId: "elder-1",
      secret: "secret-1",
    });
    const elder2Sent = await call(getRunnerStartupState, db, {
      elderId: "elder-2",
      secret: "secret-2",
    });
    expect(elder1Sent.sentForCurrentTick).toBe(true);
    expect(elder2Sent.sentForCurrentTick).toBe(false);
  });
});

describe("ingestEvents — duplicate (txHash, logIndex) idempotency contract", () => {
  it("duplicate event with same (txHash, logIndex) is IDEMPOTENT — second call inserts zero rows", async () => {
    // Unlike recordReceive (M-6), ingestEvents DOES guard against duplicates
    // via by_tx_log lookup (indexer.ts:554-560). Pin this contract so a
    // future refactor doesn't accidentally remove the guard.
    const event = {
      eventName: "TickAdvanced",
      args: { closedTick: "1", openedTick: "2", tickSeed: "0x1234" },
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      blockNumber: 200,
      logIndex: 7,
    };
    const { db, tables } = createDb();

    const result1 = await (ingestEvents as any)._handler(
      { db },
      {
        events: [event],
        blockNumber: 200,
        txHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        advanceCheckpoint: false,
      },
    );
    const result2 = await (ingestEvents as any)._handler(
      { db },
      {
        events: [event],
        blockNumber: 200,
        txHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        advanceCheckpoint: false,
      },
    );

    expect(result1.inserted).toBe(1);
    expect(result2.inserted).toBe(0);
    expect(tables.chainEvents).toHaveLength(1);
    // The TickAdvanced side-effect (tickHistory insert) also guarded — second
    // call must not double-insert tickHistory either, because we short-circuit
    // BEFORE the tickHistory insert when the chainEvents row already exists.
    expect(tables.tickHistory).toHaveLength(1);
  });

  it("simultaneous webhook + poller for the same tx: both ingest succeed; second is a no-op insert", async () => {
    // Realistic race: the heartbeat webhook ingests with
    // advanceCheckpoint=false at block N; the 60s poller fires moments later,
    // catches the same tx via getLogs, ingests with advanceCheckpoint=true.
    // The chainEvents row exists, so the SECOND ingest skips the insert
    // (idempotent) but STILL advances the checkpoint — the cursor must move
    // forward even when the events themselves were already absorbed by the
    // webhook path.
    const event = {
      eventName: "TickAdvanced",
      args: { closedTick: "5", openedTick: "6", tickSeed: "0xabcd" },
      transactionHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      blockNumber: 500,
      logIndex: 0,
    };
    const { db, tables } = createDb({
      eventCheckpoint: [
        { _id: "eventCheckpoint:0", _creationTime: 0, lastBlock: 400 },
      ],
    });

    // 1. Webhook arrives first (advanceCheckpoint=false).
    await (ingestEvents as any)._handler(
      { db },
      {
        events: [event],
        blockNumber: 500,
        txHash: event.transactionHash,
        advanceCheckpoint: false,
      },
    );
    expect(tables.eventCheckpoint?.[0]?.lastBlock).toBe(400);
    expect(tables.chainEvents).toHaveLength(1);

    // 2. Poller catches up moments later (advanceCheckpoint=true). The event
    // row already exists, but the cursor must still advance.
    await (ingestEvents as any)._handler(
      { db },
      {
        events: [event],
        blockNumber: 500,
        txHash: event.transactionHash,
        advanceCheckpoint: true,
      },
    );
    expect(tables.chainEvents).toHaveLength(1); // still 1 — idempotent
    expect(tables.eventCheckpoint?.[0]?.lastBlock).toBe(500); // advanced
  });

  it("out-of-order poller catch-up: older block must NOT regress the checkpoint", async () => {
    // Catches a regression on the indexer.ts line 607 monotonic guard:
    //   if (args.blockNumber >= checkpoint.lastBlock) { patch... }
    // Without this guard, a stale-but-still-running poller dispatched against
    // a delayed RPC mirror could rewind the cursor and cause endless re-
    // ingestion of already-absorbed events on every subsequent poll.
    const event = {
      eventName: "TickAdvanced",
      args: { closedTick: "9", openedTick: "10", tickSeed: "0xdead" },
      transactionHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      blockNumber: 300,
      logIndex: 0,
    };
    const { db, tables } = createDb({
      eventCheckpoint: [
        { _id: "eventCheckpoint:0", _creationTime: 0, lastBlock: 1000 },
      ],
    });

    await (ingestEvents as any)._handler(
      { db },
      {
        events: [event],
        blockNumber: 300,
        txHash: event.transactionHash,
        advanceCheckpoint: true,
      },
    );

    // Checkpoint must NOT have regressed from 1000 → 300.
    expect(tables.eventCheckpoint?.[0]?.lastBlock).toBe(1000);
  });

  it("two events at the same block with different logIndex both ingest (logIndex is part of the unique key)", async () => {
    // Defends against a bad fix that uses ONLY txHash as the dedup key —
    // multicall txs emit multiple logs from the same tx, and each must be
    // kept. Different logIndex values must not collide.
    const txHash =
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const { db, tables } = createDb();
    await (ingestEvents as any)._handler(
      { db },
      {
        events: [
          {
            eventName: "TickAdvanced",
            args: { closedTick: "1", openedTick: "2", tickSeed: "0x01" },
            transactionHash: txHash,
            blockNumber: 100,
            logIndex: 0,
          },
          {
            eventName: "TickAdvanced",
            args: { closedTick: "2", openedTick: "3", tickSeed: "0x02" },
            transactionHash: txHash,
            blockNumber: 100,
            logIndex: 1,
          },
        ],
        blockNumber: 100,
        txHash,
        advanceCheckpoint: false,
      },
    );

    expect(tables.chainEvents).toHaveLength(2);
    expect(tables.chainEvents?.map((r) => r.logIndex).sort()).toEqual([0, 1]);
    // tickHistory should also have BOTH entries (one per TickAdvanced log).
    expect(tables.tickHistory).toHaveLength(2);
  });
});

describe("resetEventLog — concurrent completion attempts", () => {
  it("same elder completing the SAME resetEventId twice succeeds (last-write-wins on completedAt)", async () => {
    // Pin current behavior: completeResetEvent does NOT guard against
    // re-completion. The second patch just overwrites completedAt with the
    // new Date.now(). This is benign (the row stays "completed" either way)
    // but a tightened version should guard with a "already completed" early-
    // return. For now, document the behavior to surface any future shift.
    const { db, tables } = createDb();
    const resetEventId = await call(recordResetEvent, db, {
      elderId: "elder-1",
      secret: "secret-1",
      resetTick: 100,
      reason: "scheduled",
    });

    await call(completeResetEvent, db, {
      elderId: "elder-1",
      secret: "secret-1",
      resetEventId,
    });
    const firstCompletedAt = tables.resetEventLog?.[0]?.completedAt;
    expect(firstCompletedAt).toEqual(expect.any(Number));

    // Force Date.now to advance so we can detect the overwrite.
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue((firstCompletedAt as number) + 999_999);
    try {
      await call(completeResetEvent, db, {
        elderId: "elder-1",
        secret: "secret-1",
        resetEventId,
      });
    } finally {
      nowSpy.mockRestore();
    }
    const secondCompletedAt = tables.resetEventLog?.[0]?.completedAt;
    expect(secondCompletedAt).toBe((firstCompletedAt as number) + 999_999);
  });
});

describe("consumePendingMessages — partial-failure rollback contract", () => {
  it("a single foreign-owned message in the batch rejects the WHOLE batch (no partial patch)", async () => {
    // Current behavior: consumePendingMessages does ownership validation in
    // a loop BEFORE any patch. If any message is foreign-owned, the throw
    // happens before the first patch runs — so no partial state. Tests
    // runner.test.ts already cover the single-foreign-message case; this
    // hardens the MIXED case (one own, one foreign) which is the realistic
    // race: another elder's hook posted into our pending queue while we
    // were mid-flight.
    const { db, tables } = createDb({
      pendingMessages: [
        {
          _id: "pendingMessages:1",
          _creationTime: 1,
          targetElderId: "elder-1",
          text: "mine",
          source: "user-message",
          insertedAt: 1,
          consumedAt: undefined,
        },
        {
          _id: "pendingMessages:2",
          _creationTime: 2,
          targetElderId: "elder-2",
          text: "theirs",
          source: "user-message",
          insertedAt: 2,
          consumedAt: undefined,
        },
      ],
    });

    await expect(
      call(consumePendingMessages, db, {
        elderId: "elder-1",
        secret: "secret-1",
        messageIds: ["pendingMessages:1", "pendingMessages:2"],
        consumedAt: 999,
      }),
    ).rejects.toThrow("does not belong to elder-1");

    // CRITICAL: neither row should have consumedAt set. The loop must throw
    // BEFORE any patch runs, otherwise we'd have a half-consumed batch and
    // the next retry would re-consume the un-patched rows + try (and fail)
    // to re-consume the already-patched ones.
    expect(tables.pendingMessages?.[0]?.consumedAt).toBeUndefined();
    expect(tables.pendingMessages?.[1]?.consumedAt).toBeUndefined();
  });
});

describe("sendWhisper — concurrent dedupe contract", () => {
  beforeEach(() => {
    vi.stubEnv("INDEXER_SECRET", "test-secret");
  });

  it("sequential sends with the SAME msgId dedupe — only one persists", async () => {
    // Sequential calls hit the lookup-then-insert path on the second invocation
    // and see the existing row, so they short-circuit. This is the realistic
    // single-process retry pattern.
    const { db, tables } = createDb();
    const args = {
      secret: "test-secret",
      tick: 11,
      fromClanId: 3,
      toClanIds: [4, 5],
      body: "rally at the bridge",
      msgId: "3:11:rally",
    };

    await call(sendWhisper, db, args);
    await call(sendWhisper, db, args);
    await call(sendWhisper, db, args);

    expect(tables.whispers).toHaveLength(1);
  });

  it("FINDING: concurrent (Promise.all) sends with SAME msgId can ALL insert — dedupe is lookup-then-insert, not atomic", async () => {
    // In production Convex serializes mutations against the same document, so
    // this race is normally harmless. But the dedupe is NOT structurally
    // race-free: it's a read-modify-write pair with no unique-key constraint
    // backing it. If two Convex mutations targeting different rows of the
    // `whispers` table executed concurrently (Convex can parallelize
    // mutations that don't conflict on writes-they-haven't-yet-written), the
    // check-then-insert pair could interleave and both INSERTs would land.
    //
    // Documented behavior under Promise.all in-memory: all three lookups see
    // an empty table, all three inserts land → 3 duplicate rows. This pins
    // the structural-race shape so a future fix (e.g. unique index on
    // (fromClanId, tick, msgId) + insert-with-uniqueness-throw) flips the
    // assertion to 1, and the test diff documents the hardening.
    //
    // See feedback_bundle4_over_engineering_filter_pattern (Liam: harmless
    // races on debug-tier surfaces are often acceptable). Whether to actually
    // harden this is a product call, not a test call.
    const { db, tables } = createDb();
    const args = {
      secret: "test-secret",
      tick: 11,
      fromClanId: 3,
      toClanIds: [4, 5],
      body: "rally at the bridge",
      msgId: "3:11:rally",
    };

    await Promise.all([
      call(sendWhisper, db, args),
      call(sendWhisper, db, args),
      call(sendWhisper, db, args),
    ]);

    // PIN current structural behavior: all three slip through the dedupe.
    expect(tables.whispers).toHaveLength(3);
  });

  it("concurrent sends WITHOUT msgId DO duplicate — caller must supply msgId for at-most-once delivery", async () => {
    // Negative test for the dedupe contract: callers that omit msgId are
    // opting into at-least-once semantics. This pins that escape hatch so
    // a future "always dedupe" change is loudly visible as a test diff.
    const { db, tables } = createDb();
    const args = {
      secret: "test-secret",
      tick: 12,
      fromClanId: 3,
      toClanIds: [4],
      body: "scout",
    };

    await call(sendWhisper, db, args);
    await call(sendWhisper, db, args);

    expect(tables.whispers).toHaveLength(2);
  });

  it("two whispers with same (fromClanId, tick) but DIFFERENT msgId are independent (msgId is part of dedupe key)", async () => {
    // Validates msgId granularity: a clan can legitimately whisper twice in
    // the same tick (e.g. one to ally A, one to ally B with different bodies)
    // as long as msgIds differ.
    const { db, tables } = createDb();
    const base = {
      secret: "test-secret",
      tick: 13,
      fromClanId: 5,
      toClanIds: [1],
      body: "x",
    };

    await call(sendWhisper, db, { ...base, msgId: "5:13:a" });
    await call(sendWhisper, db, { ...base, msgId: "5:13:b" });

    expect(tables.whispers).toHaveLength(2);
  });
});
