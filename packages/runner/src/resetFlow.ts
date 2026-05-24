import { loadElderDisplayConfig } from "./elderConfig.js";
import { deliverMessage } from "./messageDelivery.js";
import { selectTemplates } from "./templateLoader.js";
import { clearWipeMarker, writeWipeMarker } from "./wipeMarker.js";
import type { RunnerConvexClient } from "./convexClient.js";
import type { TmuxSink } from "./tmuxSink.js";
import type { ResetReason, RunnerAuxiliary, RunnerConfig } from "./types.js";

export interface ResetFlowInput {
  config: RunnerConfig;
  convex: RunnerConvexClient;
  tmux: TmuxSink;
  aux: RunnerAuxiliary;
  reason: ResetReason;
  signal?: AbortSignal;
}

export async function runResetFlow(input: ResetFlowInput): Promise<void> {
  const resetTick = input.aux.tickClock.tick;
  writeWipeMarker(input.config.wipeMarkerPath, resetTick);
  const resetEventId = await input.convex.recordResetEvent(resetTick, input.reason, input.signal);

  await input.tmux.killSession();
  await input.tmux.newSession(input.config.workspaceDir);
  await input.tmux.launchClaude({
    continue: false,
    runScriptPath: input.config.runScriptPath,
  });
  await brandElder(input);

  const templates = await selectTemplates(input.config.promptDir, input.aux, {
    forcePostMemoryWipe: true,
  });
  const delivery = await deliverMessage(input.convex, input.tmux, {
    tickNumber: resetTick,
    receiveTickNumber: resetTick,
    templates,
    resetMetadata: {
      resetTick,
      resetReason: input.reason,
      resetEventId,
    },
    receiveTimeoutMs: input.config.hookReceiveTimeoutMs,
    receivePollMs: input.config.hookReceivePollMs,
    maxAttempts: input.config.maxPasteAttempts,
    signal: input.signal,
  });
  if (!delivery.confirmed) return;

  await input.convex.completeResetEvent(resetEventId, input.signal);
  clearWipeMarker(input.config.wipeMarkerPath);
}

export async function brandElder(input: Pick<ResetFlowInput, "config" | "tmux">): Promise<void> {
  const display = loadElderDisplayConfig(input.config.elderConfigPath, input.config.elderId);
  await input.tmux.sendSlashCommand(`/rename Ælder ${display.displayName}`);
  await input.tmux.sendSlashCommand(`/color ${display.color}`);
}
