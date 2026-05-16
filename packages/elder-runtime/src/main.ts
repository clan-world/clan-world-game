import fs from "node:fs";
import { loadConfig } from "./config.js";
import { BusClient } from "./convexClient.js";
import { TmuxSink } from "./tmuxSink.js";
import { FreezeGate } from "./freezeGate.js";
import { startHeartbeat, type HeartbeatState } from "./heartbeat.js";
import { handleUserMessage } from "./commandHandlers/userMessage.js";
import { handleSystemMessage } from "./commandHandlers/systemMessage.js";
import { handleSnapshotRequest } from "./commandHandlers/snapshotRequest.js";
import { handleReset } from "./commandHandlers/reset.js";
import { handleFreeze } from "./commandHandlers/freeze.js";
import { handleUnfreeze } from "./commandHandlers/unfreeze.js";

async function main(): Promise<void> {
  console.log(`[elder-runtime] starting at ${new Date().toISOString()}`);

  const config = loadConfig();
  console.log(`[elder-runtime] elder=${config.elderId} convex=${config.convexUrl}`);

  // Ensure state dir exists
  fs.mkdirSync(config.stateDir, { recursive: true });

  const bus = new BusClient(config.convexUrl, config.busSecret, config.elderId);
  const tmux = new TmuxSink(config.elderId); // session name = "elder-1" etc.
  const freeze = new FreezeGate();

  const ac = new AbortController();
  process.on("SIGTERM", () => ac.abort());
  process.on("SIGINT", () => ac.abort());

  const heartbeatState: HeartbeatState = {
    lastTickProcessed: 0,
    lastSuccessAt: Date.now(),
    consecutiveErrors: 0,
  };
  startHeartbeat(bus, heartbeatState, config.heartbeatIntervalMs, ac.signal);

  // Poll loop
  console.log(`[elder-runtime] poll loop started (interval=${config.pollIntervalMs}ms)`);
  while (!ac.signal.aborted) {
    try {
      const commandId = await bus.claimNext();
      if (commandId) {
        const command = await bus.getCommand(commandId);
        if (!command) {
          console.warn(`[elder-runtime] claimed ${commandId} but getCommand returned null`);
        } else {
          console.log(`[elder-runtime] dispatching ${command.kind} (${commandId})`);
          try {
            switch (command.kind) {
              case "user_message":
                await handleUserMessage(commandId, command.payload, tmux, bus, freeze, config);
                break;
              case "system_message":
                await handleSystemMessage(commandId, command.payload, tmux, bus, config);
                break;
              case "snapshot_request":
                await handleSnapshotRequest(commandId, command.payload, bus, config);
                break;
              case "reset":
                await handleReset(commandId, command.payload, tmux, bus, freeze);
                break;
              case "freeze":
                await handleFreeze(commandId, command.payload, bus, freeze);
                break;
              case "unfreeze":
                await handleUnfreeze(commandId, command.payload, bus, freeze);
                break;
              default: {
                const kind = (command as { kind: string }).kind;
                console.warn(`[elder-runtime] unknown kind: ${kind}`);
                await bus.failCommand(commandId, `unknown kind: ${kind}`);
              }
            }
            heartbeatState.lastTickProcessed++;
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`[elder-runtime] handler error for ${commandId}:`, err);
            try { await bus.failCommand(commandId, reason); } catch { /* best-effort */ }
            heartbeatState.consecutiveErrors++;
          }
        }
      }
    } catch (err) {
      console.error("[elder-runtime] poll error:", err);
      heartbeatState.consecutiveErrors++;
    }
    if (!ac.signal.aborted) {
      await new Promise(r => setTimeout(r, config.pollIntervalMs));
    }
  }
  console.log(`[elder-runtime] shutdown complete`);
}

main().catch(err => {
  console.error("[elder-runtime] fatal:", err);
  process.exit(1);
});
