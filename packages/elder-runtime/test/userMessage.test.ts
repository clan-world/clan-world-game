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
  it("completes (skipped, no retry bump, no tmux dispatch) when frozen", async () => {
    // Super-swarm R+1 PR #543: switched from releaseLease (which deadlocked the
    // FIFO queue by repeatedly re-leasing the same frozen command at head) to
    // completeCommand({skipped, reason: "frozen"}) so the message exits the
    // queue cleanly without bumping retryCount.
    const { bus, acked, completed } = makeBus();
    const { tmux, loaded, pasted } = makeTmux();
    const freeze = new FreezeGate();
    freeze.freeze();
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, config);
    expect(acked).toEqual(["cmd:0"]);
    expect(completed).toHaveLength(1);
    expect((completed[0]?.payload as any).skipped).toBe(true);
    expect((completed[0]?.payload as any).reason).toBe("frozen");
    // Confirm no tmux dispatch happened (no buffer load / paste while frozen)
    expect(loaded).toHaveLength(0);
    expect(pasted).toHaveLength(0);
  });

  it("completes when Elder echoes nonce on a whole line (line-anchored protocol)", async () => {
    // Super-swarm R+1 PR #543: switched from substring count (>=2) to
    // line-anchored count (>=1). Elder must emit the DONE marker on a line by
    // itself; embedded-in-prose echoes (including the prompt-paste itself)
    // do not count.
    const { bus, completed } = makeBus();
    const freeze = new FreezeGate();
    const { tmux, paneState } = makeTmux();

    let pollCount = 0;
    tmux.capturePane = async () => {
      pollCount++;
      if (pollCount >= 2) {
        // Elder emits the marker on its OWN line (leading newline so the
        // regex's ^ anchor matches independently of the prompt-paste prose).
        const match = paneState.scrollback.match(/##NONCE:([^#]+)##/);
        if (match) paneState.scrollback += `\n##NONCE:${match[1]}## DONE\n`;
      }
      return paneState.scrollback;
    };

    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, config);
    expect(completed[0]?.id).toBe("cmd:0");
    expect((completed[0]?.payload as any).matched).toBe(true);
  });

  it("does NOT complete on prompt-only scrollback (embedded marker is not a whole line)", async () => {
    // The prompt paste embeds the marker inside a [control] sentence, not on
    // its own line. Line-anchored matching must return 0 matches in that case.
    // Verified by short-timeout: if the embedded marker matched, completion
    // would fire on the first poll instead of timing out.
    const { bus, completed, failed } = makeBus();
    const freeze = new FreezeGate();
    const { tmux } = makeTmux();
    const shortConfig = { ...config, nonceTimeoutMs: 150, noncePollIntervalMs: 50 };
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, shortConfig);
    expect(completed).toHaveLength(0);
    expect(failed[0]?.reason).toContain("nonce");
  });

  it("does NOT complete on Elder quoting the marker inline (must be whole line)", async () => {
    // Defends against prompt-injection / Elder-quotes-prompt-in-prose attack
    // (super-swarm R+1 PR #543 finding by codex + gemini).
    const { bus, completed, failed } = makeBus();
    const freeze = new FreezeGate();
    const { tmux, paneState } = makeTmux();
    let pollCount = 0;
    tmux.capturePane = async () => {
      pollCount++;
      if (pollCount >= 2) {
        const match = paneState.scrollback.match(/##NONCE:([^#]+)##/);
        if (match) {
          // Elder quotes the marker INLINE (with leading prose). Must NOT count.
          paneState.scrollback += `I will now do: ##NONCE:${match[1]}## DONE is what I will emit later.\n`;
        }
      }
      return paneState.scrollback;
    };
    const shortConfig = { ...config, nonceTimeoutMs: 250, noncePollIntervalMs: 50 };
    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, shortConfig);
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

  it("fails with FAIL marker when Elder emits FAIL on its own line", async () => {
    // Super-swarm R+1 PR #543: line-anchored count requires the FAIL marker
    // on a whole line. Elder must NOT prefix prose (the prefix breaks the
    // anchor and the marker is correctly NOT counted — preventing
    // prompt-injection false-positives).
    const { bus, failed } = makeBus();
    const freeze = new FreezeGate();
    const { tmux, paneState } = makeTmux();

    let elderEmitted = false;
    let pollCount = 0;
    tmux.capturePane = async () => {
      pollCount++;
      if (!elderEmitted && pollCount >= 2) {
        const match = paneState.scrollback.match(/##NONCE:([^#]+)##/);
        if (match) {
          // Whole-line emission (with reason text after the FAIL keyword).
          paneState.scrollback += `\n##NONCE:${match[1]}## FAIL out of vault funds\n`;
          elderEmitted = true;
        }
      }
      return paneState.scrollback;
    };

    await handleUserMessage("cmd:0", { text: "hello" }, tmux, bus, freeze, config);
    expect(failed[0]?.id).toBe("cmd:0");
    expect(failed[0]?.reason).toContain("FAIL");
    expect(failed[0]?.reason).toContain("vault funds");
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
        if (match) paneState.scrollback += `\n##NONCE:${match[1]}## DONE\n`;
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
