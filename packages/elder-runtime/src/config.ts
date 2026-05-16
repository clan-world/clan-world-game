import fs from "node:fs";
import type { ElderRuntimeConfig, ElderN } from "./types.js";

const VALID_ELDER_IDS: ElderN[] = ["elder-1", "elder-2", "elder-3", "elder-4"];

export function loadConfig(): ElderRuntimeConfig {
  const elderN = process.env["ELDER_N"];
  if (!elderN) throw new Error("ELDER_N env var required (1..4)");
  const elderId = `elder-${elderN}` as ElderN;
  if (!VALID_ELDER_IDS.includes(elderId)) throw new Error(`Invalid ELDER_N: ${elderN}`);

  const convexUrl = process.env["CONVEX_DEPLOY_URL"];
  if (!convexUrl) throw new Error("CONVEX_DEPLOY_URL env var required");

  // Secret from file mount (docker secret)
  const secretFile = process.env["BUS_ELDER_SECRET_FILE"] ?? `/run/secrets/bus-elder-${elderN}`;
  let busSecret: string;
  try {
    busSecret = fs.readFileSync(secretFile, "utf8").trim();
  } catch {
    throw new Error(`Cannot read bus secret from ${secretFile}`);
  }

  return {
    elderId,
    convexUrl,
    busSecret,
    stateDir: process.env["CLAN_WORLD_RUNNER_STATE_DIR"] ?? "/workspace/.runtime",
    ancientWisdomPath: process.env["ANCIENT_WISDOM_PATH"] ?? "/workspace/ANCIENT_WISDOM.md",
    pollIntervalMs: parseInt(process.env["ELDER_RUNTIME_POLL_MS"] ?? "5000", 10),
    heartbeatIntervalMs: parseInt(process.env["ELDER_RUNTIME_HEARTBEAT_MS"] ?? "30000", 10),
    noncePollIntervalMs: parseInt(process.env["ELDER_RUNTIME_NONCE_POLL_MS"] ?? "2000", 10),
    nonceTimeoutMs: parseInt(process.env["ELDER_RUNTIME_NONCE_TIMEOUT_MS"] ?? "300000", 10),
  };
}
