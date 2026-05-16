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

/**
 * makeTmux builds a mock tmux with a mutable pane scrollback.
 * Tests set paneState.scrollback directly to control what capturePane returns.
 */
function makeTmux() {
  const loaded: Array<{ name: string; content: string }> = [];
  const pasted: string[] = [];
  const keys: string[] = [];
  const paneState = { scrollback: "" };
  return {
    tmux: {
      async loadBuffer(name: string, content: string) {
        loaded.push({ name, content });
        // Simulate the prompt appearing in pane scrollback after paste (1 occurrence)
        paneState.scrollback += content + "\n";
      },
      async pasteBuffer(name: string, target: string) { pasted.push(name); },
      async sendKeys(key: string) { keys.push(key); },
      async capturePane() { return paneState.scrollback; },
    } as any,
    loaded, pasted, keys, paneState,
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

  it("completes when Elder echoes nonce (occurrence count >= 2)", async () => {
    const { bus, completed } = makeBus();
    const freeze = new FreezeGate();
    const { tmux, paneState } = makeTmux();

    // The poll loop runs; after loadBuffer the prompt is in scrollback (1 occurrence).
    // We need to add a second occurrence to simulate Elder's response.
    // We hook into pasteBuffer timing by overriding capturePane to add Elder response on 2nd call.
    let pollCount = 0;
    const origCapture = tmux.capturePane.bind(tmux);
    tmux.capturePane = async () => {
      pollCount++;
      if (pollCount >= 2) {
        // Extract nonce from prompt and add Elder's response
        const match = paneState.scrollback.match(/##NONCE:([^#]+)##/);
        if (match) paneState.scrollback += `##NONCE:${match[1]}## DONE\n`;
      }
      return paneState.scrollback;
    };

    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, config);
    expect(completed[0]?.id).toBe("cmd:0");
    expect((completed[0]?.payload as any).matched).toBe(true);
  });

  it("does NOT complete on first poll (prompt occurrence only = 1)", async () => {
    // Prompt is in pane, but Elder hasn't responded yet — should NOT complete early.
    // We verify by using a short timeout: if it false-positives, it completes immediately.
    const { bus, completed, failed } = makeBus();
    const freeze = new FreezeGate();
    const { tmux } = makeTmux();
    // paneState already has the prompt after loadBuffer — 1 occurrence.
    // capturePane always returns the same scrollback (no Elder response added).
    const shortConfig = { ...config, nonceTimeoutMs: 150, noncePollIntervalMs: 50 };
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, shortConfig);
    // Must timeout, not complete
    expect(completed).toHaveLength(0);
    expect(failed[0]?.reason).toContain("nonce");
  });

  it("fails on nonce timeout when Elder never responds", async () => {
    const { bus, failed } = makeBus();
    const { tmux } = makeTmux();
    const freeze = new FreezeGate();
    const shortConfig = { ...config, nonceTimeoutMs: 100, noncePollIntervalMs: 50 };
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, shortConfig);
    expect(failed[0]?.id).toBe("cmd:0");
    expect(failed[0]?.reason).toContain("nonce");
  });

  it("fails with FAIL marker when Elder echoes FAIL (occurrence >= 2)", async () => {
    const { bus, failed } = makeBus();
    const freeze = new FreezeGate();
    const { tmux, paneState } = makeTmux();

    let pollCount = 0;
    tmux.capturePane = async () => {
      pollCount++;
      if (pollCount >= 2) {
        const match = paneState.scrollback.match(/##NONCE:([^#]+)##/);
        if (match) paneState.scrollback += `##NONCE:${match[1]}## FAIL cannot process request\n`;
      }
      return paneState.scrollback;
    };

    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, config);
    expect(failed[0]?.id).toBe("cmd:0");
    expect(failed[0]?.reason).toContain("FAIL");
  });

  it("loads buffer with NONCE instruction and pastes to session", async () => {
    const { bus } = makeBus();
    const freeze = new FreezeGate();
    const { tmux, loaded, pasted, keys, paneState } = makeTmux();

    // Add Elder response so it completes
    let pollCount = 0;
    tmux.capturePane = async () => {
      pollCount++;
      if (pollCount >= 2) {
        const match = paneState.scrollback.match(/##NONCE:([^#]+)##/);
        if (match) paneState.scrollback += `##NONCE:${match[1]}## DONE\n`;
      }
      return paneState.scrollback;
    };

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
