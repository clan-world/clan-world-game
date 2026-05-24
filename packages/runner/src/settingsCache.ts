import type { GameSettings } from "./types.js";

export function settingsEqual(a: GameSettings, b: GameSettings): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

export function describeSettingsDrift(a: GameSettings, b: GameSettings): string {
  const changed: string[] = [];
  const left = stable(a) as unknown as Record<string, unknown>;
  const right = stable(b) as unknown as Record<string, unknown>;
  for (const key of Object.keys(left)) {
    if (left[key] !== right[key]) {
      changed.push(`${key}: boot=${String(left[key])} current=${String(right[key])}`);
    }
  }
  return changed.length === 0 ? "no drift" : changed.join("; ");
}

function stable(settings: GameSettings): GameSettings {
  return {
    heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds,
    memoryWipeTickInterval: settings.memoryWipeTickInterval,
    winterStartTick: settings.winterStartTick,
    winterDurationTicks: settings.winterDurationTicks,
    winterPeriodTicks: settings.winterPeriodTicks,
    seasonDurationTicks: settings.seasonDurationTicks,
    contractAddress: settings.contractAddress,
  };
}
