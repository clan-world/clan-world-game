import type { BusClient } from "../convexClient.js";
import type { FreezeGate } from "../freezeGate.js";

export async function handleFreeze(
  commandId: string,
  _payload: unknown,
  bus: BusClient,
  freeze: FreezeGate,
): Promise<void> {
  const startMs = Date.now();
  await bus.ackCommand(commandId);
  freeze.freeze();
  await bus.completeCommand(commandId, { frozen: true }, Date.now() - startMs);
}
