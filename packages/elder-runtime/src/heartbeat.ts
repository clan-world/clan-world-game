import type { BusClient } from "./convexClient.js";
import type { Health } from "./types.js";

export interface HeartbeatState {
  lastTickProcessed: number;
  lastSuccessAt: number;
  consecutiveErrors: number;
  currentStrategy?: string;
}

export function deriveHealth(state: HeartbeatState, nowMs: number): Health {
  const staleSec = (nowMs - state.lastSuccessAt) / 1000;
  if (state.consecutiveErrors >= 3 || staleSec > 180) return "red";
  if (state.consecutiveErrors >= 1 || staleSec > 90) return "yellow";
  return "green";
}

export function startHeartbeat(
  client: BusClient,
  state: HeartbeatState,
  intervalMs: number,
  signal: AbortSignal,
): void {
  if (signal.aborted) return;
  let inFlight = false;
  const tick = setInterval(async () => {
    if (signal.aborted) { clearInterval(tick); return; }
    if (inFlight) return;
    inFlight = true;
    const health = deriveHealth(state, Date.now());
    try {
      await client.heartbeat(state.lastTickProcessed, health, state.currentStrategy);
      state.lastSuccessAt = Date.now();
      state.consecutiveErrors = 0;
    } catch (err) {
      state.consecutiveErrors++;
      console.error("[heartbeat] failed:", err);
    } finally {
      inFlight = false;
    }
  }, intervalMs);
  signal.addEventListener("abort", () => clearInterval(tick), { once: true });
}
