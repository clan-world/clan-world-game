import fs from "node:fs/promises";
import path from "node:path";
import type { ChainEvent, GameSettings, RunnerAuxiliary } from "./types.js";

export interface SelectedTemplate {
  fileName: string;
  content: string;
}

const TEMPLATE_FILES = {
  gameStart: "00_game_start.md",
  preMemoryWipe5: "05_pre_memory_wipe_5ticks.md",
  preMemoryWipe1: "06_pre_memory_wipe_1tick.md",
  postMemoryWipe: "07_post_memory_wipe.md",
  preWinter10: "10_pre_winter_10ticks.md",
  winterStarted: "11_winter_started.md",
  winterEnded: "12_winter_ended.md",
  banditsAppeared: "20_bandits_appeared.md",
  banditsAttacking: "21_bandits_attacking.md",
  postBanditAttack: "22_post_bandit_attack.md",
  clansmenRevived: "99_clansmen_revived_and_resources_injected.md",
} as const;
const BANDIT_STATE_ATTACKING = 3;

export async function selectTemplates(
  promptDir: string,
  aux: RunnerAuxiliary,
  opts: { forcePostMemoryWipe?: boolean } = {},
): Promise<SelectedTemplate[]> {
  const tick = aux.tickClock.tick;
  const files = new Set<string>();
  if (tick === 0) files.add(TEMPLATE_FILES.gameStart);
  if (opts.forcePostMemoryWipe || isMemoryWipeTick(tick, aux.gameSettings)) {
    files.add(TEMPLATE_FILES.postMemoryWipe);
  }
  if (ticksUntilNextMemoryWipe(tick, aux.gameSettings) === 5) {
    files.add(TEMPLATE_FILES.preMemoryWipe5);
  }
  if (ticksUntilNextMemoryWipe(tick, aux.gameSettings) === 1) {
    files.add(TEMPLATE_FILES.preMemoryWipe1);
  }
  if (aux.gameSettings.winterStartTick - tick === 10) files.add(TEMPLATE_FILES.preWinter10);
  if (tick === aux.gameSettings.winterStartTick) files.add(TEMPLATE_FILES.winterStarted);
  if (tick === aux.gameSettings.winterStartTick + aux.gameSettings.winterDurationTicks) {
    files.add(TEMPLATE_FILES.winterEnded);
  }

  for (const file of eventDrivenFiles(aux)) files.add(file);

  const ordered = [...files].sort();
  const loaded = await Promise.all(
    ordered.map(async (fileName) => ({
      fileName,
      content: await readOptionalTemplate(promptDir, fileName),
    })),
  );
  return loaded.filter((template) => template.content.trim().length > 0);
}

async function readOptionalTemplate(promptDir: string, fileName: string): Promise<string> {
  try {
    return await fs.readFile(path.join(promptDir, fileName), "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      console.warn(`[templates] missing prompt template ${fileName}`);
      return "";
    }
    throw err;
  }
}

function isMemoryWipeTick(tick: number, settings: GameSettings): boolean {
  return tick > 0 && tick % settings.memoryWipeTickInterval === 0;
}

function ticksUntilNextMemoryWipe(tick: number, settings: GameSettings): number {
  const interval = settings.memoryWipeTickInterval;
  if (interval <= 0) return Number.POSITIVE_INFINITY;
  const remainder = tick % interval;
  return remainder === 0 ? interval : interval - remainder;
}

function eventDrivenFiles(aux: RunnerAuxiliary): string[] {
  const files: string[] = [];
  if (hasEvent(aux.chainEvents, "BanditSpawned")) files.push(TEMPLATE_FILES.banditsAppeared);
  if (aux.banditView?.exists && aux.banditView.state === BANDIT_STATE_ATTACKING) {
    files.push(TEMPLATE_FILES.banditsAttacking);
  }
  if (hasEvent(aux.chainEvents, "BanditAttackResolved")) {
    files.push(TEMPLATE_FILES.postBanditAttack);
  }
  if (hasEvent(aux.chainEvents, "ClansmanRevived") || hasEvent(aux.chainEvents, "ResourcesInjected")) {
    files.push(TEMPLATE_FILES.clansmenRevived);
  }
  return files;
}

function hasEvent(events: ChainEvent[], eventName: string): boolean {
  return events.some((event) => event.eventName === eventName);
}
