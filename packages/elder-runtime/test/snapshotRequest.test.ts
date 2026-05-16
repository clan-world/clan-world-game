import { describe, it, expect } from "vitest";
import { handleSnapshotRequest } from "../src/commandHandlers/snapshotRequest.js";
import type { ElderRuntimeConfig } from "../src/types.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const config: ElderRuntimeConfig = {
  elderId: "elder-1", convexUrl: "http://localhost", busSecret: "s",
  stateDir: "/tmp", ancientWisdomPath: "", pollIntervalMs: 100,
  heartbeatIntervalMs: 1000, noncePollIntervalMs: 50, nonceTimeoutMs: 500,
};

describe("handleSnapshotRequest", () => {
  it("returns file contents", async () => {
    const tmp = path.join(os.tmpdir(), `wisdom-${Date.now()}.md`);
    fs.writeFileSync(tmp, "# test wisdom");
    const completed: any[] = [];
    const bus = {
      async ackCommand() {},
      async completeCommand(_id: string, payload: unknown) { completed.push(payload); },
    } as any;
    await handleSnapshotRequest("cmd:0", {}, bus, { ...config, ancientWisdomPath: tmp });
    expect((completed[0] as any).snapshot).toContain("test wisdom");
    fs.unlinkSync(tmp);
  });

  it("returns placeholder on missing file", async () => {
    const completed: any[] = [];
    const bus = {
      async ackCommand() {},
      async completeCommand(_id: string, payload: unknown) { completed.push(payload); },
    } as any;
    await handleSnapshotRequest("cmd:0", {}, bus, { ...config, ancientWisdomPath: "/nonexistent.md" });
    expect((completed[0] as any).snapshot).toContain("not found");
  });
});
