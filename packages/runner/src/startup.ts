import fs from "node:fs";
import { acquireFlock, type FlockHandle } from "./flockGuard.js";
import { countClaudeProcesses } from "./oneClaudeCheck.js";
import { decideRestart } from "./restartDecision.js";
import { readWipeMarker } from "./wipeMarker.js";
import type { RunnerConvexClient } from "./convexClient.js";
import type { TmuxSink } from "./tmuxSink.js";
import type { RestartDecision, RunnerConfig, RunnerStartupState } from "./types.js";

export interface StartupResult {
  flock: FlockHandle;
  startupState: RunnerStartupState;
  decision: RestartDecision;
}

export async function startup(
  config: RunnerConfig,
  convex: RunnerConvexClient,
  tmux: TmuxSink,
  signal?: AbortSignal,
): Promise<StartupResult> {
  fs.mkdirSync(config.stateDir, { recursive: true });
  const flock = acquireFlock(config.lockPath);
  const startupState = await convex.getStartupState(signal);
  const claudeCount = await countClaudeProcesses();
  if (claudeCount > 1) {
    await convex.recordRunnerEvent("invariant_violation", `one-claude invariant violated: found ${claudeCount}`, signal);
    throw new Error(`one-claude invariant violated: found ${claudeCount} claude processes`);
  }

  const hasSession = await tmux.hasSession();
  if (!hasSession) {
    await tmux.newSession(config.workspaceDir);
  }

  const decision = decideRestart({
    currentTick: startupState.tickClock.tick,
    lastReceivedTick: startupState.lastReceivedTick,
    sentForCurrentTick: startupState.sentForCurrentTick,
    memoryWipeTickInterval: startupState.gameSettings.memoryWipeTickInterval,
    wipeMarkerTick: readWipeMarker(config.wipeMarkerPath),
  });
  if (decision.kind !== "reset" && claudeCount === 0) {
    await tmux.launchClaude({
      continue: true,
      runScriptPath: config.runScriptPath,
    });
  }

  fs.writeFileSync(config.readyPath, String(process.pid));
  return { flock, startupState, decision };
}
