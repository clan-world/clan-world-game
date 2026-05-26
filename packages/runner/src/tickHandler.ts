import { deliverMessage, deliverPendingOnly } from "./messageDelivery.js";
import { runResetFlow } from "./resetFlow.js";
import { containsMemoryWipeTick, isScheduledMemoryWipeTick } from "./restartDecision.js";
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
): Promise<TickDeliveryResult> {
  if (decision.kind === "wait") return { confirmed: true };
  const aux = await deps.convex.getAuxiliary(deps.signal);
  await assertNoSettingsDrift(deps, aux);
  if (decision.kind === "reset") {
    return await runResetFlow({ ...deps, aux, reason: decision.reason });
  }
  return await deliverCurrentTick(deps, aux, decision.kind === "fast-forward"
    ? `Fast-forwarding from tick ${decision.fromTick} to tick ${decision.toTick}.`
    : undefined);
}

export interface TickDeliveryResult {
  confirmed: boolean;
  /**
   * True when this update fired a reset (runResetFlow). The live loop advances
   * its wipe cursor on this regardless of `confirmed` — the session is already
   * killed + relaunched, so re-firing the wipe on the next wake would livelock.
   */
  resetFired?: boolean;
}

export async function handleAuxiliaryUpdate(
  deps: TickHandlerDeps,
  aux: RunnerAuxiliary,
  lastWipeHandledTick: number,
): Promise<TickDeliveryResult> {
  await assertNoSettingsDrift(deps, aux);
  // Gap-aware wipe detection. The Convex subscription delivers the LATEST
  // snapshot, so while the runner is busy delivering one tick the clock can
  // jump (e.g. 2049 → 2052), stepping over a scheduled wipe tick. An
  // exact-tick check (tick % interval === 0) silently misses those wipes and
  // the session bloats until uncontrolled auto-compaction. Mirror startup's
  // decideRestart and fire when a wipe tick fell in the gap since the last
  // wipe we HANDLED. The caller advances that cursor whenever a reset fires
  // (confirmed or not): the session is killed + relaunched fresh, so re-firing
  // on the next wake would livelock; a failed continuity-prompt delivery is
  // recovered by the next normal tick, not by re-wiping. (Liam-reported
  // 2026-05-26; codex co-design + R1 HIGH.)
  const currentTick = aux.tickClock.tick;
  const interval = deps.cachedSettings.memoryWipeTickInterval;
  // Fire when a wipe tick falls in the half-open interval (lastWipeHandledTick,
  // currentTick]. Using ONLY this — not an `exactScheduled || crossed` OR —
  // closes the unconfirmed-reset livelock for BOTH the gap and the exact-
  // boundary case: once we've handled tick T (cursor advanced to T), the
  // interval excludes T, so an intra-tick re-yield of `aux` (getRunnerAuxiliary
  // is reactive over pendingMessages/banditView/chainEvents and can re-emit at
  // the same tick) won't re-trigger the wipe. An exact-tick OR would re-fire
  // forever at the boundary. isScheduledMemoryWipeTick is kept only to label
  // the reason. (codex R1 + claude R2 HIGH)
  const wipeDue = containsMemoryWipeTick(lastWipeHandledTick, currentTick, interval);
  if (wipeDue) {
    const reason = isScheduledMemoryWipeTick(currentTick, interval) ? "scheduled" : "memory_wipe_gap";
    const result = await runResetFlow({ ...deps, aux, reason });
    return { confirmed: result.confirmed, resetFired: true };
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
