import type { TmuxSink } from "../tmuxSink.js";
import type { BusClient } from "../convexClient.js";
import type { FreezeGate } from "../freezeGate.js";
import type { ElderRuntimeConfig } from "../types.js";

export async function handleReset(
  commandId: string,
  _payload: unknown,
  tmux: TmuxSink,
  bus: BusClient,
  freeze: FreezeGate,
  config: ElderRuntimeConfig,
): Promise<void> {
  const startMs = Date.now();
  await bus.ackCommand(commandId);
  freeze.unfreeze();
  await tmux.killSession();
  await tmux.newSession(config.runScriptPath);
  await bus.completeCommand(commandId, { reset: true }, Date.now() - startMs);
}
