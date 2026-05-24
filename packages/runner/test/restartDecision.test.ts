import { describe, expect, it } from "vitest";
import { decideRestart } from "../src/restartDecision.js";

const base = {
  currentTick: 10,
  lastReceivedTick: 9,
  sentForCurrentTick: false,
  memoryWipeTickInterval: 50,
  wipeMarkerTick: null,
};

describe("decideRestart", () => {
  it("case A waits when current tick was already received", () => {
    expect(decideRestart({ ...base, currentTick: 9 })).toEqual({ kind: "wait", caseName: "A" });
  });

  it("case B sends fresh current tick", () => {
    expect(decideRestart(base)).toEqual({ kind: "send-current", caseName: "B", resend: false });
  });

  it("case C resends when send log exists but receive log does not", () => {
    expect(decideRestart({ ...base, sentForCurrentTick: true })).toEqual({
      kind: "send-current",
      caseName: "C",
      resend: true,
    });
  });

  it("case D resets when a memory wipe tick is in the gap", () => {
    expect(decideRestart({
      ...base,
      currentTick: 55,
      lastReceivedTick: 48,
    })).toEqual({ kind: "reset", caseName: "D", reason: "memory_wipe_gap" });
  });

  it("case D resets when a wipe marker is ahead of the last received tick", () => {
    expect(decideRestart({
      ...base,
      currentTick: 51,
      lastReceivedTick: 50,
      wipeMarkerTick: 51,
    })).toEqual({ kind: "reset", caseName: "D", reason: "memory_wipe_gap" });
  });

  it("does not reset when the wipe marker equals the last received tick", () => {
    expect(decideRestart({
      ...base,
      currentTick: 50,
      lastReceivedTick: 50,
      wipeMarkerTick: 50,
    })).toEqual({ kind: "wait", caseName: "A" });
  });

  it("case D late-joins when no receive log exists", () => {
    expect(decideRestart({ ...base, lastReceivedTick: null })).toEqual({
      kind: "reset",
      caseName: "D",
      reason: "late_join",
    });
  });

  it("case E fast-forwards a non-wipe gap", () => {
    expect(decideRestart({ ...base, currentTick: 20, lastReceivedTick: 10 })).toEqual({
      kind: "fast-forward",
      caseName: "E",
      fromTick: 10,
      toTick: 20,
    });
  });
});
