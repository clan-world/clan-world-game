import type { BusClient } from "../convexClient.js";
import type { FreezeGate } from "../freezeGate.js";

export async function handleUnfreeze(
  commandId: string,
  _payload: unknown,
  bus: BusClient,
  freeze: FreezeGate,
): Promise<void> {
  const startMs = Date.now();
  await bus.ackCommand(commandId);
  freeze.unfreeze();
  await bus.completeCommand(commandId, { frozen: false }, Date.now() - startMs);
}
