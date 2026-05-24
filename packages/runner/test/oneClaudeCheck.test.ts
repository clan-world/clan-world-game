import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("oneClaudeCheck", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("counts zero processes when pgrep exits 1", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, _args: string[], cb: (err: any) => void) => cb({ code: 1 }),
    }));
    const { countClaudeProcesses } = await import("../src/oneClaudeCheck.js");
    expect(await countClaudeProcesses()).toBe(0);
  });

  it("fails loud when multiple claude processes exist", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, _args: string[], cb: (err: any, stdout: string) => void) => cb(null, "1\n2\n"),
    }));
    const { assertOneClaudeProcess } = await import("../src/oneClaudeCheck.js");
    await expect(assertOneClaudeProcess()).rejects.toThrow(/invariant/);
  });
});
