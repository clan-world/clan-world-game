import { describe, expect, it } from "vitest";
import { describeSettingsDrift, settingsEqual } from "../src/settingsCache.js";
import type { GameSettings } from "../src/types.js";

const settings: GameSettings = {
  heartbeatIntervalSeconds: 60,
  memoryWipeTickInterval: 50,
  winterStartTick: 110,
  winterDurationTicks: 10,
  winterPeriodTicks: 110,
  seasonDurationTicks: 360,
  contractAddress: "0xabc",
};

describe("settings cache drift", () => {
  it("detects identical settings", () => {
    expect(settingsEqual(settings, { ...settings })).toBe(true);
  });

  it("describes drift", () => {
    const changed = { ...settings, memoryWipeTickInterval: 60 };
    expect(settingsEqual(settings, changed)).toBe(false);
    expect(describeSettingsDrift(settings, changed)).toContain("memoryWipeTickInterval");
  });
});
