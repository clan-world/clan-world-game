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

  // Check freeze BEFORE ack — release lease back to queued (no retry bump)
  if (freeze.isFrozen()) {
    await bus.releaseLease(commandId);
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

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = `##NONCE:${nonce}## DONE`;
  const failMarker = `##NONCE:${nonce}## FAIL`;
  const markerRe = new RegExp(escapeRe(marker), "g");
  const failRe = new RegExp(escapeRe(failMarker), "g");
  const deadline = Date.now() + config.nonceTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, config.noncePollIntervalMs));
    const pane = await tmux.capturePane(200);
    if ((pane.match(failRe) ?? []).length >= 2) {
      const failLine = pane.split("\n").reverse().find(l => l.includes(failMarker));
      const reason = failLine ? (failLine.split("FAIL")[1]?.trim() ?? "unknown") : "unknown";
      await bus.failCommand(commandId, `nonce ${nonce} FAIL: ${reason}`);
      return;
    }
    if ((pane.match(markerRe) ?? []).length >= 2) {
      await bus.completeCommand(commandId, { nonce, matched: true }, Date.now() - startMs);
      return;
    }
  }
  await bus.failCommand(commandId, `nonce ${nonce} not echoed within ${config.nonceTimeoutMs}ms`);
}
