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

export interface ResetFlowResult {
  confirmed: boolean;
}

export async function runResetFlow(input: ResetFlowInput): Promise<ResetFlowResult> {
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
  if (!delivery.confirmed) return { confirmed: false };

  await input.convex.completeResetEvent(resetEventId, input.signal);
  clearWipeMarker(input.config.wipeMarkerPath);
  return { confirmed: true };
}

export async function brandElder(input: Pick<ResetFlowInput, "config" | "tmux">): Promise<void> {
  const display = loadElderDisplayConfig(input.config.elderConfigPath, input.config.elderId);
  await input.tmux.sendSlashCommand(`/rename Ælder ${display.displayName}`);
  await input.tmux.sendSlashCommand(`/color ${display.color}`);
  // ASCII "Elder" for the tmux bar: the tmux server runs in a POSIX (non-UTF-8)
  // locale and mangles the multibyte "Æ" to "_" in the window name. Claude's own
  // TUI line keeps "Ælder" (it renders UTF-8 itself). A UTF-8 server locale
  // (LANG=C.UTF-8) would let the bar show "Æ" too — deferred (needs restart).
  await input.tmux.setStatusBar(`Elder ${display.displayName}`, display.color);
}
