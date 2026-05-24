import fs from "node:fs";
import type { ElderDisplayConfig, ElderN } from "./types.js";

export function loadElderDisplayConfig(filePath: string, elderId: ElderN): ElderDisplayConfig {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, ElderDisplayConfig | undefined>;
  const config = parsed[elderId];
  if (!config) throw new Error(`missing elder display config for ${elderId}`);
  return config;
}
