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

function makeTmux(nonceToEcho?: string) {
  const sent: string[] = [];
  return {
    tmux: {
      async sendKeys(text: string) { sent.push(text); },
      async capturePane() {
        if (nonceToEcho) return `##NONCE:${nonceToEcho}## DONE`;
        return "";
      },
    } as any,
    sent,
  };
}

describe("handleUserMessage", () => {
  it("skips when frozen", async () => {
    const { bus, completed } = makeBus();
    const { tmux } = makeTmux();
    const freeze = new FreezeGate();
    freeze.freeze();
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, config);
    expect(completed[0]?.payload).toMatchObject({ skipped: true });
  });

  it("completes on nonce echo", async () => {
    const { bus, completed } = makeBus();
    const freeze = new FreezeGate();
    // Capture nonce from sendKeys and return it in capturePane
    const tmux = {
      async sendKeys(text: string) {
        const match = text.match(/##NONCE:([^#]+)##/);
        if (match) (tmux as any)._nonce = match[1];
      },
      async capturePane() {
        return (tmux as any)._nonce ? `##NONCE:${(tmux as any)._nonce}## DONE` : "";
      },
    } as any;
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, config);
    expect(completed[0]?.id).toBe("cmd:0");
    expect((completed[0]?.payload as any).matched).toBe(true);
  });

  it("fails on nonce timeout", async () => {
    const { bus, failed } = makeBus();
    const { tmux } = makeTmux(); // capturePane returns ""
    const freeze = new FreezeGate();
    const shortConfig = { ...config, nonceTimeoutMs: 100, noncePollIntervalMs: 50 };
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, shortConfig);
    expect(failed[0]?.id).toBe("cmd:0");
    expect(failed[0]?.reason).toContain("nonce");
  });
});
