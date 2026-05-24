import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runResetFlow } from "../src/resetFlow.js";
import type { RunnerAuxiliary, RunnerConfig } from "../src/types.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "reset-flow-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runResetFlow", () => {
  it("kills tmux, launches fresh claude, brands, sends reset metadata, and clears marker", async () => {
    const promptDir = path.join(process.cwd(), "test/fixtures/prompts");
    const elderConfigPath = path.join(dir, "elder-config.json");
    fs.writeFileSync(elderConfigPath, JSON.stringify({
      "elder-1": { displayName: "Storm Riders", color: "blue", glyph: "*" },
    }));
    const config = makeConfig(promptDir, elderConfigPath);
    const calls: string[] = [];
    const tmux = {
      async killSession() { calls.push("kill"); },
      async newSession() { calls.push("new"); },
      async launchClaude(opts: { continue: boolean }) { calls.push(`claude:${opts.continue}`); },
      async sendSlashCommand(cmd: string) { calls.push(cmd); },
      async pasteMessage(text: string) { calls.push(`paste:${text.split("\n")[0]}`); },
      async capturePane() { return "\u2502 > "; },
    } as any;
    const convex = {
      async recordResetEvent() { calls.push("reset-start"); return "resetEventLog:1"; },
      async recordTickSend(_tick: number, _hash: string, metadata: any) {
        calls.push(`send:${metadata.resetReason}`);
        return { sendLogId: "tickSendLog:1" };
      },
      async hasTickReceive() { return true; },
      async consumePendingMessages() {},
      async completeResetEvent() { calls.push("reset-complete"); },
      async isThematicUidTaken() { return false; },
      async recordRunnerEvent() {},
    } as any;

    await runResetFlow({
      config,
      convex,
      tmux,
      aux: makeAux(50),
      reason: "scheduled",
    });

    expect(calls).toContain("kill");
    expect(calls).toContain("new");
    expect(calls).toContain("claude:false");
    expect(calls).toContain("/rename Ælder Storm Riders");
    expect(calls).toContain("/color blue");
    expect(calls).toContain("send:scheduled");
    expect(calls).toContain("reset-complete");
    expect(fs.existsSync(config.wipeMarkerPath)).toBe(false);
  });
});

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
