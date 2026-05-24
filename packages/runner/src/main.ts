import { loadConfig } from "./config.js";
import { RunnerConvexClient } from "./convexClient.js";
import { startup } from "./startup.js";
import { handleAuxiliaryUpdate, handlePendingMessages, handleStartupDecision } from "./tickHandler.js";
import { TmuxSink } from "./tmuxSink.js";

async function main(): Promise<void> {
  console.log(`[elder-runner] starting at ${new Date().toISOString()}`);
  const config = loadConfig();
  console.log(`[elder-runner] elder=${config.elderId} convex=${config.convexUrl}`);

  const convex = new RunnerConvexClient(config.convexUrl, config.elderId, config.busSecret);
  const tmux = new TmuxSink(config.elderId);
  const ac = new AbortController();
  process.on("SIGTERM", () => ac.abort());
  process.on("SIGINT", () => ac.abort());

  const started = await startup(config, convex, tmux, ac.signal);
  try {
    const startupResult = await handleStartupDecision({
      config,
      convex,
      tmux,
      cachedSettings: started.startupState.gameSettings,
      signal: ac.signal,
    }, started.decision);

    let lastTickDelivered = (started.decision.kind === "wait" || startupResult.confirmed)
      ? (started.decision.kind === "wait"
        ? (started.startupState.lastReceivedTick ?? -1)
        : started.startupState.tickClock.tick)
      : (started.startupState.lastReceivedTick ?? started.startupState.tickClock.tick - 1);
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
      const result = await handleAuxiliaryUpdate(deps, aux);
      // Only advance the "delivered" cursor on confirmed receipt — if the
      // hook didn't write tickReceiveLog within the resend cap, the next
      // tick subscription wake-up will see this tick still un-delivered and
      // retry via the regular path (including any bundled pendingMessages).
      // Without this guard, lastTickDelivered ratchets past unconfirmed
      // ticks and the within-tick retry path is bypassed (tier-1 MED).
      if (result.confirmed) {
        lastTickDelivered = aux.tickClock.tick;
      }
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
