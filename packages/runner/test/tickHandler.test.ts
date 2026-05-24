import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleAuxiliaryUpdate, handleStartupDecision } from "../src/tickHandler.js";
import type { RunnerAuxiliary, RunnerConfig } from "../src/types.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tick-handler-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("tick handler confirmation", () => {
  it("returns unconfirmed for a scheduled wipe whose first tick is not received", async () => {
    const aux = makeAux(50);
    const deps = makeDeps(aux);

    const result = await handleAuxiliaryUpdate(deps as any, aux);

    expect(result.confirmed).toBe(false);
    expect(deps.calls).toContain("event:hook_failure");
  });

  it("returns unconfirmed for startup delivery that is not received", async () => {
    const aux = makeAux(10);
    const deps = makeDeps(aux);

    const result = await handleStartupDecision(deps as any, {
      kind: "send-current",
      caseName: "B",
      resend: false,
    });

    expect(result.confirmed).toBe(false);
    expect(deps.calls).toContain("event:hook_failure");
  });
});

function makeDeps(aux: RunnerAuxiliary) {
  const promptDir = path.join(process.cwd(), "test/fixtures/prompts");
  const elderConfigPath = path.join(dir, "elder-config.json");
  fs.writeFileSync(elderConfigPath, JSON.stringify({
    "elder-1": { displayName: "Storm Riders", color: "blue", glyph: "*" },
  }));
  const calls: string[] = [];
  const config = makeConfig(promptDir, elderConfigPath);
  return {
    calls,
    config,
    cachedSettings: aux.gameSettings,
    convex: {
      async getAuxiliary() { return aux; },
      async recordResetEvent() { calls.push("reset-start"); return "resetEventLog:1"; },
      async recordTickSend() {
        calls.push("send");
        return { sendLogId: "tickSendLog:1" };
      },
      async hasTickReceive() { return false; },
      async consumePendingMessages() {},
      async completeResetEvent() { calls.push("reset-complete"); },
      async isThematicUidTaken() { return false; },
      async recordRunnerEvent(kind: string) { calls.push(`event:${kind}`); },
    },
    tmux: {
      async killSession() { calls.push("kill"); },
      async newSession() { calls.push("new"); },
      async launchClaude(opts: { continue: boolean }) { calls.push(`claude:${opts.continue}`); },
      async sendSlashCommand(cmd: string) { calls.push(cmd); },
      async pasteMessage(text: string) { calls.push(`paste:${text.split("\n")[0]}`); },
      async capturePane() { return "\u2502 > "; },
    },
  };
}

function makeConfig(promptDir: string, elderConfigPath: string): RunnerConfig {
  return {
    elderId: "elder-1",
    convexUrl: "http://localhost",
    busSecret: "s",
    runnerSecret: "s",
    stateDir: dir,
    ancientWisdomPath: "/tmp/x",
    pollIntervalMs: 1,
    heartbeatIntervalMs: 1,
    noncePollIntervalMs: 1,
    nonceTimeoutMs: 1,
    runScriptPath: "/tmp/run.sh",
    lockPath: path.join(dir, "lock"),
    wipeMarkerPath: path.join(dir, "last-wipe-tick"),
    readyPath: path.join(dir, "ready"),
    promptDir,
    elderConfigPath,
    workspaceDir: "/workspace",
    appendSystemPromptFile: "/opt/prompt.md",
    hookReceiveTimeoutMs: 1,
    hookReceivePollMs: 1,
    maxPasteAttempts: 1,
  };
}

function makeAux(tick: number): RunnerAuxiliary {
  return {
    tickClock: { tick, tickEpochStartedAt: 0, tickEpochDurationMs: 60_000, seasonStartTick: 0, seasonEndTick: 360, winterActive: false },
    gameSettings: { heartbeatIntervalSeconds: 60, memoryWipeTickInterval: 50, winterStartTick: 110, winterDurationTicks: 10, winterPeriodTicks: 110, seasonDurationTicks: 360, contractAddress: "0x0" },
    banditView: null,
    chainEvents: [],
    pendingMessages: [],
  };
}
