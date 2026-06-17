import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectMessage } from "./adminMessages";

// adminMessages.injectMessage has ZERO baseline test coverage despite being
// the SOLE caller of requireBusOperatorSecret. The mutation is reachable from
// the operator console / cockpit API and writes into the same pendingMessages
// table the runner drains. Every reject branch below is currently untested.

function createDb(tables: Record<string, any[]> = {}) {
  return {
    tables,
    db: {
      async insert(table: string, row: Record<string, unknown>) {
        tables[table] ??= [];
        const id = `${table}:${tables[table].length + 1}`;
        tables[table].push({ _id: id, _creationTime: tables[table].length + 1, ...row });
        return id;
      },
    },
  };
}

function call(fn: any, db: any, args: any) {
  return fn._handler({ db }, args);
}

beforeEach(() => {
  vi.stubEnv("BUS_OPERATOR_SECRET", "op-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("adminMessages.injectMessage", () => {
  it("inserts a pendingMessages row when auth + text are valid", async () => {
    const { db, tables } = createDb();
    const id = await call(injectMessage, db, {
      secret: "op-secret",
      targetElderId: "elder-1",
      text: "stay alert",
      source: "admin-injection",
    });
    expect(id).toBe("pendingMessages:1");
    expect(tables.pendingMessages?.[0]).toMatchObject({
      targetElderId: "elder-1",
      text: "stay alert",
      source: "admin-injection",
    });
    // Secret must NEVER be persisted into the queue.
    expect(tables.pendingMessages?.[0]?.secret).toBeUndefined();
  });

  it("trims surrounding whitespace before insert", async () => {
    const { db, tables } = createDb();
    await call(injectMessage, db, {
      secret: "op-secret",
      targetElderId: "elder-2",
      text: "   trimmed body   ",
      source: "user-message",
    });
    expect(tables.pendingMessages?.[0]?.text).toBe("trimmed body");
  });

  it("rejects when the supplied operator secret is wrong", async () => {
    const { db, tables } = createDb();
    await expect(call(injectMessage, db, {
      secret: "wrong",
      targetElderId: "elder-1",
      text: "x",
      source: "admin-injection",
    })).rejects.toThrow("invalid bus operator secret");
    expect(tables.pendingMessages).toBeUndefined();
  });

  it("rejects when BUS_OPERATOR_SECRET is unset on the deployment", async () => {
    // Critical fail-closed: a misconfigured Convex deployment must NOT accept
    // anonymous writes to the operator surface.
    vi.stubEnv("BUS_OPERATOR_SECRET", "");
    const { db, tables } = createDb();
    await expect(call(injectMessage, db, {
      secret: "anything",
      targetElderId: "elder-1",
      text: "x",
      source: "admin-injection",
    })).rejects.toThrow("BUS_OPERATOR_SECRET is not configured on this Convex deployment");
    expect(tables.pendingMessages).toBeUndefined();
  });

  it("rejects empty / whitespace-only text post-trim", async () => {
    const { db, tables } = createDb();
    await expect(call(injectMessage, db, {
      secret: "op-secret",
      targetElderId: "elder-1",
      text: "",
      source: "admin-injection",
    })).rejects.toThrow("text is required");
    await expect(call(injectMessage, db, {
      secret: "op-secret",
      targetElderId: "elder-1",
      text: "      ",
      source: "admin-injection",
    })).rejects.toThrow("text is required");
    expect(tables.pendingMessages).toBeUndefined();
  });

  it("rejects text longer than 2000 characters AFTER trimming", async () => {
    // The cap is checked post-trim, so leading/trailing whitespace doesn't
    // help squeeze under the limit. Both raw-2001 and trim-still-2001 fail.
    const { db, tables } = createDb();
    const raw = "a".repeat(2001);
    await expect(call(injectMessage, db, {
      secret: "op-secret",
      targetElderId: "elder-1",
      text: raw,
      source: "admin-injection",
    })).rejects.toThrow("text must be 2000 characters or fewer");

    // Pad with whitespace that trims away to ~2001 chars body.
    const padded = `   ${"b".repeat(2001)}   `;
    await expect(call(injectMessage, db, {
      secret: "op-secret",
      targetElderId: "elder-1",
      text: padded,
      source: "admin-injection",
    })).rejects.toThrow("text must be 2000 characters or fewer");
    expect(tables.pendingMessages).toBeUndefined();
  });

  it("accepts exactly 2000 characters as the boundary", async () => {
    // Inclusive cap — `> 2000` rejects, `== 2000` passes. Documents the
    // contract so a regression that flips to `>= 2000` is caught.
    const { db, tables } = createDb();
    const exact = "z".repeat(2000);
    await call(injectMessage, db, {
      secret: "op-secret",
      targetElderId: "elder-1",
      text: exact,
      source: "admin-injection",
    });
    expect(tables.pendingMessages?.[0]?.text).toHaveLength(2000);
  });
});
