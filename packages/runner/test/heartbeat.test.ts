import { describe, it, expect } from "vitest";
import { deriveHealth, type HeartbeatState } from "../src/heartbeat.js";

function makeState(overrides: Partial<HeartbeatState> = {}): HeartbeatState {
  return { lastTickProcessed: 0, lastSuccessAt: Date.now(), consecutiveErrors: 0, ...overrides };
}

describe("deriveHealth", () => {
  it("green when recent + no errors", () => {
    expect(deriveHealth(makeState(), Date.now())).toBe("green");
  });
  it("yellow when stale >90s", () => {
    const s = makeState({ lastSuccessAt: Date.now() - 100_000 });
    expect(deriveHealth(s, Date.now())).toBe("yellow");
  });
  it("red when stale >180s", () => {
    const s = makeState({ lastSuccessAt: Date.now() - 200_000 });
    expect(deriveHealth(s, Date.now())).toBe("red");
  });
  it("yellow when 1 consecutive error", () => {
    expect(deriveHealth(makeState({ consecutiveErrors: 1 }), Date.now())).toBe("yellow");
  });
  it("red when 3+ consecutive errors", () => {
    expect(deriveHealth(makeState({ consecutiveErrors: 3 }), Date.now())).toBe("red");
  });
});
