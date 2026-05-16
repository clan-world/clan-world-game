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
  await bus.ackCommand(commandId);

  if (freeze.isFrozen()) {
    await bus.failCommand(commandId, "frozen");
    return;
  }

  const text = (payload as { text?: string })?.text ?? "";
  const nonce = randomUUID();
  const message = `${text}\n##NONCE:${nonce}##`;

  await tmux.sendKeys(message);

  const deadline = Date.now() + config.nonceTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, config.noncePollIntervalMs));
    const pane = await tmux.capturePane(200);
    if (pane.includes(`##NONCE:${nonce}## DONE`)) {
      await bus.completeCommand(commandId, { nonce, matched: true }, Date.now() - startMs);
      return;
    }
  }
  await bus.failCommand(commandId, `nonce ${nonce} not echoed within ${config.nonceTimeoutMs}ms`);
}
