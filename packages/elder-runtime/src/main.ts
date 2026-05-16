import { openSync, writeSync, closeSync, unlinkSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
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
  mkdirSync(config.stateDir, { recursive: true });

  // Atomic singleton lock via wx (exclusive create) — eliminates TOCTOU
  const lockPath = path.join(config.stateDir, "supervisor.lock");
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, "wx");
    writeSync(lockFd, String(process.pid));
  } catch (err: any) {
    if (err.code === "EEXIST") {
      // Stale-lock check: verify the owning process is still a tsx elder-runtime
      let stillAlive = false;
      try {
        const stalePid = parseInt(readFileSync(lockPath, "utf8").trim(), 10);
        if (Number.isFinite(stalePid)) {
          process.kill(stalePid, 0); // throws if dead
          const cmdline = readFileSync(`/proc/${stalePid}/cmdline`, "utf8");
          if (cmdline.includes("tsx") && cmdline.includes("elder-runtime")) {
            stillAlive = true;
          }
        }
      } catch { /* dead or no /proc — treat as stale */ }
      if (stillAlive) {
        console.error("[elder-runtime] FATAL: another supervisor already running. Exiting.");
        process.exit(1);
      }
      // Stale lock — remove and retry
      unlinkSync(lockPath);
      lockFd = openSync(lockPath, "wx");
      writeSync(lockFd, String(process.pid));
    } else {
      console.error("[elder-runtime] could not acquire singleton lock:", err);
      process.exit(1);
    }
  }
  const cleanupLock = () => {
    try { closeSync(lockFd); } catch { /* ignore */ }
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  };
  process.on("exit", cleanupLock);

  // Write readiness file to writable stateDir — entrypoint polls for this
  const readyPath = path.join(config.stateDir, "elder-runtime.ready");
  try {
    writeFileSync(readyPath, String(process.pid));
  } catch (err) {
    console.error("[elder-runtime] FATAL: could not write readiness file", err);
    process.exit(1);
  }

  const bus = new BusClient(config.convexUrl, config.busSecret, config.elderId);
  const tmux = new TmuxSink(config.elderId); // session name = "elder-1" etc.
  const freeze = new FreezeGate();

  const ac = new AbortController();
  process.on("SIGTERM", () => { cleanupLock(); ac.abort(); });
  process.on("SIGINT", () => { cleanupLock(); ac.abort(); });

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
      const command = await bus.claimNext();
      if (command) {
        console.log(`[elder-runtime] dispatching ${command.kind} (${command._id})`);
        try {
          switch (command.kind) {
            case "user_message":
              await handleUserMessage(command._id, command.payload, tmux, bus, freeze, config);
              break;
            case "system_message":
              await handleSystemMessage(command._id, command.payload, tmux, bus, freeze, config);
              break;
            case "snapshot_request":
              await handleSnapshotRequest(command._id, command.payload, bus, config);
              break;
            case "reset":
              await handleReset(command._id, command.payload, tmux, bus, freeze);
              break;
            case "freeze":
              await handleFreeze(command._id, command.payload, bus, freeze);
              break;
            case "unfreeze":
              await handleUnfreeze(command._id, command.payload, bus, freeze);
              break;
            default: {
              const kind = (command as { kind: string }).kind;
              console.warn(`[elder-runtime] unknown kind: ${kind}`);
              await bus.failCommand(command._id, `unknown kind: ${kind}`);
            }
          }
          heartbeatState.lastTickProcessed++;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`[elder-runtime] handler error for ${command._id}:`, err);
          try { await bus.failCommand(command._id, reason); } catch { /* best-effort */ }
          heartbeatState.consecutiveErrors++;
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
