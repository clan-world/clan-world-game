import { afterEach, describe, expect, it } from "vitest";
import { getRunnerStatus, updateRunnerStatus } from "./runnerStatus";

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
        async collect() {
          return rows;
        },
      };
      return builder;
    },
    async patch(id: string, patch: Record<string, unknown>) {
      for (const rows of Object.values(tables)) {
        const row = rows.find((candidate) => candidate._id === id);
        if (row) {
          Object.assign(row, patch);
          return;
        }
      }
      throw new Error(`row not found: ${id}`);
    },
    async insert(table: string, row: Record<string, unknown>) {
      const id = `${table}:${(tables[table] ?? []).length + 1}`;
      tables[table] ??= [];
      tables[table].push({ _id: id, ...row });
      return id;
    },
  };
}

describe("getRunnerStatus", () => {
  const originalSecret = process.env.INDEXER_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.INDEXER_SECRET;
    } else {
      process.env.INDEXER_SECRET = originalSecret;
    }
  });

  it("rejects unauthenticated reads", async () => {
    process.env.INDEXER_SECRET = "test-secret";
    const db = createDb({
      runnerStatus: [{
        _creationTime: 1,
        runnerId: "runner-a",
        lastFireResult: "error",
        lastFailureMessage: "https://provider.example/key",
      }],
    });

    await expect(
      (getRunnerStatus as any)._handler({ db }, { secret: "", runnerId: "runner-a" }),
    ).rejects.toThrow("invalid indexer secret");
  });
});

describe("updateRunnerStatus", () => {
  const originalSecret = process.env.INDEXER_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.INDEXER_SECRET;
    } else {
      process.env.INDEXER_SECRET = originalSecret;
    }
  });

  it("clears lastFailureMessage when a success update sends an empty string", async () => {
    process.env.INDEXER_SECRET = "test-secret";
    const tables = {
      runnerStatus: [{
        _id: "runnerStatus:1",
        _creationTime: 1,
        runnerId: "runner-a",
        lastFireResult: "error",
        lastFailureMessage: "rpc down",
      }],
    };
    const db = createDb(tables);

    await (updateRunnerStatus as any)._handler({ db }, {
      secret: "test-secret",
      runnerId: "runner-a",
      lastFireResult: "success",
      lastFailureMessage: "",
    });

    expect(tables.runnerStatus[0]).toMatchObject({
      runnerId: "runner-a",
      lastFireResult: "success",
      lastFailureMessage: "",
    });
  });
});
