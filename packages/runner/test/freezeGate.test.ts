import { describe, it, expect } from "vitest";
import { FreezeGate } from "../src/freezeGate.js";

describe("FreezeGate", () => {
  it("starts unfrozen", () => {
    expect(new FreezeGate().isFrozen()).toBe(false);
  });
  it("freeze + unfreeze", () => {
    const g = new FreezeGate();
    g.freeze();
    expect(g.isFrozen()).toBe(true);
    g.unfreeze();
    expect(g.isFrozen()).toBe(false);
  });
});
