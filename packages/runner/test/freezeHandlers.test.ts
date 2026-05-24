import { describe, it, expect } from "vitest";
import { handleFreeze } from "../src/commandHandlers/freeze.js";
import { handleUnfreeze } from "../src/commandHandlers/unfreeze.js";
import { FreezeGate } from "../src/freezeGate.js";

function makeBus() {
  const completed: any[] = [];
  return {
    bus: {
      async ackCommand() {},
      async completeCommand(_id: string, p: unknown) { completed.push(p); },
    } as any,
    completed,
  };
}

describe("freeze/unfreeze handlers", () => {
  it("freeze sets gate", async () => {
    const g = new FreezeGate();
    const { bus, completed } = makeBus();
    await handleFreeze("cmd:0", {}, bus, g);
    expect(g.isFrozen()).toBe(true);
    expect((completed[0] as any).frozen).toBe(true);
  });
  it("unfreeze clears gate", async () => {
    const g = new FreezeGate();
    g.freeze();
    const { bus, completed } = makeBus();
    await handleUnfreeze("cmd:0", {}, bus, g);
    expect(g.isFrozen()).toBe(false);
    expect((completed[0] as any).frozen).toBe(false);
  });
});
