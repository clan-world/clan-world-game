import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectTemplates } from "../src/templateLoader.js";
import type { RunnerAuxiliary } from "../src/types.js";

/**
 * Error-path tests for templateLoader.ts (Agent A — test-exp-A).
 *
 * Existing happy-path coverage is solid. These exercise:
 *   - non-ENOENT fs errors propagate (e.g. EACCES on a denied file)
 *   - whitespace-only template content is filtered OUT (no empty section
 *     pollutes the composed message — would otherwise create a bare "---"
 *     separator with no body)
 *   - memoryWipeTickInterval <= 0 short-circuits ticksUntilNextMemoryWipe to
 *     Infinity (no spurious pre-wipe-5 / pre-wipe-1 templates selected)
 *   - missing prompt files (ENOENT) are silently skipped with a warn log
 *   - winter ended template lands exactly at startTick + durationTicks
 *   - ClansmanRevived event-driven template is selected
 *   - ResourcesInjected (the alternate trigger) also selects the revived template
 *   - both BanditAttackResolved + bandit attacking can co-trigger
 */

const promptDir = path.join(process.cwd(), "test/fixtures/prompts");
let tmpPromptDir: string;

beforeEach(() => {
  tmpPromptDir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-err-"));
});

afterEach(() => {
  fs.rmSync(tmpPromptDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function aux(tick: number, overrides: Partial<RunnerAuxiliary> = {}): RunnerAuxiliary {
  return {
    tickClock: {
      tick,
      tickEpochStartedAt: 0,
      tickEpochDurationMs: 60_000,
      seasonStartTick: 0,
      seasonEndTick: 360,
      winterActive: false,
    },
    gameSettings: {
      heartbeatIntervalSeconds: 60,
      memoryWipeTickInterval: 50,
      winterStartTick: 110,
      winterDurationTicks: 10,
      winterPeriodTicks: 110,
      seasonDurationTicks: 360,
      contractAddress: "0x0",
    },
    banditView: null,
    chainEvents: [],
    pendingMessages: [],
    ...overrides,
  };
}

describe("selectTemplates — silent-skip ENOENT", () => {
  it("logs a warn and returns [] when no triggering template files exist", async () => {
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((msg: unknown) => {
      warns.push(String(msg));
    });
    // tick=0 triggers game_start, but the file doesn't exist in tmpPromptDir.
    const result = await selectTemplates(tmpPromptDir, aux(0));
    expect(result).toEqual([]);
    expect(warns.some((w) => w.includes("missing prompt template 00_game_start.md"))).toBe(true);
  });

  it("filters out files that exist but contain only whitespace", async () => {
    fs.writeFileSync(path.join(tmpPromptDir, "00_game_start.md"), "   \n  \t \n");
    const result = await selectTemplates(tmpPromptDir, aux(0));
    // Whitespace-only content must be filtered — otherwise composeMessage
    // would emit a bare "---" separator with no body, polluting Elder's view.
    expect(result).toEqual([]);
  });

  it("includes templates with leading/trailing whitespace but a real body", async () => {
    fs.writeFileSync(path.join(tmpPromptDir, "00_game_start.md"), "  \n  real content\n  ");
    const result = await selectTemplates(tmpPromptDir, aux(0));
    expect(result).toHaveLength(1);
    expect(result[0]?.fileName).toBe("00_game_start.md");
    expect(result[0]?.content).toContain("real content");
  });
});

describe("selectTemplates — non-ENOENT propagation", () => {
  it("rethrows fs errors that are NOT ENOENT (e.g. EACCES)", async () => {
    // Spy on fs.readFile to throw EACCES for the game_start template.
    vi.spyOn(fs.promises, "readFile").mockImplementation(async () => {
      const err: NodeJS.ErrnoException = new Error("permission denied");
      err.code = "EACCES";
      throw err;
    });
    await expect(selectTemplates(tmpPromptDir, aux(0))).rejects.toThrow(/permission denied/);
  });
});

describe("selectTemplates — memoryWipeTickInterval edge cases", () => {
  it("does NOT select pre-wipe templates when memoryWipeTickInterval is 0", async () => {
    const settings = aux(5, {
      gameSettings: {
        heartbeatIntervalSeconds: 60,
        memoryWipeTickInterval: 0,
        winterStartTick: 1000,
        winterDurationTicks: 10,
        winterPeriodTicks: 100,
        seasonDurationTicks: 360,
        contractAddress: "0x0",
      },
    });
    const result = await selectTemplates(promptDir, settings);
    expect(result.map((t) => t.fileName)).not.toContain("05_pre_memory_wipe_5ticks.md");
    expect(result.map((t) => t.fileName)).not.toContain("06_pre_memory_wipe_1tick.md");
    expect(result.map((t) => t.fileName)).not.toContain("07_post_memory_wipe.md");
  });

  it("does NOT select pre-wipe templates when memoryWipeTickInterval is negative", async () => {
    const settings = aux(5, {
      gameSettings: {
        heartbeatIntervalSeconds: 60,
        memoryWipeTickInterval: -1,
        winterStartTick: 1000,
        winterDurationTicks: 10,
        winterPeriodTicks: 100,
        seasonDurationTicks: 360,
        contractAddress: "0x0",
      },
    });
    const result = await selectTemplates(promptDir, settings);
    expect(result.map((t) => t.fileName)).not.toContain("05_pre_memory_wipe_5ticks.md");
  });
});

describe("selectTemplates — winter and event-driven branches", () => {
  it("selects winter_ended exactly at winterStartTick + winterDurationTicks", async () => {
    const result = await selectTemplates(promptDir, aux(120));
    expect(result.map((t) => t.fileName)).toContain("12_winter_ended.md");
  });

  it("selects winter_started at winterStartTick", async () => {
    const result = await selectTemplates(promptDir, aux(110));
    expect(result.map((t) => t.fileName)).toContain("11_winter_started.md");
  });

  it("selects clansmen-revived template on ClansmanRevived chain event", async () => {
    const result = await selectTemplates(promptDir, aux(10, {
      chainEvents: [{ eventName: "ClansmanRevived", tick: 10, args: {} }],
    }));
    expect(result.map((t) => t.fileName)).toContain("99_clansmen_revived_and_resources_injected.md");
  });

  it("selects the same template on ResourcesInjected (alternate trigger)", async () => {
    const result = await selectTemplates(promptDir, aux(10, {
      chainEvents: [{ eventName: "ResourcesInjected", tick: 10, args: {} }],
    }));
    expect(result.map((t) => t.fileName)).toContain("99_clansmen_revived_and_resources_injected.md");
  });

  it("does NOT select bandit attacking template when state != 3 (attacking)", async () => {
    const result = await selectTemplates(promptDir, aux(10, {
      banditView: { exists: true, id: 1, state: 1, stateEnteredTick: 10, nextActionTick: 13 },
    }));
    expect(result.map((t) => t.fileName)).not.toContain("21_bandits_attacking.md");
  });

  it("does NOT select bandit attacking template when bandit doesn't exist", async () => {
    const result = await selectTemplates(promptDir, aux(10, {
      banditView: { exists: false, id: 0, state: 3, stateEnteredTick: 10, nextActionTick: 13 },
    }));
    expect(result.map((t) => t.fileName)).not.toContain("21_bandits_attacking.md");
  });

  it("selects post-bandit-attack on BanditAttackResolved event", async () => {
    const result = await selectTemplates(promptDir, aux(10, {
      chainEvents: [{ eventName: "BanditAttackResolved", tick: 10, args: {} }],
    }));
    expect(result.map((t) => t.fileName)).toContain("22_post_bandit_attack.md");
  });
});

describe("selectTemplates — opts.forcePostMemoryWipe", () => {
  it("forces post-wipe template even on a non-wipe tick when opts.forcePostMemoryWipe is true", async () => {
    // Tick 7 is NOT a wipe tick (50 interval). Without the flag, no post-wipe
    // template would be selected. With it, the reset flow's force-flag wins.
    const result = await selectTemplates(promptDir, aux(7), { forcePostMemoryWipe: true });
    expect(result.map((t) => t.fileName)).toContain("07_post_memory_wipe.md");
  });
});
