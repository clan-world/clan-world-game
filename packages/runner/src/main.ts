import { loadConfig } from "./config.js";
import { RunnerConvexClient } from "./convexClient.js";
import { startup } from "./startup.js";
import { handleAuxiliaryUpdate, handlePendingMessages, handleStartupDecision } from "./tickHandler.js";
import { TmuxSink } from "./tmuxSink.js";

async function main(): Promise<void> {
  console.log(`[elder-runner] starting at ${new Date().toISOString()}`);
  const config = loadConfig();
  console.log(`[elder-runner] elder=${config.elderId} convex=${config.convexUrl}`);

  const convex = new RunnerConvexClient(config.convexUrl, config.elderId);
  const tmux = new TmuxSink(config.elderId);
  const ac = new AbortController();
  process.on("SIGTERM", () => ac.abort());
  process.on("SIGINT", () => ac.abort());

  const started = await startup(config, convex, tmux, ac.signal);
  try {
    await handleStartupDecision({
      config,
      convex,
      tmux,
      cachedSettings: started.startupState.gameSettings,
      signal: ac.signal,
    }, started.decision);

    let lastTickDelivered = started.decision.kind === "wait"
      ? (started.startupState.lastReceivedTick ?? -1)
      : started.startupState.tickClock.tick;
    for await (const aux of convex.watchAuxiliary(ac.signal)) {
      if (ac.signal.aborted) break;
      const deps = {
        config,
        convex,
        tmux,
        cachedSettings: started.startupState.gameSettings,
        signal: ac.signal,
      };
      if (aux.tickClock.tick <= lastTickDelivered) {
        if (aux.pendingMessages.length > 0) await handlePendingMessages(deps, aux);
        continue;
      }
      await handleAuxiliaryUpdate(deps, aux);
      lastTickDelivered = aux.tickClock.tick;
    }
  } finally {
    started.flock.release();
    convex.close();
  }
}

main().catch(err => {
  console.error("[elder-runner] fatal:", err);
  process.exit(1);
});
