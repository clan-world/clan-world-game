import { describe, expect, it } from "vitest";
import { generateThematicUid, generateUniqueThematicUid, themeCount } from "../src/thematicUid.js";

describe("thematic UID", () => {
  it("uses six theme pools and appends a four-hex suffix", () => {
    expect(themeCount()).toBe(6);
    expect(generateThematicUid()).toMatch(/^[a-z]+-[a-z]+-[a-z]+-[0-9a-f]{4}$/);
  });

  it("retries collisions and panics after five taken IDs", async () => {
    let calls = 0;
    await expect(generateUniqueThematicUid(async () => {
      calls++;
      return true;
    })).rejects.toThrow(/collision/);
    expect(calls).toBe(5);
  });
});
