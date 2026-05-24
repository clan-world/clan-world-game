import fs from "node:fs";
import path from "node:path";
import type { ElderRuntimeConfig, ElderN, RunnerConfig } from "./types.js";

export const VALID_ELDER_IDS: ElderN[] = ["elder-1", "elder-2", "elder-3", "elder-4"];

function parsePositiveInt(val: string | undefined, fallback: number, name: string): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer; got '${val}'`);
  }
  return n;
}

function parseElderId(): { elderId: ElderN; elderN: string } {
  const elderIdEnv = process.env["ELDER_ID"];
  const elderN = process.env["ELDER_N"];
  if (elderIdEnv) {
    if (!VALID_ELDER_IDS.includes(elderIdEnv as ElderN)) {
      throw new Error(`Invalid ELDER_ID: ${elderIdEnv}`);
    }
    const derivedN = elderIdEnv.replace("elder-", "");
    if (elderN && elderN !== derivedN) {
      throw new Error(`ELDER_ID (${elderIdEnv}) does not match ELDER_N (${elderN})`);
    }
    return { elderId: elderIdEnv as ElderN, elderN: derivedN };
  }
  if (!elderN) throw new Error("ELDER_ID or ELDER_N env var required");
  const elderId = `elder-${elderN}` as ElderN;
  if (!VALID_ELDER_IDS.includes(elderId)) throw new Error(`Invalid ELDER_N: ${elderN}`);
  return { elderId, elderN };
}

export function loadConfig(): RunnerConfig {
  const { elderId, elderN } = parseElderId();

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
  const stateDir = process.env["CLAN_WORLD_RUNNER_STATE_DIR"] ?? "/home/elder/.runner-state";
  const readyPath = path.join(stateDir, "elder-runtime.ready");

  return {
    elderId,
    convexUrl,
    busSecret,
    runnerSecret: busSecret,
    stateDir,
    ancientWisdomPath: process.env["ANCIENT_WISDOM_PATH"] ?? "/workspace/ANCIENT_WISDOM.md",
    pollIntervalMs: parsePositiveInt(process.env["ELDER_RUNTIME_POLL_MS"], 5000, "ELDER_RUNTIME_POLL_MS"),
    heartbeatIntervalMs: parsePositiveInt(process.env["ELDER_RUNTIME_HEARTBEAT_MS"], 30000, "ELDER_RUNTIME_HEARTBEAT_MS"),
    noncePollIntervalMs: parsePositiveInt(process.env["ELDER_RUNTIME_NONCE_POLL_MS"], 2000, "ELDER_RUNTIME_NONCE_POLL_MS"),
    // TODO(PR2): remove this command-bus-era timing once pendingMessages drives
    // delivery. PR1 preserves the knob so the renamed runtime boots unchanged.
    nonceTimeoutMs: parsePositiveInt(process.env["ELDER_RUNTIME_NONCE_TIMEOUT_MS"], 240000, "ELDER_RUNTIME_NONCE_TIMEOUT_MS"),
    runScriptPath: process.env["ELDER_RUN_SCRIPT_PATH"] ?? "/opt/clan-world/shared/run.sh",
    lockPath: path.join(stateDir, "elder-runner.lock"),
    wipeMarkerPath: path.join(stateDir, "last-wipe-tick"),
    readyPath,
    promptDir: process.env["RUNNER_PROMPTS_DIR"] ?? "/opt/clan-world/shared/runner/prompts",
    elderConfigPath: process.env["RUNNER_ELDER_CONFIG_PATH"] ?? "/opt/clan-world/shared/runner/elder-config.json",
    workspaceDir: process.env["RUNNER_WORKSPACE_DIR"] ?? "/workspace",
    appendSystemPromptFile: process.env["RUNNER_APPEND_SYSTEM_PROMPT_FILE"] ?? "/opt/clan-world/shared/APPENDED_SYSTEM_PROMPT.md",
    hookReceiveTimeoutMs: parsePositiveInt(process.env["RUNNER_HOOK_RECEIVE_TIMEOUT_MS"], 90_000, "RUNNER_HOOK_RECEIVE_TIMEOUT_MS"),
    hookReceivePollMs: parsePositiveInt(process.env["RUNNER_HOOK_RECEIVE_POLL_MS"], 3_000, "RUNNER_HOOK_RECEIVE_POLL_MS"),
    maxPasteAttempts: parsePositiveInt(process.env["RUNNER_MAX_PASTE_ATTEMPTS"], 3, "RUNNER_MAX_PASTE_ATTEMPTS"),
  };
}

export type { ElderRuntimeConfig };
