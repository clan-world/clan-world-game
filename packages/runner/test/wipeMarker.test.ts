import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearWipeMarker, readWipeMarker, writeWipeMarker } from "../src/wipeMarker.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wipe-marker-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("wipe marker", () => {
  it("writes, reads, and clears the last wipe tick", () => {
    const marker = path.join(dir, "last-wipe-tick");
    expect(readWipeMarker(marker)).toBe(null);
    writeWipeMarker(marker, 50);
    expect(readWipeMarker(marker)).toBe(50);
    clearWipeMarker(marker);
    expect(readWipeMarker(marker)).toBe(null);
  });
});
