import type { TmuxSink } from "../tmuxSink.js";
import type { BusClient } from "../convexClient.js";
import type { FreezeGate } from "../freezeGate.js";

export async function handleReset(
  commandId: string,
  _payload: unknown,
  tmux: TmuxSink,
  bus: BusClient,
  freeze: FreezeGate,
): Promise<void> {
  const startMs = Date.now();
  await bus.ackCommand(commandId);
  freeze.unfreeze();
  await tmux.killSession();
  await tmux.newSession("/opt/clan-world/shared/run.sh");
  await bus.completeCommand(commandId, { reset: true }, Date.now() - startMs);
}
