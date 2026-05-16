import fs from "node:fs";
import type { BusClient } from "../convexClient.js";
import type { ElderRuntimeConfig } from "../types.js";

export async function handleSnapshotRequest(
  commandId: string,
  _payload: unknown,
  bus: BusClient,
  config: ElderRuntimeConfig,
): Promise<void> {
  const startMs = Date.now();
  await bus.ackCommand(commandId);
  let snapshot = "";
  try {
    snapshot = fs.readFileSync(config.ancientWisdomPath, "utf8");
  } catch {
    snapshot = "[ANCIENT_WISDOM.md not found]";
  }
  const MAX_BYTES = 50_000;
  if (snapshot.length > MAX_BYTES) {
    snapshot = snapshot.slice(0, MAX_BYTES) + "\n[TRUNCATED: snapshot exceeded 50 KB cap]";
  }
  await bus.completeCommand(commandId, { snapshot }, Date.now() - startMs);
}
