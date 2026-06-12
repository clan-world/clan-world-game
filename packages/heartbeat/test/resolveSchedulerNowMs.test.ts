import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSchedulerNowMs } from "../src/heartbeatLoopMain";

describe("resolveSchedulerNowMs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined (wall-clock scheduling) when the flag is unset", async () => {
    const caller = { readChainNowMs: vi.fn() };
    await expect(resolveSchedulerNowMs(caller, {})).resolves.toBeUndefined();
    expect(caller.readChainNowMs).not.toHaveBeenCalled();
  });

  it("returns undefined when the flag is set to anything but '1'", async () => {
    const caller = { readChainNowMs: vi.fn() };
    await expect(
      resolveSchedulerNowMs(caller, { HEARTBEAT_SCHEDULE_FROM_CHAIN: "true" }),
    ).resolves.toBeUndefined();
    expect(caller.readChainNowMs).not.toHaveBeenCalled();
  });

  it("anchors the clock to the chain offset when enabled", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const wallNow = Date.now();
    const chainNow = wallNow + 1_490_000; // anvil ~25min ahead (the live 2026-06-12 shape)
    const caller = { readChainNowMs: vi.fn(async () => chainNow) };

    const nowMs = await resolveSchedulerNowMs(caller, { HEARTBEAT_SCHEDULE_FROM_CHAIN: "1" });

    expect(nowMs).toBeTypeOf("function");
    // The anchored clock should read ~chain time, not wall time. Allow slack
    // for the wall-clock ms elapsed between the two Date.now() samples.
    const drift = Math.abs(nowMs!() - chainNow);
    expect(drift).toBeLessThan(5_000);
  });

  it("falls back to wall-clock scheduling (undefined) when the anchor read fails", async () => {
    // Mutation guard: replacing the try/catch with a bare await makes this
    // test fail with an unhandled rejection instead of a clean undefined.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const caller = {
      readChainNowMs: vi.fn(async () => {
        throw new Error("boot RPC blip");
      }),
    };

    await expect(
      resolveSchedulerNowMs(caller, { HEARTBEAT_SCHEDULE_FROM_CHAIN: "1" }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
