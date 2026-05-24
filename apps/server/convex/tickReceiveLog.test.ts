import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordReceive } from "./tickReceiveLog";

function createDb(tables: Record<string, any[]> = {}) {
  return {
    async insert(table: string, row: Record<string, unknown>) {
      const id = `${table}:${(tables[table] ?? []).length + 1}`;
      tables[table] ??= [];
      tables[table].push({ _id: id, _creationTime: tables[table].length + 1, ...row });
      return id;
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

describe("tickReceiveLog.recordReceive", () => {
  it("records a receipt with the matching elder secret", async () => {
    const tables: Record<string, any[]> = {};
    const db = createDb(tables);

    const id = await call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "tick",
      tickNumber: 9,
      messagePreview: "tick 9",
    });

    expect(id).toBe("tickReceiveLog:1");
    expect(tables.tickReceiveLog?.[0]).toMatchObject({
      elderId: "elder-1",
      prefix: "tick",
      tickNumber: 9,
      messagePreview: "tick 9",
    });
    expect(tables.tickReceiveLog?.[0]?.secret).toBeUndefined();
  });

  it("rejects a secret from another elder", async () => {
    const db = createDb();

    await expect(call(recordReceive, db, {
      secret: "secret-2",
      elderId: "elder-1",
      prefix: "tick",
      tickNumber: 9,
      messagePreview: "tick 9",
    })).rejects.toThrow("invalid bus elder secret");
  });

  // ---- prefix/id-field cross-validation (Agent A: untested error paths) ----
  // The handler in tickReceiveLog.ts enforces a 3x3 prefix→required-id matrix
  // (tick needs tickNumber + must NOT set whisper/special; whisper needs
  // whisperUid + must NOT set tick/special; etc). Baseline tests only cover
  // the happy "tick" path. Each branch below catches a regression that would
  // silently insert mis-shaped rows the runner can't decode.

  it("prefix=tick rejects when tickNumber missing", async () => {
    const db = createDb();
    await expect(call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "tick",
      messagePreview: "tick ?",
    })).rejects.toThrow("prefix=tick requires tickNumber");
  });

  it("prefix=tick rejects when whisperUid or specialMsgUid bleeds in", async () => {
    const db = createDb();
    await expect(call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "tick",
      tickNumber: 9,
      whisperUid: "stray",
      messagePreview: "x",
    })).rejects.toThrow("prefix=tick must not set whisperUid or specialMsgUid");

    await expect(call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "tick",
      tickNumber: 9,
      specialMsgUid: "stray",
      messagePreview: "x",
    })).rejects.toThrow("prefix=tick must not set whisperUid or specialMsgUid");
  });

  it("prefix=whisper rejects when whisperUid missing", async () => {
    const db = createDb();
    await expect(call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "whisper",
      messagePreview: "w",
    })).rejects.toThrow("prefix=whisper requires whisperUid");
  });

  it("prefix=whisper rejects when tickNumber or specialMsgUid bleeds in", async () => {
    const db = createDb();
    await expect(call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "whisper",
      whisperUid: "uid-1",
      tickNumber: 9,
      messagePreview: "x",
    })).rejects.toThrow("prefix=whisper must not set tickNumber or specialMsgUid");

    await expect(call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "whisper",
      whisperUid: "uid-1",
      specialMsgUid: "uid-2",
      messagePreview: "x",
    })).rejects.toThrow("prefix=whisper must not set tickNumber or specialMsgUid");
  });

  it("prefix=special-msg rejects when specialMsgUid missing", async () => {
    const db = createDb();
    await expect(call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "special-msg",
      messagePreview: "s",
    })).rejects.toThrow("prefix=special-msg requires specialMsgUid");
  });

  it("prefix=special-msg rejects when tickNumber or whisperUid bleeds in", async () => {
    const db = createDb();
    await expect(call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "special-msg",
      specialMsgUid: "s",
      tickNumber: 9,
      messagePreview: "x",
    })).rejects.toThrow("prefix=special-msg must not set tickNumber or whisperUid");

    await expect(call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "special-msg",
      specialMsgUid: "s",
      whisperUid: "w",
      messagePreview: "x",
    })).rejects.toThrow("prefix=special-msg must not set tickNumber or whisperUid");
  });

  it("truncates oversized messagePreview and uid fields to enforced caps", async () => {
    // MESSAGE_PREVIEW_MAX = 100, UID_MAX = 200. Without these slices a
    // hostile/buggy caller could persist multi-MB strings into the indexed
    // table. Worth a check so a future refactor that drops the .slice()
    // truncation is caught.
    const tables: Record<string, any[]> = {};
    const db = createDb(tables);

    const huge = "x".repeat(500);
    const longUid = "u".repeat(500);

    await call(recordReceive, db, {
      secret: "secret-1",
      elderId: "elder-1",
      prefix: "whisper",
      whisperUid: longUid,
      messagePreview: huge,
    });

    const row = tables.tickReceiveLog?.[0];
    expect(row?.messagePreview).toHaveLength(100);
    expect(row?.whisperUid).toHaveLength(200);
    // Secret never persisted — defensive check; baseline already covers happy.
    expect(row?.secret).toBeUndefined();
  });

  it("ALWAYS gates on the elder secret BEFORE prefix validation", async () => {
    // If a future refactor reorders validation so prefix-checks run first,
    // a foreign elder could probe argument shape errors to fingerprint the
    // schema. The "invalid bus elder secret" message must win.
    const db = createDb();
    await expect(call(recordReceive, db, {
      secret: "secret-2",
      elderId: "elder-1",
      prefix: "tick",
      // intentionally missing tickNumber — that error would fire if
      // requireBusElderSecret were skipped.
      messagePreview: "x",
    })).rejects.toThrow("invalid bus elder secret");
  });
});
