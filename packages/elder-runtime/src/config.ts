import fs from "node:fs";
import type { ElderRuntimeConfig, ElderN } from "./types.js";

const VALID_ELDER_IDS: ElderN[] = ["elder-1", "elder-2", "elder-3", "elder-4"];

function parsePositiveInt(val: string | undefined, fallback: number, name: string): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer; got '${val}'`);
  }
  return n;
}

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
    pollIntervalMs: parsePositiveInt(process.env["ELDER_RUNTIME_POLL_MS"], 5000, "ELDER_RUNTIME_POLL_MS"),
    heartbeatIntervalMs: parsePositiveInt(process.env["ELDER_RUNTIME_HEARTBEAT_MS"], 30000, "ELDER_RUNTIME_HEARTBEAT_MS"),
    noncePollIntervalMs: parsePositiveInt(process.env["ELDER_RUNTIME_NONCE_POLL_MS"], 2000, "ELDER_RUNTIME_NONCE_POLL_MS"),
    // Default 240_000 (4 min) is strictly less than the command-bus LEASE_MS
    // of 6 min so the supervisor's nonce-wait expires + failCommand fires
    // BEFORE the Convex sweepStaleDelivered cron requeues the command. Without
    // this margin, the sweeper re-leases the same command while the supervisor
    // is still polling → duplicate tmux paste delivered to Claude (super-swarm
    // R+1 finding, PR #543). If you raise this env, also raise LEASE_MS in
    // commandBus.ts and the sweeper interval in convex/crons.ts.
    nonceTimeoutMs: parsePositiveInt(process.env["ELDER_RUNTIME_NONCE_TIMEOUT_MS"], 240000, "ELDER_RUNTIME_NONCE_TIMEOUT_MS"),
    runScriptPath: process.env["ELDER_RUN_SCRIPT_PATH"] ?? "/opt/clan-world/shared/run.sh",
  };
}
