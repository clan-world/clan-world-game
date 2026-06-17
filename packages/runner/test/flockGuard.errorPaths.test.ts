import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireFlock } from "../src/flockGuard.js";

/**
 * Error-path tests for flockGuard.ts (Agent A — test-exp-A).
 *
 * No existing test for acquireFlock. The function is the boot-time guard
 * preventing two runners from sharing a tmux session (which would race on
 * stdin and silently lose commands). Branches covered:
 *   - successful acquisition returns a release() function
 *   - release() is idempotent (second call is a no-op)
 *   - flock failure throws including the lock path AND stderr message
 *   - flock failure when stderr is empty still throws (path-only message)
 *   - intermediate directories are created
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flock-err-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("acquireFlock — release semantics", () => {
  it("returns a handle whose release() is idempotent", () => {
    const lockPath = path.join(dir, "lock");
    const handle = acquireFlock(lockPath);
    expect(typeof handle.release).toBe("function");
    handle.release();
    // Second release must not throw (e.g. EBADF from re-closing the fd).
    expect(() => handle.release()).not.toThrow();
  });

  it("creates intermediate directories for the lock path", () => {
    const lockPath = path.join(dir, "nested", "subdir", "lock");
    const handle = acquireFlock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(true);
    handle.release();
  });
});

describe("acquireFlock — failure paths via mocked spawnSync", () => {
  it("throws with the lock path and stderr when flock exits non-zero", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawnSync: vi.fn(() => ({
        status: 1,
        stderr: "flock: cannot lock (would block)",
        stdout: "",
      })),
    }));
    const { acquireFlock: scopedAcquireFlock } = await import("../src/flockGuard.js");
    const lockPath = path.join(dir, "scoped-lock");
    expect(() => scopedAcquireFlock(lockPath)).toThrow(
      new RegExp(`could not acquire flock ${lockPath.replace(/[/\\]/g, "[/\\\\]")}: flock: cannot lock`),
    );
  });

  it("throws with the lock path alone when stderr is empty", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawnSync: vi.fn(() => ({ status: 1, stderr: "", stdout: "" })),
    }));
    const { acquireFlock: scopedAcquireFlock } = await import("../src/flockGuard.js");
    const lockPath = path.join(dir, "no-stderr-lock");
    expect(() => scopedAcquireFlock(lockPath)).toThrow(/could not acquire flock/);
  });

  it("closes the fd before throwing (no resource leak on failure)", async () => {
    vi.resetModules();
    const closedFds: number[] = [];
    const originalClose = fs.closeSync;
    vi.spyOn(fs, "closeSync").mockImplementation((fd: number) => {
      closedFds.push(fd);
      // Don't actually close (the fd in the test was opened by the real fs).
      try { originalClose(fd); } catch { /* already closed */ }
    });
    vi.doMock("node:child_process", () => ({
      spawnSync: vi.fn(() => ({ status: 1, stderr: "EWOULDBLOCK", stdout: "" })),
    }));
    const { acquireFlock: scopedAcquireFlock } = await import("../src/flockGuard.js");
    const lockPath = path.join(dir, "cleanup-lock");
    expect(() => scopedAcquireFlock(lockPath)).toThrow();
    // The opened fd must have been closed before the throw — otherwise the
    // process leaks file descriptors on every failed acquisition attempt.
    expect(closedFds.length).toBeGreaterThan(0);
  });
});

describe("oneClaudeCheck — assert branch", () => {
  beforeEach(() => vi.resetModules());

  it("does NOT throw when exactly one claude process is running", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, _args: string[], cb: (err: any, stdout: string) => void) => cb(null, "1234\n"),
    }));
    const { assertOneClaudeProcess } = await import("../src/oneClaudeCheck.js");
    await expect(assertOneClaudeProcess()).resolves.toBeUndefined();
  });

  it("does NOT throw when zero claude processes are running (pgrep exit 1)", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, _args: string[], cb: (err: any) => void) => cb({ code: 1 }),
    }));
    const { assertOneClaudeProcess } = await import("../src/oneClaudeCheck.js");
    // Note: assertOneClaudeProcess only throws on count > 1. Count == 0 is OK
    // (we haven't launched claude yet) — only the supervisor's separate
    // launch logic decides whether to start one.
    await expect(assertOneClaudeProcess()).resolves.toBeUndefined();
  });

  it("rethrows non-exit-1 errors from pgrep (unexpected failure mode)", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, _args: string[], cb: (err: any) => void) => {
        const err: any = new Error("pgrep killed by signal");
        err.code = 137;
        cb(err);
      },
    }));
    const { countClaudeProcesses } = await import("../src/oneClaudeCheck.js");
    await expect(countClaudeProcesses()).rejects.toThrow(/pgrep killed/);
  });
});
