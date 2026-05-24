import { describe, expect, it, vi } from "vitest";
import { withBackoff } from "../src/retry.js";

describe("withBackoff", () => {
  it("backs off and calls recovery hook after a failed call succeeds", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    let recovered = 0;
    const promise = withBackoff(async () => {
      attempts++;
      if (attempts === 1) throw new Error("down");
      return "ok";
    }, {
      label: "test",
      initialDelayMs: 10,
      onRecovered: async () => { recovered++; },
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toBe("ok");
    expect(recovered).toBe(1);
    vi.useRealTimers();
  });
});
