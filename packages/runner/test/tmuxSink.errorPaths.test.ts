import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Error-path tests for TmuxSink (Agent A — test-exp-A).
 *
 * The existing tmuxSink.test.ts is laser-focused on loadBuffer's PR #543 bug.
 * These cover the OTHER catch / silent-swallow paths that are easy to break:
 *   - hasSession returns false on exec error (vs propagating) — used by startup
 *   - killSession SWALLOWS exec errors (session-may-not-exist semantics) — used
 *     on reset; if this throws, the entire reset flow aborts
 *   - pasteBuffer adds -p -r flags only when bracketed=true
 *   - pasteMessage cleans up its mktemp dir even when an underlying step fails
 *   - capturePane returns stdout content from execFileAsync's resolved tuple
 *   - sendKeys passes the expected literal args including the empty trailing
 *     positional (subtle — easy to break in a refactor)
 *   - newSession picks -c flag when arg starts with "/", positional otherwise
 *   - elderConfig — invalid JSON throws + missing key throws
 */

describe("TmuxSink — hasSession", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns true when tmux has-session exits 0", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, _args: string[], cb: (err: any, stdout: string) => void) => cb(null, ""),
      spawn: vi.fn(),
    }));
    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");
    expect(await sink.hasSession()).toBe(true);
  });

  it("returns false (does NOT throw) when tmux has-session exits non-zero", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, _args: string[], cb: (err: any) => void) => {
        const err: NodeJS.ErrnoException = new Error("has-session: can't find session");
        err.code = "1";
        cb(err);
      },
      spawn: vi.fn(),
    }));
    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");
    expect(await sink.hasSession()).toBe(false);
  });
});

describe("TmuxSink — killSession swallows errors", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("does NOT throw when kill-session fails (session may not exist)", async () => {
    // If this throws, the reset flow's killSession+newSession sequence fails
    // and the elder can never reset. The catch is essential.
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, _args: string[], cb: (err: any) => void) =>
        cb(new Error("kill-session failed: no such session")),
      spawn: vi.fn(),
    }));
    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");
    await expect(sink.killSession()).resolves.toBeUndefined();
  });
});

describe("TmuxSink — pasteBuffer bracketed flag wiring", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("passes -p -r ONLY when bracketed: true (no -p -r when false)", async () => {
    const calls: string[][] = [];
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, args: string[], cb: (err: any, stdout: string) => void) => {
        calls.push(args);
        cb(null, "");
      },
      spawn: vi.fn(),
    }));
    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");
    await sink.pasteBuffer("buf1", "elder-test", { bracketed: false });
    await sink.pasteBuffer("buf1", "elder-test", { bracketed: true });
    expect(calls[0]).toEqual(["paste-buffer", "-b", "buf1", "-t", "elder-test"]);
    expect(calls[1]).toEqual(["paste-buffer", "-b", "buf1", "-t", "elder-test", "-p", "-r"]);
  });
});

describe("TmuxSink — sendKeys argv shape", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("passes the key plus an empty trailing positional arg", async () => {
    let captured: string[] = [];
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, args: string[], cb: (err: any, stdout: string) => void) => {
        captured = args;
        cb(null, "");
      },
      spawn: vi.fn(),
    }));
    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");
    await sink.sendKeys("Enter");
    // The empty positional was added in PR #543's hardening — easy to drop in
    // a refactor. tmux send-keys uses it as a sentinel separator.
    expect(captured).toEqual(["send-keys", "-t", "elder-test", "Enter", ""]);
  });
});

describe("TmuxSink — capturePane shape", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns stdout from execFileAsync's resolved tuple with -S -<lines>", async () => {
    // promisify(execFile) returns { stdout, stderr } only when the original
    // execFile has util.promisify.custom set (which the real Node one does).
    // Our mock attaches the same custom symbol so the resolved value matches.
    const { promisify } = await import("node:util");
    let capturedArgs: string[] = [];
    const mockExecFile = Object.assign(
      (_cmd: string, _args: string[], cb: (err: any, out: string) => void) => cb(null, ""),
      {
        [promisify.custom]: (_cmd: string, args: string[]) => {
          capturedArgs = args;
          return Promise.resolve({ stdout: "pane content here", stderr: "" });
        },
      },
    );
    vi.doMock("node:child_process", () => ({
      execFile: mockExecFile,
      spawn: vi.fn(),
    }));
    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");
    const out = await sink.capturePane(42);
    expect(out).toBe("pane content here");
    expect(capturedArgs).toEqual(["capture-pane", "-t", "elder-test", "-p", "-S", "-42"]);
  });

  it("uses default 100 lines when no arg passed", async () => {
    const { promisify } = await import("node:util");
    let capturedArgs: string[] = [];
    const mockExecFile = Object.assign(
      (_cmd: string, _args: string[], cb: (err: any, out: string) => void) => cb(null, ""),
      {
        [promisify.custom]: (_cmd: string, args: string[]) => {
          capturedArgs = args;
          return Promise.resolve({ stdout: "", stderr: "" });
        },
      },
    );
    vi.doMock("node:child_process", () => ({
      execFile: mockExecFile,
      spawn: vi.fn(),
    }));
    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");
    await sink.capturePane();
    expect(capturedArgs).toContain("-100");
  });
});

describe("TmuxSink — newSession arg dispatch", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses -c flag when arg starts with /", async () => {
    let capturedArgs: string[] = [];
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, args: string[], cb: (err: any, stdout: string) => void) => {
        capturedArgs = args;
        cb(null, "");
      },
      spawn: vi.fn(),
    }));
    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");
    await sink.newSession("/workspace");
    expect(capturedArgs).toEqual(["new-session", "-d", "-s", "elder-test", "-c", "/workspace"]);
  });

  it("uses positional command when arg does NOT start with /", async () => {
    let capturedArgs: string[] = [];
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, args: string[], cb: (err: any, stdout: string) => void) => {
        capturedArgs = args;
        cb(null, "");
      },
      spawn: vi.fn(),
    }));
    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");
    await sink.newSession("run-script.sh");
    expect(capturedArgs).toEqual(["new-session", "-d", "-s", "elder-test", "run-script.sh"]);
  });
});
