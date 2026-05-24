import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectTemplates } from "../src/templateLoader.js";
import type { RunnerAuxiliary } from "../src/types.js";

const promptDir = path.join(process.cwd(), "test/fixtures/prompts");

function aux(tick: number, overrides: Partial<RunnerAuxiliary> = {}): RunnerAuxiliary {
  return {
    tickClock: {
      tick,
      tickEpochStartedAt: 0,
      tickEpochDurationMs: 60_000,
      heartbeatIntervalSeconds: 60,
      seasonStartTick: 0,
      seasonEndTick: 360,
      winterActive: false,
      winterStartsAtTick: 110,
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

describe("selectTemplates", () => {
  it("selects game start at tick zero", async () => {
    const templates = await selectTemplates(promptDir, aux(0));
    expect(templates.map(t => t.fileName)).toContain("00_game_start.md");
  });

  it("selects memory-wipe warning and post-wipe templates", async () => {
    expect((await selectTemplates(promptDir, aux(45))).map(t => t.fileName))
      .toContain("05_pre_memory_wipe_5ticks.md");
    expect((await selectTemplates(promptDir, aux(49))).map(t => t.fileName))
      .toContain("06_pre_memory_wipe_1tick.md");
    expect((await selectTemplates(promptDir, aux(50))).map(t => t.fileName))
      .toContain("07_post_memory_wipe.md");
  });

  it("selects event-driven bandit templates", async () => {
    const templates = await selectTemplates(promptDir, aux(10, {
      chainEvents: [{ eventName: "BanditSpawned", tick: 10, args: {} }],
      banditView: { exists: true, id: 1, state: 3, stateEnteredTick: 10, nextActionTick: 13 },
    }));
    expect(templates.map(t => t.fileName)).toEqual([
      "20_bandits_appeared.md",
      "21_bandits_attacking.md",
    ]);
  });
});
