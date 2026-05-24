import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

/**
 * Error-path tests for config.ts (Agent A — test-exp-A).
 *
 * loadConfig() is the boot-time validation surface. Every throw branch is a
 * fail-fast on misconfigured production deployment. Existing tests do not
 * exercise any of these branches.
 *
 * Coverage targets:
 *   - missing ELDER_ID + ELDER_N → throws
 *   - invalid ELDER_ID (not in VALID_ELDER_IDS) → throws
 *   - invalid ELDER_N (derived elder-N not in VALID_ELDER_IDS) → throws
 *   - ELDER_ID set but ELDER_N mismatches the derived N → throws
 *   - missing CONVEX_DEPLOY_URL → throws
 *   - secret file path that cannot be read → throws ("Cannot read bus secret")
 *   - parsePositiveInt: empty string → fallback (does NOT throw)
 *   - parsePositiveInt: zero / negative / non-numeric → throws with name
 *   - happy-path loadConfig returns correct shape + uses ELDER_ID-derived N
 *   - ELDER_ID alone (no ELDER_N) still works (derives N from ID)
 */

const ORIGINAL_ENV = process.env;
let secretsDir: string;
let secretsFile: string;

beforeEach(() => {
  secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-config-"));
  secretsFile = path.join(secretsDir, "bus-elder-1");
  fs.writeFileSync(secretsFile, "supersecret\n");
  // Wipe env to start from a known-empty baseline.
  process.env = {};
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  fs.rmSync(secretsDir, { recursive: true, force: true });
});

function baseEnv(): NodeJS.ProcessEnv {
  return {
    ELDER_ID: "elder-1",
    CONVEX_DEPLOY_URL: "http://localhost:3210",
    BUS_ELDER_SECRET_FILE: secretsFile,
    CLAN_WORLD_RUNNER_STATE_DIR: secretsDir,
  };
}

describe("loadConfig — elder identity validation", () => {
  it("throws when neither ELDER_ID nor ELDER_N is set", () => {
    process.env = { CONVEX_DEPLOY_URL: "x", BUS_ELDER_SECRET_FILE: secretsFile };
    expect(() => loadConfig()).toThrow(/ELDER_ID or ELDER_N env var required/);
  });

  it("throws on invalid ELDER_ID", () => {
    process.env = { ...baseEnv(), ELDER_ID: "elder-99" };
    expect(() => loadConfig()).toThrow(/Invalid ELDER_ID: elder-99/);
  });

  it("throws on invalid ELDER_N (out of 1..4 range)", () => {
    process.env = {
      ...baseEnv(),
      ELDER_ID: undefined,
      ELDER_N: "99",
    } as NodeJS.ProcessEnv;
    delete process.env.ELDER_ID;
    expect(() => loadConfig()).toThrow(/Invalid ELDER_N: 99/);
  });

  it("throws when ELDER_ID and ELDER_N disagree", () => {
    process.env = { ...baseEnv(), ELDER_ID: "elder-1", ELDER_N: "2" };
    expect(() => loadConfig()).toThrow(/ELDER_ID \(elder-1\) does not match ELDER_N \(2\)/);
  });

  it("accepts ELDER_ID alone (derives N from the id)", () => {
    process.env = baseEnv();
    const cfg = loadConfig();
    expect(cfg.elderId).toBe("elder-1");
  });

  it("accepts ELDER_N alone (derives elder-N id)", () => {
    process.env = { ...baseEnv(), ELDER_ID: undefined, ELDER_N: "2" } as NodeJS.ProcessEnv;
    delete process.env.ELDER_ID;
    // Need a secrets file matching elder-2 since BUS_ELDER_SECRET_FILE
    // overrides the default; we keep using secretsFile (which is valid).
    const cfg = loadConfig();
    expect(cfg.elderId).toBe("elder-2");
  });
});

describe("loadConfig — required env validation", () => {
  it("throws when CONVEX_DEPLOY_URL is missing", () => {
    process.env = { ELDER_ID: "elder-1", BUS_ELDER_SECRET_FILE: secretsFile };
    expect(() => loadConfig()).toThrow(/CONVEX_DEPLOY_URL env var required/);
  });

  it("throws with the secret file path when the secret file is unreadable", () => {
    const missing = path.join(secretsDir, "does-not-exist");
    process.env = { ...baseEnv(), BUS_ELDER_SECRET_FILE: missing };
    expect(() => loadConfig()).toThrow(new RegExp(`Cannot read bus secret from ${escapeRe(missing)}`));
  });

  it("falls back to the default secret file path when BUS_ELDER_SECRET_FILE is unset", () => {
    // The default is /run/secrets/bus-elder-N, which won't exist in CI.
    // Error message must mention the default path.
    process.env = { ...baseEnv(), BUS_ELDER_SECRET_FILE: undefined } as NodeJS.ProcessEnv;
    delete process.env.BUS_ELDER_SECRET_FILE;
    expect(() => loadConfig()).toThrow(/Cannot read bus secret from \/run\/secrets\/bus-elder-1/);
  });
});

describe("loadConfig — parsePositiveInt validation", () => {
  it.each([
    ["ELDER_RUNTIME_POLL_MS", "0"],
    ["ELDER_RUNTIME_POLL_MS", "-1"],
    ["ELDER_RUNTIME_POLL_MS", "not-a-number"],
    ["ELDER_RUNTIME_HEARTBEAT_MS", "0"],
    ["RUNNER_HOOK_RECEIVE_TIMEOUT_MS", "abc"],
    ["RUNNER_MAX_PASTE_ATTEMPTS", "-5"],
  ])("throws with var name '%s' when value is '%s'", (envVar, val) => {
    process.env = { ...baseEnv(), [envVar]: val };
    expect(() => loadConfig()).toThrow(new RegExp(`${escapeRe(envVar)} must be a positive integer; got '${escapeRe(val)}'`));
  });

  it("uses fallback when an int env var is unset (empty string treated as unset)", () => {
    process.env = baseEnv();
    const cfg = loadConfig();
    expect(cfg.pollIntervalMs).toBe(5000);
    expect(cfg.heartbeatIntervalMs).toBe(30000);
    expect(cfg.maxPasteAttempts).toBe(3);
  });

  it("respects positive overrides", () => {
    process.env = {
      ...baseEnv(),
      ELDER_RUNTIME_POLL_MS: "1000",
      RUNNER_MAX_PASTE_ATTEMPTS: "5",
    };
    const cfg = loadConfig();
    expect(cfg.pollIntervalMs).toBe(1000);
    expect(cfg.maxPasteAttempts).toBe(5);
  });
});

describe("loadConfig — happy path returns full RunnerConfig shape", () => {
  it("populates derived paths from stateDir", () => {
    process.env = baseEnv();
    const cfg = loadConfig();
    expect(cfg.lockPath).toBe(path.join(secretsDir, "elder-runner.lock"));
    expect(cfg.wipeMarkerPath).toBe(path.join(secretsDir, "last-wipe-tick"));
    expect(cfg.readyPath).toBe(path.join(secretsDir, "elder-runtime.ready"));
    expect(cfg.busSecret).toBe("supersecret");
    expect(cfg.runnerSecret).toBe("supersecret");
    expect(cfg.convexUrl).toBe("http://localhost:3210");
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
