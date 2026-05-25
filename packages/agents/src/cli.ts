#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assertSafeInboxKey, type ClanOrder } from '@clan-world/shared';
import type { IConvexClient, IChainClient } from '@clan-world/shared/adapters';
import { createConvexClient, createChainClient } from '@clan-world/shared/adapters';

export class UsageError extends Error {}

const RESTRICTED_FILE_MODE = 0o600;

function withTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    let promise: Promise<T>;
    try {
      promise = factory(controller.signal);
    } catch (err) {
      // Factory threw synchronously before returning a promise — clear the
      // timer eagerly so we don't leak a node handle past rejection.
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function writeRestrictedFileSync(
  file: string,
  data: string,
  options: Omit<fs.WriteFileOptions, 'mode'> = {},
): void {
  fs.writeFileSync(file, data, {
    ...options,
    mode: RESTRICTED_FILE_MODE,
  });
  fs.chmodSync(file, RESTRICTED_FILE_MODE);
}

function appendRestrictedFileSync(
  file: string,
  data: string,
  options: Omit<fs.WriteFileOptions, 'mode'> = {},
): void {
  fs.appendFileSync(file, data, {
    ...options,
    mode: RESTRICTED_FILE_MODE,
  });
  fs.chmodSync(file, RESTRICTED_FILE_MODE);
}

export function getElderN(env: Record<string, string | undefined> = process.env): number {
  const val = env['ELDER_N'];
  if (!val) throw new UsageError('elder: ELDER_N env var is not set');
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1 || n > 4) throw new UsageError(`elder: ELDER_N must be an integer 1–4, got '${val}'`);
  return n;
}

export function stateDir(base: string = os.homedir()): string {
  return path.join(base, '.world', 'clanworld-runner', 'state');
}

export function memoryFile(n: number, base?: string): string {
  return path.join(stateDir(base), `elder-${n}-memory.json`);
}

export function inboxFile(n: number, base?: string): string {
  return path.join(stateDir(base), 'peer-inbox', `elder-${n}.jsonl`);
}

export function recipientInboxFile(clanId: string, base?: string): string {
  assertSafeInboxKey(clanId);
  return path.join(stateDir(base), 'peer-inbox', `elder-${clanId}.jsonl`);
}

export function ackFile(n: number, base?: string): string {
  return path.join(stateDir(base), `elder-${n}-ack.flag`);
}

export function readMemory(n: number, base?: string): Record<string, string> {
  const file = memoryFile(n, base);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

export function writeMemory(n: number, data: Record<string, string>, base?: string): void {
  const file = memoryFile(n, base);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeRestrictedFileSync(file, JSON.stringify(data, null, 2) + '\n', {
    encoding: 'utf8',
  });
}

export interface Deps {
  convex: IConvexClient;
  chain: IChainClient;
}

// ---------------------------------------------------------------------------
// Help text
//
// Hand-rolled (per packages/agents/AGENTS.md "Argv parsing is hand-rolled (no
// commander), keep deps minimal"). Each subcommand has its own help block so
// `elder <cmd> --help` prints the same level of detail as `elder --help`.
// ---------------------------------------------------------------------------

const TOP_LEVEL_HELP = `elder — Clan World CLI for Elder agents

USAGE:
  elder <command> [...]

COMMANDS:
  world snapshot                              Read current world state (tick, season, all clans)
  clan view <clanId>                          Read full state of one clan (resources, clansmen, missions)
  clan submit-orders <ordersJsonFile>         Submit pending mission orders for your clan
  memory recall <topic>                       Read your saved memory by key
  memory save <key> <value>                   Persist memory across context wipes
  peer whisper <toClanId> <msg>               Send a whisper to another clan's inbox
  peer inbox                                  Read your unread whispers
  bulletin post <msg>                         Post a public bulletin visible to all clans
  ack-clear                                   Signal runner you're ready for context wipe
  rules                                       Print game rules + capacity constants + action codes

OPTIONS:
  --help, -h                                  Show help for a command
  --version, -v                               Show CLI version

EXAMPLES:
  elder world snapshot
  elder clan view 1
  elder clan submit-orders /tmp/my-orders.json
  elder memory save active-strategy "T19. Food-first; trade iron for wheat with clan 4."
  elder peer whisper 2 "Iron-for-wheat at 1:2, T20+. Confirm?"
  elder bulletin post "Defense alliance forming. Bring wheat, I bring iron."
  elder rules

For per-command help: elder <command> --help
`;

const SUBMIT_ORDERS_HELP = `elder clan submit-orders <ordersJsonFile>

Submit pending mission orders for your clan. Reads orders from a JSON file.

JSON SCHEMA:
{
  "clanId": "<your clan ID as string>",
  "orders": [
    {
      "kind": "mission",                        // REQUIRED. Wave 0 only supports "mission".
      "payload": {                              // REQUIRED nested object — fields below.
        "clansmanId": <number>,                 // 1..N within your clan
        "gotoRegion": <number>,                 // destination region 0..8 (see 'elder rules')
        "action": <number>,                     // ACTION_CODE 1..14 (see 'elder rules')
        "targetClanId": <number>,               // (optional, for DefendBase/combat; default 0)
        "marketToken": "<address>",             // (optional, for MarketBuy; default zero address)
        "marketAmount": "<bigint string>",      // (optional, for MarketSell; default "0")
        "maxGoldIn": "<bigint string>",         // (optional, for MarketBuy; default "0")
        "withdrawResources": {                  // (optional, for WithdrawResources; default all "0")
          "wood": "<bigint string>",
          "iron": "<bigint string>",
          "wheat": "<bigint string>",
          "fish": "<bigint string>"
        }
      }
    }
  ]
}

EXAMPLES:

1. Send clansman 1 to Forest (region 1) to chop wood (action 1 = ChopWood):

   cat > /tmp/orders.json <<'EOF'
   {
     "clanId": "1",
     "orders": [
       { "kind": "mission",
         "payload": { "clansmanId": 1, "gotoRegion": 1, "action": 1 } }
     ]
   }
   EOF
   elder clan submit-orders /tmp/orders.json

2. Send clansman 1 home to deposit (action 6 = DepositResources). Use your clan's
   home base region as gotoRegion:

   cat > /tmp/deposit.json <<'EOF'
   {
     "clanId": "1",
     "orders": [
       { "kind": "mission",
         "payload": { "clansmanId": 1, "gotoRegion": 1, "action": 6 } }
     ]
   }
   EOF
   elder clan submit-orders /tmp/deposit.json

3. Submit four missions in one call (one per clansman, four resources):

   cat > /tmp/spread.json <<'EOF'
   {
     "clanId": "1",
     "orders": [
       { "kind": "mission", "payload": { "clansmanId": 1, "gotoRegion": 1, "action": 1 } },
       { "kind": "mission", "payload": { "clansmanId": 2, "gotoRegion": 2, "action": 2 } },
       { "kind": "mission", "payload": { "clansmanId": 3, "gotoRegion": 4, "action": 5 } },
       { "kind": "mission", "payload": { "clansmanId": 4, "gotoRegion": 6, "action": 3 } }
     ]
   }
   EOF
   elder clan submit-orders /tmp/spread.json

COMMON ERRORS:
  "missing required payload fields (clansmanId, gotoRegion, action)"
        payload is REQUIRED. Don't put fields at the top level — wrap in
        "payload": { ... }.

  "no valid mission orders to submit"
        all orders had kind != "mission". Set kind: "mission".

  "Cannot destructure 'clansmanId' of 'order.payload' as it is undefined"
        payload key was missing entirely. Wrap fields in payload: { ... }.

  "ClanWorld: clan dead"
        your clan is dead this season. Try \`elder world snapshot\` to confirm
        season state and your ClanState.

  "Wave 0 only supports 'mission' kind, N skipped"
        non-mission orders are silently dropped today.

See \`elder rules\` for the full action-code table and region map.
`;

const WORLD_SNAPSHOT_HELP = `elder world snapshot

Read the current world state. Returns JSON to stdout containing:
  - tick (current tick number)
  - tickEpoch (when the current tick started + tick duration)
  - regions (all regions with owners)
  - clans (all clans with treasury / state)

EXAMPLES:
  elder world snapshot
  elder world snapshot | jq '.tick'
`;

const CLAN_VIEW_HELP = `elder clan view <clanId>

Read full chain state of one clan. Returns JSON to stdout containing:
  - clan (id, name, treasury, ClanState — ACTIVE or DEAD)
  - controlledRegions (regions this clan owns / occupies)
  - pendingOrders (orders submitted for the next tick)
  - whispers (recent inbound whispers from peers)

EXAMPLES:
  elder clan view 1
  elder clan view 1 | jq '.clan.treasury'
`;

const MEMORY_RECALL_HELP = `elder memory recall <topic>

Read a saved memory entry by key. Memory is local to your elder process and
persists across context wipes. Requires ELDER_N env var.

EXAMPLES:
  elder memory recall active-strategy
  elder memory recall trade-partners
`;

const MEMORY_SAVE_HELP = `elder memory save <key> <value...>

Persist a memory entry across context wipes. The value can be multiple words —
they are joined with single spaces. Requires ELDER_N env var.

EXAMPLES:
  elder memory save active-strategy "T19. Food-first; trade iron for wheat with clan 4."
  elder memory save trade-partners "clan-2 (iron->wheat 1:2), clan-4 (wood->fish 1:1)"
`;

const PEER_WHISPER_HELP = `elder peer whisper <toClanId> <msg...>

Send a whisper to another clan's inbox. The msg can be multiple words; they are
joined with single spaces and stored as a single message. Requires ELDER_N env
var (used as the sender ID).

EXAMPLES:
  elder peer whisper 2 "Iron-for-wheat at 1:2, T20+. Confirm?"
  elder peer whisper 4 "Defending east farms this tick — keep clansmen home."

NOTE:
  Whisper writes to elder-<toClanId>.jsonl. Inbox reads by ELDER_N. Round-trip
  works only when clanId == String(ELDER_N) (S2 default 1:1 mapping). See
  issue #94.
`;

const PEER_INBOX_HELP = `elder peer inbox

Read all unread whispers in your inbox. Requires ELDER_N env var. Output is one
line per whisper:

  [<iso-ts>] from=<senderElderN> to=<recipientClanId>: <msg>

EXAMPLES:
  elder peer inbox
`;

const BULLETIN_POST_HELP = `elder bulletin post <msg...>

Post a public bulletin for your clan. Bulletins are visible to every Elder and
the iNFT Owner cockpit. Requires ELDER_N env var.

EXAMPLES:
  elder bulletin post "Defense alliance forming. Bring wheat, I bring iron."
`;

const ACK_CLEAR_HELP = `elder ack-clear

Signal the runner that you've finished processing this tick and are ready for a
context wipe. Writes a flag file at ~/.world/clanworld-runner/state/elder-<N>-ack.flag.
Requires ELDER_N env var.

EXAMPLES:
  elder ack-clear
`;

const RULES_HELP = `elder rules

Print canonical game rules + capacity constants + action codes. Read this once
on first boot and after any rule change.

EXAMPLES:
  elder rules
  elder rules | grep -A5 'ACTION CODES'
`;

const SUBCOMMAND_HELP: Record<string, string> = {
  'world snapshot': WORLD_SNAPSHOT_HELP,
  'clan view': CLAN_VIEW_HELP,
  'clan submit-orders': SUBMIT_ORDERS_HELP,
  'memory recall': MEMORY_RECALL_HELP,
  'memory save': MEMORY_SAVE_HELP,
  'peer whisper': PEER_WHISPER_HELP,
  'peer inbox': PEER_INBOX_HELP,
  'bulletin post': BULLETIN_POST_HELP,
  'ack-clear': ACK_CLEAR_HELP,
  rules: RULES_HELP,
  // also handle bare-namespace help
  world: WORLD_SNAPSHOT_HELP,
  clan: `elder clan <subcommand>

Subcommands:
  view <clanId>                        Read full state of one clan
  submit-orders <ordersJsonFile>       Submit pending mission orders

For per-subcommand help: elder clan <subcommand> --help
`,
  memory: `elder memory <subcommand>

Subcommands:
  recall <topic>                       Read saved memory by key
  save <key> <value...>                Persist memory across context wipes

For per-subcommand help: elder memory <subcommand> --help
`,
  peer: `elder peer <subcommand>

Subcommands:
  whisper <toClanId> <msg...>          Send whisper to another clan
  inbox                                Read your unread whispers

For per-subcommand help: elder peer <subcommand> --help
`,
  bulletin: `elder bulletin <subcommand>

Subcommands:
  post <msg...>                        Post a public bulletin for your clan

For per-subcommand help: elder bulletin <subcommand> --help
`,
};

// ---------------------------------------------------------------------------
// Rules text — canonical game rules.
//
// Values are sourced from packages/shared/src/generated/constants.ts (which is
// generated from packages/contracts/src/diamond/lib/Lib*.sol via
// scripts/gen-constants.mjs). When constants change, this text drifts; future
// improvement is to import them at runtime, but for hackathon we hardcode +
// reference the canonical source here.
//
// Action codes mirror packages/shared/src/generated/enums.ts (ActionType).
// Region codes mirror generated/constants.ts (REGION_*).
// ---------------------------------------------------------------------------

const RULES_TEXT = `CLAN WORLD — RULES & CONSTANTS
(canonical source: packages/shared/src/generated/{enums,constants}.ts)

================================================================
ACTION CODES (set as 'action' field in mission payload)
================================================================
  0  = None                  (no-op; do not submit)
  1  = ChopWood              gather wood from a forest region
  2  = MineIron              gather iron from a mountain region
  3  = FishDocks             fish from a docks region (lower yield, safer)
  4  = FishDeepSea           fish from deep sea (higher yield, riskier)
  5  = HarvestWheat          harvest a wheat plot in a farm region
  6  = DepositResources      drop carried resources into your clan vault
                             (must travel to your home base first)
  7  = UpgradeWall           spend wood/iron at home base to upgrade wall
  8  = UpgradeBase           spend wood/iron/wheat at home base to upgrade
  9  = UpgradeMonument       spend wood/iron/wheat/blueprint to upgrade monument
                             (UNICORN TOWN only)
  10 = DefendBase            stand on home base to defend vs. bandits
                             (set targetClanId for cross-clan defense; 0 = self)
  11 = MarketBuy             buy gold-token at Unicorn Town
                             (set marketToken + maxGoldIn)
  12 = MarketSell            sell resource at Unicorn Town
                             (set marketAmount)
  13 = Wait                  remain in current region (no action)
  14 = WithdrawResources     withdraw from clan vault to clansman's wheelbarrow
                             (must be at home base; set withdrawResources)

================================================================
REGION CODES (set as 'gotoRegion' field in mission payload)
================================================================
  0 = REGION_NOOP            (sentinel — do not travel)
  1 = Forest                 ChopWood (action 1)
  2 = Mountains              MineIron (action 2)
  3 = Unicorn Town           Market actions (11/12), monument (9)
  4 = West Farms             HarvestWheat (action 5)
  5 = East Farms             HarvestWheat (action 5)
  6 = West Docks             FishDocks (action 3)
  7 = East Docks             FishDocks (action 3)
  8 = Deep Sea               FishDeepSea (action 4)

NOTE: each clan also has a home-base region used as gotoRegion for
DepositResources / UpgradeBase / DefendBase / WithdrawResources. Read your
home base from \`elder clan view <clanId>\` (controlledRegions[0] or similar).

================================================================
WHEELBARROW & VAULT CAPACITIES
================================================================
  CLANSMAN_CARRY_CAP   =  10 (per resource — clansman wheelbarrow limit)
  WOOD_CAP             =  15 (clan vault wood cap)
  IRON_CAP             =   5 (clan vault iron cap)
  WHEAT_CAP            =  40 (clan vault wheat cap)
  FISH_CAP             =   8 (clan vault fish cap)

(All caps are in tokens — i.e. divided by 1e18 from the on-chain wei value.)

================================================================
RESOURCE YIELDS (per tick of work)
================================================================
  WOOD_YIELD_PER_TICK    = 1     (per ChopWood tick)
  WOOD_CRIT_BPS          = 1000  (10% chance of crit; doubles tick yield)
  IRON_BASE_YIELD        = 0.5   (per MineIron tick)
  WHEAT_YIELD_PER_TICK   = 5     (per HarvestWheat tick)
  FISH_YIELD_PER_TICK    = 0.25  (base; modified by docks/deep-sea bps below)
  FISH_DOCKS_BPS         = 2500  (25% multiplier at docks)
  FISH_DEEP_BPS          = 7500  (75% multiplier at deep sea)

(All yields in tokens — divide on-chain value by 1e18.)

================================================================
TIMING
================================================================
  HEARTBEAT_INTERVAL_SECONDS = 60   (one tick = ~60s real time)
  CLANSMAN_COOLDOWN_SECONDS  = 60   (after action, clansman idles 1 tick)
  WHEAT_PLOT_REGROW_TICKS    = 4    (a plot you harvested regrows in 4 ticks)
  Travel time:                       quoteTravel(src, dst) returns travelTicks.
                                     Use \`elder clan view <clanId>\` to read
                                     each clansman's current region first.

================================================================
SEASON & WINTER
================================================================
  SEASON_DURATION_TICKS         = 360
  WINTER_START_TICK             = 110  (relative to season start)
  WINTER_DURATION_TICKS         = 10
  WINTER_PERIOD_TICKS           = 110  (winter recurs every N ticks)
  WHEAT_UPKEEP_PER_CLANSMAN     = 1    (per tick — clansmen eat wheat)
  FISH_UPKEEP_PER_CLANSMAN      = 0.1  (per tick — alt food source)
  WINTER_WOOD_BURN_PER_CLANSMAN = 0.5  (per tick during winter)
  WINTER_WOOD_BURN_PER_BASE     = 1    (per tick during winter)
  WINTER_UPKEEP_MULTIPLIER_BPS  = 20000 (winter doubles upkeep)
  COLD_DAMAGE_PER_WALL_DEGRADATION = 2  (cold ticks per wall degrade)
  COLD_DAMAGE_PER_CLANSMAN_DEATH   = 2  (cold ticks per clansman death)

================================================================
BANDITS
================================================================
  BANDIT_COOLDOWN_TICKS         = 10
  BANDIT_CAMP_TICKS             = 3   (bandit camps for N ticks before attacking)
  BANDIT_MAX_ATTACK_ATTEMPTS    = 6
  BANDIT_BASE_STEAL_BPS         = 2000 (steal 20% on success)
  BANDIT_DROP_TO_DEFENDERS_BPS  = 5000 (defenders recover 50% on kill)

================================================================
COMMON PATTERNS
================================================================

1. Gather wood (or iron / wheat / fish):
   - Send clansman to a region matching the action.
   - Wait until wheelbarrow is full (CLANSMAN_CARRY_CAP / yield-per-tick ticks).
   - Send the same clansman home (action 6 = DepositResources, gotoRegion = home).
   - Repeat.

2. Trade iron for wheat with peer clan:
   - elder peer whisper <peer> "iron-for-wheat at 1:2, T20+. Confirm?"
   - When peer confirms, both submit MarketSell + MarketBuy at Unicorn Town
     (region 3) with the agreed marketToken + amount.

3. Defend against bandits:
   - When \`elder world snapshot\` shows bandit near your region, submit
     action 10 (DefendBase) with your home base as gotoRegion. targetClanId=0
     means defend self.

================================================================
CLAN DEATH CONDITIONS
================================================================
  - Starvation: clan vault wheat + fish runs out during upkeep.
  - Cold: insufficient wood during winter -> wall degrades -> clansmen die.
  - Settlement: lose all clansmen.
  - Once dead (ClanState=DEAD, code 1) you cannot submit orders this season.

================================================================
ERROR CODES (from generated/enums.ts StatusCode)
================================================================
  0  = OK                      success
  1  = ERR_CLAN_DEAD           your clan is dead this season
  2  = ERR_CLAN_NOT_OWNED      clansman not owned by submitter
  3  = ERR_CLANSMAN_DEAD
  4  = ERR_INVALID_CLANSMAN
  5  = ERR_INVALID_REGION
  6  = ERR_INVALID_ACTION
  7  = ERR_INVALID_TARGET
  8  = ERR_COOLDOWN_ACTIVE     clansman acted last tick; wait 1 tick
  9  = ERR_NOT_WAITING         clansman is mid-action / mid-travel
  10 = ERR_NOT_IN_UNICORN_TOWN MarketBuy/Sell requires region 3
  11 = ERR_NOT_AT_HOMEBASE     DepositResources/UpgradeBase need home region
  12 = ERR_NOT_AT_TARGET_BASE
  13 = ERR_NOT_DEFENDABLE
  14 = ERR_MISSING_RESOURCES
  15 = ERR_EMPTY_CARGO         DepositResources with empty wheelbarrow
  16 = ERR_PLOT_NOT_READY      wheat plot still regrowing
  17 = ERR_PLOT_EMPTY
  18 = ERR_MARKET_ZERO_AMOUNT
  19 = ERR_MARKET_UNSUPPORTED_TOKEN
  20 = ERR_IMMEDIATE_MARKET_NOT_ELIGIBLE
  21 = ERR_MARKET_BUY_OVER_CAPACITY
  22 = ERR_MAX_GOLD_IN_EXCEEDED
  23 = ERR_WORLD_TICK_MISMATCH
  24 = ERR_NO_ACTIVE_BANDIT
  25 = ERR_SEASON_ENDED
  26 = ERR_NOT_ENOUGH_GOLD
  27 = ERR_CARRY_FULL          wheelbarrow already full; deposit first
  28 = ERR_WINTER_LOCKED       wheat plots locked during winter
  29 = ERR_MUST_SETTLE_FIRST
  30 = ERR_LIQUIDITY_INSUFFICIENT
  31 = ERR_SLIPPAGE_REQUIRED
`;

// ---------------------------------------------------------------------------
// Argv parsing — detect --help / -h before positional consumption.
// ---------------------------------------------------------------------------

function isHelpFlag(arg: string | undefined): boolean {
  return arg === '--help' || arg === '-h';
}

function isVersionFlag(arg: string | undefined): boolean {
  return arg === '--version' || arg === '-v';
}

/**
 * Inspect argv for a --help/-h flag in any position. Returns the help text for
 * the matched (sub)command, or undefined if no help was requested.
 *
 * Must be called BEFORE positional consumption so `--help` is never mistaken
 * for an `<ordersJsonFile>` (the bug elder-1 hit).
 */
export function resolveHelp(args: string[]): string | undefined {
  const hasHelpFlag = args.some(isHelpFlag);
  if (!hasHelpFlag && args.length === 0) return TOP_LEVEL_HELP;
  if (!hasHelpFlag) return undefined;

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) return TOP_LEVEL_HELP;

  // try two-word match (e.g. "clan submit-orders") then one-word
  const two = positional.slice(0, 2).join(' ');
  if (SUBCOMMAND_HELP[two]) return SUBCOMMAND_HELP[two];
  const one = positional[0];
  if (one && SUBCOMMAND_HELP[one]) return SUBCOMMAND_HELP[one];
  return TOP_LEVEL_HELP;
}

export async function runCommand(
  ns: string | undefined,
  cmd: string | undefined,
  rest: string[],
  deps: Deps,
  env: Record<string, string | undefined> = process.env,
  homeBase?: string,
): Promise<string> {
  if (ns === 'world' && cmd === 'snapshot') {
    const snapshot = await deps.convex.getSnapshot();
    return JSON.stringify(snapshot, null, 2) + '\n';
  }

  if (ns === 'clan' && cmd === 'view') {
    const [clanId] = rest;
    if (!clanId) throw new UsageError('usage: elder clan view <clanId>');
    const result = await deps.chain.getClanFullView(clanId);
    return JSON.stringify(result, null, 2) + '\n';
  }

  if (ns === 'clan' && cmd === 'submit-orders') {
    const [ordersFile] = rest;
    if (!ordersFile) throw new UsageError('usage: elder clan submit-orders <ordersJsonFile>');
    let parsed: { clanId: string; orders: ClanOrder[] };
    try {
      const raw = fs.readFileSync(ordersFile, 'utf8');
      parsed = JSON.parse(raw) as { clanId: string; orders: ClanOrder[] };
    } catch (err) {
      throw new UsageError(`elder: failed to read orders file '${ordersFile}': ${String(err)}`);
    }
    if (!parsed.clanId || !Array.isArray(parsed.orders)) {
      throw new UsageError(`elder: orders file must contain { clanId: string, orders: [...] }`);
    }
    if (env['ELDER_N']) {
      const ownClanId = String(getElderN(env));
      if (parsed.clanId !== ownClanId) {
        throw new UsageError(
          `elder: refusing to submit orders for clanId ${parsed.clanId}; this elder is ELDER_N=${ownClanId}`,
        );
      }
    }
    const result = await deps.chain.submitOrders(parsed.clanId, parsed.orders);
    return JSON.stringify(result, null, 2) + '\n';
  }

  if (ns === 'memory' && cmd === 'recall') {
    const [topic] = rest;
    if (!topic) throw new UsageError('usage: elder memory recall <topic>');
    const n = getElderN(env);
    const mem = readMemory(n, homeBase);
    const val = mem[topic];
    return val !== undefined ? val + '\n' : `no memory for ${topic}\n`;
  }

  if (ns === 'memory' && cmd === 'save') {
    const [key, ...valueParts] = rest;
    if (!key || valueParts.length === 0) throw new UsageError('usage: elder memory save <key> <value>');
    const value = valueParts.join(' ');
    const n = getElderN(env);
    const mem = readMemory(n, homeBase);
    mem[key] = value;
    writeMemory(n, mem, homeBase);
    return `saved ${key}\n`;
  }

  if (ns === 'peer' && cmd === 'whisper') {
    const [clanId, ...msgParts] = rest;
    if (!clanId || msgParts.length === 0) throw new UsageError('usage: elder peer whisper <clanId> <msg>');
    const n = getElderN(env);
    const fromClanId = Number(n);
    const toClanIdNumeric = Number(clanId);
    const canMirrorToCockpit =
      Number.isFinite(toClanIdNumeric) && Number.isInteger(toClanIdNumeric) && toClanIdNumeric > 0;
    const msg = msgParts.join(' ');

    // Durable local write first — guarantees elder-to-elder delivery even if chain/convex are down.
    // Local transport accepts any safe inbox key (numeric or string identifier per assertSafeInboxKey).
    const entry = JSON.stringify({ from: n, to: clanId, msg, ts: new Date().toISOString() });
    const file = recipientInboxFile(clanId, homeBase);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    appendRestrictedFileSync(file, entry + '\n', {
      encoding: 'utf8',
    });

    // Best-effort cockpit mirror — only when clanId is a valid numeric clan, and bounded so a
    // chain or convex hang cannot pin the CLI past 10s total.
    if (canMirrorToCockpit) {
      try {
        const tick = await withTimeout(
          (signal) => deps.chain.getCurrentTick(signal),
          5000,
          'chain.getCurrentTick',
        );
        const msgId = `${fromClanId}:${tick}:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        await withTimeout(
          (signal) => deps.convex.postWhisper({
            tick,
            fromClanId,
            toClanIds: [toClanIdNumeric],
            body: msg,
            msgId,
            signal,
          }),
          5000,
          'convex.postWhisper',
        );
      } catch (err) {
        console.warn('[elder peer whisper] cockpit mirror failed (non-fatal):', err);
      }
    }
    return 'whisper sent\n';
  }

  if (ns === 'peer' && cmd === 'inbox') {
    const n = getElderN(env);
    // Reads by ELDER_N, not clanId. Round-trips with 'peer whisper' only when
    // clanId === String(elderN). Issue #94 tracks the fix (option A: ELDER_CLAN_ID).
    const file = inboxFile(n, homeBase);
    if (!fs.existsSync(file)) return 'inbox empty\n';
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length === 0) return 'inbox empty\n';
    return lines
      .map(line => {
        try {
          const entry = JSON.parse(line) as { from: number; to: string; msg: string; ts: string };
          return `[${entry.ts}] from=${entry.from} to=${entry.to}: ${entry.msg}`;
        } catch {
          return line;
        }
      })
      .join('\n') + '\n';
  }

  if (ns === 'bulletin' && cmd === 'post') {
    if (rest.length === 0) throw new UsageError('usage: elder bulletin post <msg>');
    const n = getElderN(env);
    const body = rest.join(' ').trim();
    if (!body) throw new UsageError('usage: elder bulletin post <msg>');
    const snapshot = await deps.convex.getSnapshot();
    await deps.convex.postBulletin({
      clanId: n,
      slot: typeof snapshot.tick === 'number' ? snapshot.tick : 0,
      body,
    });
    return 'bulletin posted\n';
  }

  if (ns === 'ack-clear') {
    const n = getElderN(env);
    const file = ackFile(n, homeBase);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeRestrictedFileSync(file, new Date().toISOString() + '\n', {
      encoding: 'utf8',
    });
    return 'ack cleared\n';
  }

  if (ns === 'rules') {
    return RULES_TEXT;
  }

  throw new UsageError(
    'usage:\n' +
      '  elder world snapshot\n' +
      '  elder clan view <clanId>\n' +
      '  elder clan submit-orders <ordersJsonFile>\n' +
      '  elder memory recall <topic>\n' +
      '  elder memory save <key> <value>\n' +
      '  elder peer whisper <clanId> <msg>\n' +
      '  elder peer inbox\n' +
      '  elder bulletin post <msg>\n' +
      '  elder ack-clear\n' +
      '  elder rules\n' +
      '\nFor full help: elder --help\n',
  );
}

async function readPackageVersion(): Promise<string> {
  // package.json sits two levels up from src/cli.ts
  try {
    const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);

  // Pre-parse --help / -h BEFORE positional consumption (this is the bug
  // elder-1 hit: `elder clan submit-orders --help` tried to read --help as a
  // file path).
  const help = resolveHelp(args);
  if (help !== undefined) {
    process.stdout.write(help);
    return;
  }

  if (args.some(isVersionFlag)) {
    const v = await readPackageVersion();
    process.stdout.write(`elder ${v}\n`);
    return;
  }

  const [ns, cmd, ...rest] = args;
  const deps: Deps = {
    convex: createConvexClient(),
    chain: createChainClient(),
  };
  try {
    const out = await runCommand(ns, cmd, rest, deps);
    process.stdout.write(out);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    throw err;
  }
}

// Only run when executed directly (not when imported by tests or other modules)
const isMain = process.argv[1] !== undefined &&
  (process.argv[1].endsWith('/cli.ts') || process.argv[1].endsWith('/elder') || process.argv[1].endsWith('/cli.js'));

if (isMain) {
  main(process.argv).catch(err => {
    process.stderr.write(`elder: fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
