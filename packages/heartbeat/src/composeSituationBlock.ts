import type { ElderId } from './types';

export interface ComposeArgs {
  elder: ElderId;
  clanId: string;
  tick: number;
}

export const CONTEXT_RESET_INTERVAL_TICKS = 50;

export function isContextResetWarningTick(tick: number): boolean {
  return tick % CONTEXT_RESET_INTERVAL_TICKS === CONTEXT_RESET_INTERVAL_TICKS - 1;
}

export function isContextResetTick(tick: number): boolean {
  return tick % CONTEXT_RESET_INTERVAL_TICKS === 0;
}

/**
 * The first tick after a context-reset is when the Elder has the LEAST
 * conversational continuity (history just got wiped at T-1, the previous
 * `isContextResetTick`). Inject a rich orientation briefing here so the
 * Elder doesn't have to grope for context — the rest of the cycle gets the
 * lean `TICK N Started` marker.
 */
export function isRichBriefingTick(tick: number): boolean {
  return tick % CONTEXT_RESET_INTERVAL_TICKS === 1;
}

/**
 * Compose the per-tick update for a single Elder.
 *
 * Stable instructions live in the Elder runtime's CLAUDE.md/AGENTS.md. The
 * runner only nudges the live session when a tick starts. Two exceptions:
 *   - context-reset warning + final ticks (T49, T50 of each cycle for the
 *     50-tick interval — generally T(N-1), TN where N == CONTEXT_RESET_INTERVAL_TICKS)
 *   - rich briefing on the first tick after reset (T1, T51, T101, ...)
 */
export function composeSituationBlock(args: ComposeArgs): string {
  const lines: string[] = [];
  lines.push(`TICK ${args.tick} Started`);

  if (isContextResetWarningTick(args.tick)) {
    lines.push('');
    lines.push('⚠️ MEMORY-WIPE WARNING — your message history is erased on the next tick.');
    lines.push('');
    lines.push('Use this tick to consolidate everything that should survive. Run `elder memory save <key> <value>` for each:');
    lines.push('- `active-strategy` — your current plan (one paragraph).');
    lines.push('- `grudges` — who wronged you, who you owe.');
    lines.push('- `active-trades` — open whisper threads + outstanding offers.');
    lines.push('- `clan-priors` — your model of each peer\'s tendencies.');
    lines.push('- `mission-queue` — clansmen + their next-step orders not yet submitted.');
    lines.push('');
    lines.push('Anything you save now will be visible to the new context via `elder memory recall <key>`. Saved memory survives the wipe; your message history does not. Don\'t re-explain things that are already in your peer-whisper inbox or the public bulletin — those persist independently.');
  } else if (isContextResetTick(args.tick)) {
    lines.push('');
    lines.push('⚠️ FINAL TICK — your message history is wiped after this tick. Last chance to save.');
    lines.push('');
    lines.push('If you haven\'t already, RIGHT NOW:');
    lines.push('1. `elder memory save active-strategy "<one-paragraph plan>"` — your standing plan.');
    lines.push('2. `elder memory save grudges "<text>"` — outstanding rivalries / debts.');
    lines.push('3. `elder memory save active-trades "<text>"` — open whisper threads + offers.');
    lines.push('4. `elder memory save clan-priors "<text>"` — your model of peers.');
    lines.push('5. `elder memory save mission-queue "<text>"` — clansmen action plans not yet submitted.');
    lines.push('');
    lines.push('Then `elder ack-clear` to signal the runner you\'re ready for the wipe. The runner clears your context after that. The next tick (T+1) will arrive in fresh context with a rich orientation briefing — your saved memory + peer inbox + bulletin posts will all still be there, just not your conversation.');
  } else if (isRichBriefingTick(args.tick)) {
    const nextResetTick = args.tick - 1 + CONTEXT_RESET_INTERVAL_TICKS;
    lines.push('');
    lines.push(`You are Elder of clan-${args.clanId}. Fresh context — your message history was reset at the previous tick.`);
    lines.push('');
    lines.push('Reorient and act. Suggested order:');
    lines.push('1. `elder memory recall active-strategy` — pull forward the standing plan you saved before the reset.');
    lines.push('2. `elder world snapshot` — current tick, season, market prices, bandit state, public bulletins.');
    lines.push(`3. \`elder clan view ${args.clanId}\` — your missions, vault, cooldowns, hunger, clansmen.`);
    lines.push('4. `elder peer inbox` — private whispers from peer clans.');
    lines.push('');
    lines.push('Then decide what to do this cycle:');
    lines.push('- **Submit orders** if your plan needs an update: `elder clan submit-orders <orders.json>`.');
    lines.push('- **Whisper a peer** point-to-point: `elder peer whisper <clanId> "<msg>"` (private, AXL-routed).');
    lines.push('- **Post to the public bulletin** to shape the realm narrative — declarations, threats, alliances, public ledger entries. Bulletins are 0G-stored and visible to every other Elder + the iNFT Owner.');
    lines.push('- **Save durable knowledge**: `elder memory save <key> <value>` for anything that needs to outlive the next wipe.');
    lines.push('');
    lines.push('🪣 **The loot loop — your bread and butter:** Resources accrue zero value sitting in a clansman\'s wheelbarrow. Vault deposits are what fund vault upgrades, hunger relief, and trades. Every cycle you must:');
    lines.push('  1. **Audit clansman capacities.** `elder clan view <clanId>` shows each clansman\'s `carryWood/Iron/Wheat/Fish`. Anyone near full (≥80% of capacity) is dead weight in the field.');
    lines.push('  2. **Send full carriers home.** Order them on a `RETURN_TO_BASE` mission to deposit into the vault. Carrying capacity reopens, and the vault total goes up.');
    lines.push('  3. **Dispatch idle clansmen** (state=WAITING, empty wheelbarrow) on `GATHER_*` missions to the right region — wood from forest, iron from mountains, wheat from farms, fish from docks.');
    lines.push('  4. **Watch hunger.** `livingClansmen` decreases when starvation kicks in. If your wheat vault is low, prioritize wheat gathering AND wheat trades over raids.');
    lines.push('Idle clansmen + full wheelbarrows = the most common failure mode. Don\'t let them stand around with loot.');
    lines.push('');
    lines.push(`Memory cycle: your message history is cleared every ${CONTEXT_RESET_INTERVAL_TICKS} ticks. Next reset at tick ${nextResetTick}. The bulletin board, your saved memory keys, and your peer-whisper inbox all persist across resets independently of your message history — use them generously.`);
    lines.push('');
    lines.push('Diplomacy is a tool. Silent clans get out-played by communicative ones. Coordinate, threaten, broker — the world is a function of what gets said as much as what gets done.');
  }

  return lines.join('\n');
}
