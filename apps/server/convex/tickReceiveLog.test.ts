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
});
