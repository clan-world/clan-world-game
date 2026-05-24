import type { RestartDecision } from "./types.js";

export interface RestartDecisionInput {
  currentTick: number;
  lastReceivedTick: number | null;
  sentForCurrentTick: boolean;
  memoryWipeTickInterval: number;
  wipeMarkerTick: number | null;
}

export function decideRestart(input: RestartDecisionInput): RestartDecision {
  if (input.lastReceivedTick === null) {
    return { kind: "reset", caseName: "D", reason: "late_join" };
  }
  // If a wipe marker is present at or beyond what we've already received,
  // we crashed mid-reset and must replay it. Strict equality (was:
  // === currentTick) missed the case where a tick advances between the
  // crash and the restart for manual / late_join reasons that aren't
  // aligned to memoryWipeTickInterval. Modulo-aligned scheduled wipes
  // were still caught by containsMemoryWipeTick below, but non-aligned
  // ticks slipped through and led to `claude --continue` launching with
  // pre-wipe memory. The wider check rescues both.
  if (
    input.wipeMarkerTick !== null &&
    input.wipeMarkerTick >= input.lastReceivedTick
  ) {
    return { kind: "reset", caseName: "D", reason: "memory_wipe_gap" };
  }

  const gap = input.currentTick - input.lastReceivedTick;
  if (gap <= 0) {
    return { kind: "wait", caseName: "A" };
  }
  if (gap === 1) {
    return {
      kind: "send-current",
      caseName: input.sentForCurrentTick ? "C" : "B",
      resend: input.sentForCurrentTick,
    };
  }
  if (
    containsMemoryWipeTick(
      input.lastReceivedTick,
      input.currentTick,
      input.memoryWipeTickInterval,
    )
  ) {
    return { kind: "reset", caseName: "D", reason: "memory_wipe_gap" };
  }
  return {
    kind: "fast-forward",
    caseName: "E",
    fromTick: input.lastReceivedTick,
    toTick: input.currentTick,
  };
}

export function containsMemoryWipeTick(
  lastReceivedTick: number,
  currentTick: number,
  interval: number,
): boolean {
  if (!Number.isFinite(interval) || interval <= 0) return false;
  for (let tick = lastReceivedTick + 1; tick <= currentTick; tick++) {
    if (isScheduledMemoryWipeTick(tick, interval)) return true;
  }
  return false;
}

export function isScheduledMemoryWipeTick(tick: number, interval: number): boolean {
  return tick > 0 && interval > 0 && tick % interval === 0;
}
