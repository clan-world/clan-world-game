import fs from "node:fs";
import type { BusClient } from "../convexClient.js";
import type { ElderRuntimeConfig } from "../types.js";

function sliceUtf8Bytes(value: string, maxBytes: number): string {
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return value.slice(0, low);
}

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
  const TRUNCATED_SUFFIX = "\n[TRUNCATED: snapshot exceeded 50 KB cap]";
  if (Buffer.byteLength(snapshot, "utf8") > MAX_BYTES) {
    const suffixBytes = Buffer.byteLength(TRUNCATED_SUFFIX, "utf8");
    snapshot = sliceUtf8Bytes(snapshot, MAX_BYTES - suffixBytes) + TRUNCATED_SUFFIX;
  }
  await bus.completeCommand(commandId, { snapshot }, Date.now() - startMs);
}
