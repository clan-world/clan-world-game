import { deliverMessage, deliverPendingOnly } from "./messageDelivery.js";
import { runResetFlow } from "./resetFlow.js";
import { isScheduledMemoryWipeTick } from "./restartDecision.js";
import { describeSettingsDrift, settingsEqual } from "./settingsCache.js";
import { selectTemplates } from "./templateLoader.js";
import type { RunnerConvexClient } from "./convexClient.js";
import type { TmuxSink } from "./tmuxSink.js";
import type { GameSettings, RestartDecision, RunnerAuxiliary, RunnerConfig } from "./types.js";

export interface TickHandlerDeps {
  config: RunnerConfig;
  convex: RunnerConvexClient;
  tmux: TmuxSink;
  cachedSettings: GameSettings;
  signal?: AbortSignal;
}

export async function handleStartupDecision(
  deps: TickHandlerDeps,
  decision: RestartDecision,
): Promise<void> {
  if (decision.kind === "wait") return;
  const aux = await deps.convex.getAuxiliary(deps.signal);
  await assertNoSettingsDrift(deps, aux);
  if (decision.kind === "reset") {
    await runResetFlow({ ...deps, aux, reason: decision.reason });
    return;
  }
  await deliverCurrentTick(deps, aux, decision.kind === "fast-forward"
    ? `Fast-forwarding from tick ${decision.fromTick} to tick ${decision.toTick}.`
    : undefined);
}

export interface TickDeliveryResult {
  confirmed: boolean;
}

export async function handleAuxiliaryUpdate(
  deps: TickHandlerDeps,
  aux: RunnerAuxiliary,
): Promise<TickDeliveryResult> {
  await assertNoSettingsDrift(deps, aux);
  if (
    isScheduledMemoryWipeTick(
      aux.tickClock.tick,
      deps.cachedSettings.memoryWipeTickInterval,
    )
  ) {
    // runResetFlow internally clears the wipe marker + resetEventLog
    // completedAt only when delivery.confirmed (resetFlow.ts:48). If the
    // first-tick wasn't received, the marker persists and the next
    // startup's restartDecision catches it via the wipeMarker rescue.
    // Returning confirmed:true here is "advance optimistically" — even
    // if first-tick wasn't received, the loop will see the marker on next
    // wakeup and retry the whole reset. Acceptable: scheduled-wipe ticks
    // are rare enough that re-resetting is cheap and the marker keeps
    // state consistent.
    await runResetFlow({ ...deps, aux, reason: "scheduled" });
    return { confirmed: true };
  }
  const delivery = await deliverCurrentTick(deps, aux);
  return { confirmed: delivery.confirmed };
}

export async function handlePendingMessages(deps: TickHandlerDeps, aux: RunnerAuxiliary): Promise<void> {
  await assertNoSettingsDrift(deps, aux);
  await deliverPendingOnly(deps.convex, deps.tmux, {
    pendingMessages: aux.pendingMessages,
    receiveTimeoutMs: deps.config.hookReceiveTimeoutMs,
    receivePollMs: deps.config.hookReceivePollMs,
    maxAttempts: deps.config.maxPasteAttempts,
    signal: deps.signal,
  });
}

async function deliverCurrentTick(
  deps: TickHandlerDeps,
  aux: RunnerAuxiliary,
  fastForwardPrefix?: string,
): Promise<{ confirmed: boolean }> {
  const templates = await selectTemplates(deps.config.promptDir, aux);
  const result = await deliverMessage(deps.convex, deps.tmux, {
    tickNumber: aux.tickClock.tick,
    receiveTickNumber: aux.tickClock.tick,
    templates,
    fastForwardPrefix,
    pendingMessages: aux.pendingMessages,
    receiveTimeoutMs: deps.config.hookReceiveTimeoutMs,
    receivePollMs: deps.config.hookReceivePollMs,
    maxAttempts: deps.config.maxPasteAttempts,
    signal: deps.signal,
  });
  return { confirmed: result.confirmed };
}

async function assertNoSettingsDrift(deps: TickHandlerDeps, aux: RunnerAuxiliary): Promise<void> {
  if (settingsEqual(deps.cachedSettings, aux.gameSettings)) return;
  const message = describeSettingsDrift(deps.cachedSettings, aux.gameSettings);
  await deps.convex.recordRunnerEvent("settings_drift_panic", message, deps.signal);
  throw new Error(`game settings drift panic: ${message}`);
}
