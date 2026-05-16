import { describe, it, expect } from "vitest";
import { handleUserMessage } from "../src/commandHandlers/userMessage.js";
import type { ElderRuntimeConfig } from "../src/types.js";
import { FreezeGate } from "../src/freezeGate.js";

const config: ElderRuntimeConfig = {
  elderId: "elder-1",
  convexUrl: "http://localhost:3210",
  busSecret: "test-secret",
  stateDir: "/tmp/test-runtime",
  ancientWisdomPath: "/tmp/ANCIENT_WISDOM.md",
  pollIntervalMs: 100,
  heartbeatIntervalMs: 1000,
  noncePollIntervalMs: 50,
  nonceTimeoutMs: 500,
  runScriptPath: "/opt/clan-world/shared/run.sh",
};

function makeBus() {
  const acked: string[] = [];
  const completed: Array<{ id: string; payload: unknown; tookMs: number }> = [];
  const failed: Array<{ id: string; reason: string }> = [];
  return {
    bus: {
      async ackCommand(id: string) { acked.push(id); },
      async completeCommand(id: string, payload: unknown, tookMs: number) {
        completed.push({ id, payload, tookMs });
      },
      async failCommand(id: string, reason: string) { failed.push({ id, reason }); },
    } as any,
    acked, completed, failed,
  };
}

function makeTmux(echoLoaded = false) {
  const loaded: Array<{ name: string; content: string }> = [];
  const pasted: string[] = [];
  const keys: string[] = [];
  return {
    tmux: {
      async loadBuffer(name: string, content: string) { loaded.push({ name, content }); },
      async pasteBuffer(name: string, target: string) { pasted.push(name); },
      async sendKeys(key: string) { keys.push(key); },
      async capturePane() {
        if (echoLoaded && loaded.length > 0) {
          const match = loaded[loaded.length - 1]!.content.match(/##NONCE:([^#]+)##/);
          if (match) return `##NONCE:${match[1]}## DONE`;
        }
        return "";
      },
    } as any,
    loaded, pasted, keys,
  };
}

describe("handleUserMessage", () => {
  it("releases lease when frozen (no retry bump)", async () => {
    const released: string[] = [];
    const bus = {
      ...makeBus().bus,
      async releaseLease(id: string) { released.push(id); },
    } as any;
    const { tmux } = makeTmux();
    const freeze = new FreezeGate();
    freeze.freeze();
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, config);
    expect(released[0]).toBe("cmd:0");
  });

  it("completes on nonce echo", async () => {
    const { bus, completed } = makeBus();
    const freeze = new FreezeGate();
    const { tmux } = makeTmux(true); // echoLoaded=true: capturePane echoes nonce from loaded buffer
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, config);
    expect(completed[0]?.id).toBe("cmd:0");
    expect((completed[0]?.payload as any).matched).toBe(true);
  });

  it("fails on nonce timeout", async () => {
    const { bus, failed } = makeBus();
    const { tmux } = makeTmux(); // echoLoaded=false: capturePane always returns ""
    const freeze = new FreezeGate();
    const shortConfig = { ...config, nonceTimeoutMs: 100, noncePollIntervalMs: 50 };
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, shortConfig);
    expect(failed[0]?.id).toBe("cmd:0");
    expect(failed[0]?.reason).toContain("nonce");
  });

  it("loads buffer with NONCE instruction and pastes to session", async () => {
    const { bus } = makeBus();
    const freeze = new FreezeGate();
    const { tmux, loaded, pasted, keys } = makeTmux(true);
    await handleUserMessage("cmd:0", { text: "do the thing" }, tmux, bus, freeze, config);
    expect(loaded[0]?.name).toBe("elder-input");
    expect(loaded[0]?.content).toContain("[control]");
    expect(loaded[0]?.content).toContain("##NONCE:");
    expect(loaded[0]?.content).toContain("## DONE");
    expect(loaded[0]?.content).toContain("do the thing");
    expect(pasted[0]).toBe("elder-input");
    expect(keys).toContain("Enter");
  });
});
