import { randomUUID } from "node:crypto";
import type { TmuxSink } from "../tmuxSink.js";
import type { BusClient } from "../convexClient.js";
import type { FreezeGate } from "../freezeGate.js";
import type { ElderRuntimeConfig } from "../types.js";

export async function handleSystemMessage(
  commandId: string,
  payload: unknown,
  tmux: TmuxSink,
  bus: BusClient,
  freeze: FreezeGate,
  config: ElderRuntimeConfig,
): Promise<void> {
  const startMs = Date.now();

  // Check freeze BEFORE work — complete-skipped so the message leaves the FIFO
  // queue without bumping retryCount. releaseLease would put the command back at
  // the head of the queue and the next claimNext loop would re-lease the same
  // command, starving any unfreeze/reset queued behind it (super-swarm R+1
  // finding, PR #543). Operator must re-enqueue any skipped commands
  // post-unfreeze; the result row captures the skip for audit.
  if (freeze.isFrozen()) {
    await bus.ackCommand(commandId);
    await bus.completeCommand(commandId, { skipped: true, reason: "frozen" }, Date.now() - startMs);
    return;
  }
  await bus.ackCommand(commandId);

  const text = (payload as { text?: string })?.text ?? "";
  const nonce = randomUUID();
  const nonceInstruction = `\n\n[control] When you have fully completed processing this message, emit exactly the line \`##NONCE:${nonce}## DONE\` (no prefix, no suffix, no quotes) as the final line of your response. If you cannot complete the task, emit \`##NONCE:${nonce}## FAIL <reason>\` instead. The runtime uses the marker count to acknowledge command completion.`;
  const message = `${text}${nonceInstruction}`;

  await tmux.loadBuffer("elder-input", message);
  await tmux.pasteBuffer("elder-input", config.elderId, { bracketed: true });
  await tmux.sendKeys("Enter");

  // See userMessage.ts for the protocol rationale (super-swarm R+1, PR #543):
  // line-anchored matching makes the embedded-in-prose prompt occurrence
  // ineligible, so >= 1 match from Elder's whole-line response is the
  // unambiguous completion signal. capturePane(2000) for verbose responses.
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = `##NONCE:${nonce}## DONE`;
  const failMarker = `##NONCE:${nonce}## FAIL`;
  const lineMarkerRe = new RegExp(`^${escapeRe(marker)}\\s*$`, "gm");
  const lineFailRe = new RegExp(`^${escapeRe(failMarker)}(\\s+.*)?$`, "gm");
  const deadline = Date.now() + config.nonceTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, config.noncePollIntervalMs));
    const pane = await tmux.capturePane(2000);
    if ((pane.match(lineFailRe) ?? []).length >= 1) {
      const failLine = pane.split("\n").reverse().find(l => /^##NONCE:[^#]+## FAIL/.test(l));
      const reason = failLine ? (failLine.split("FAIL")[1]?.trim() ?? "unknown") : "unknown";
      await bus.failCommand(commandId, `nonce ${nonce} FAIL: ${reason}`);
      return;
    }
    if ((pane.match(lineMarkerRe) ?? []).length >= 1) {
      await bus.completeCommand(commandId, { nonce, matched: true }, Date.now() - startMs);
      return;
    }
  }
  await bus.failCommand(commandId, `nonce ${nonce} not echoed within ${config.nonceTimeoutMs}ms`);
}
