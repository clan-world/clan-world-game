#!/usr/bin/env node
import readline from 'node:readline';
import type { ClanOrder } from '@clan-world/shared';
import {
  createChainClient,
  createConvexClient,
  type IChainClient,
  type IConvexClient,
  validateSubmitOrderPayload,
} from '@clan-world/shared/adapters';
import { getElderN, memoryFile, inboxFile, ackFile, UsageError, runCommand } from './cli.js';
import { createWalrusKvStore, type WalrusKvStore } from './walrusKvStore.js';
import fs from 'node:fs/promises';
import path from 'node:path';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type ToolContent = { type: 'text'; text: string };
type ToolResult = { content: ToolContent[]; isError?: boolean };

export type ElderToolDeps = {
  convex: IConvexClient;
  chain: IChainClient;
  env?: Record<string, string | undefined>;
  homeBase?: string;
  /**
   * Walrus KV store (MemWal). Optional + lazily created per Elder. When absent
   * (or when its credentials/relayer are unavailable) the MCP transparently
   * falls back to the local file store — a tick is never blocked by Walrus.
   */
  walrusKv?: WalrusKvStore;
};

/**
 * Resolve (and memoise on `deps`) the Walrus KV store for this Elder. Returns
 * `undefined` if `ELDER_N` is not resolvable — callers then use the file path.
 */
function resolveWalrusKv(deps: ElderToolDeps, env: Record<string, string | undefined>): WalrusKvStore | undefined {
  if (deps.walrusKv) return deps.walrusKv;
  let elder: number;
  try {
    elder = getElderN(env);
  } catch {
    return undefined;
  }
  deps.walrusKv = createWalrusKvStore(elder);
  return deps.walrusKv;
}

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
const jsonText = (value: unknown): ToolResult => text(JSON.stringify(value, null, 2));
const errorText = (value: string): ToolResult => ({ isError: true, content: [{ type: 'text', text: value }] });
const RESTRICTED_FILE_MODE = 0o600;

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requireBody(args: Record<string, unknown>, key = 'body'): string {
  const value = stringArg(args, key)?.trim();
  if (!value) throw new UsageError(`${key} is required`);
  return value;
}

function ownClanId(env: Record<string, string | undefined>): string {
  return String(getElderN(env));
}

function assertOwnClanId(clanId: string | undefined, env: Record<string, string | undefined>): string {
  const own = ownClanId(env);
  const resolved = clanId ?? own;
  if (resolved !== own) throw new UsageError(`cross-clan access denied: expected clanId ${own}`);
  return resolved;
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'ENOENT';
}

async function readMemoryAsync(n: number, base?: string): Promise<Record<string, string>> {
  const file = memoryFile(n, base);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, string>;
  } catch (err) {
    if (isEnoent(err)) return {};
    if (err instanceof SyntaxError) throw new UsageError(`elder: failed to parse memory file '${file}': ${err.message}`);
    throw err;
  }
}

async function writeRestrictedFileAtomic(file: string, data: string): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(tmp, data, { encoding: 'utf8', mode: RESTRICTED_FILE_MODE });
    await fs.chmod(tmp, RESTRICTED_FILE_MODE);
    await fs.rename(tmp, file);
    await fs.chmod(file, RESTRICTED_FILE_MODE);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function writeMemoryAsync(n: number, data: Record<string, string>, base?: string): Promise<void> {
  await writeRestrictedFileAtomic(memoryFile(n, base), JSON.stringify(data, null, 2) + '\n');
}

export async function callElderTool(name: string, args: unknown, deps: ElderToolDeps): Promise<ToolResult> {
  const env = deps.env ?? process.env;
  const parsed = asRecord(args);

  if (name === 'world_snapshot') {
    return jsonText(await deps.convex.getSnapshot());
  }

  if (name === 'clan_view') {
    const clanId = assertOwnClanId(stringArg(parsed, 'clanId'), env);
    return jsonText(await deps.chain.getClanFullView(clanId));
  }

  if (name === 'submit_orders') {
    const clanId = assertOwnClanId(stringArg(parsed, 'clanId'), env);
    const orders = parsed.orders;
    if (!Array.isArray(orders)) throw new UsageError('orders array is required');
    const submitterClanId = Number(clanId);
    if (!Number.isInteger(submitterClanId)) throw new UsageError('clanId must be numeric');
    const clanOrders = orders as ClanOrder[];
    for (const order of clanOrders) validateSubmitOrderPayload(order, submitterClanId);
    return jsonText(await deps.chain.submitOrders(clanId, clanOrders));
  }

  if (name === 'post_bulletin') {
    const clanId = Number(assertOwnClanId(stringArg(parsed, 'clanId'), env));
    const slot = numberArg(parsed, 'slot') ?? (await deps.convex.getSnapshot()).tick ?? 0;
    const body = requireBody(parsed);
    await deps.convex.postBulletin({ clanId, slot, body });
    return text('bulletin posted');
  }

  if (name === 'memory_recall') {
    const key = requireBody(parsed, 'key');
    // Read prefers Walrus (durable, cross-host), falls back to the local file.
    const walrusKv = resolveWalrusKv(deps, env);
    if (walrusKv) {
      const fromWalrus = await walrusKv.recall(key).catch(() => undefined);
      if (fromWalrus !== undefined) return text(fromWalrus);
    }
    const mem = await readMemoryAsync(getElderN(env), deps.homeBase);
    return text(mem[key] ?? `no memory for ${key}`);
  }

  if (name === 'memory_save') {
    const key = requireBody(parsed, 'key');
    const value = requireBody(parsed, 'value');
    const elder = getElderN(env);
    // File first (fast, always-available cache/fallback)…
    const mem = await readMemoryAsync(elder, deps.homeBase);
    mem[key] = value;
    await writeMemoryAsync(elder, mem, deps.homeBase);
    // …then Walrus (best-effort, durable). Never let a Walrus/relayer outage
    // fail the tool call — the file write above already succeeded.
    const walrusKv = resolveWalrusKv(deps, env);
    if (walrusKv) {
      const saved = await walrusKv.save(key, value).catch(() => ({ ok: false as const }));
      if (saved.ok) {
        // Mirror to Convex so the cockpit's memoryEntries shows source:"walrus".
        // Best-effort: IConvexClient swallows + warns when INDEXER_SECRET is
        // unset (no indexer secret reaches the MCP today — see PR notes).
        // Optional-chain guards older IConvexClient impls without this method.
        try {
          await deps.convex.mirrorMemoryEntry?.({ clanId: elder, key, value, source: 'walrus' });
        } catch {
          // non-fatal: cockpit mirror is decoupled from the durable Walrus save
        }
      }
    }
    return text(`saved ${key}`);
  }

  if (name === 'peer_inbox') {
    const file = inboxFile(getElderN(env), deps.homeBase);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      if (isEnoent(err)) return text('inbox empty');
      throw err;
    }
    const lines = raw.split('\n').filter(Boolean);
    return text(lines.length === 0 ? 'inbox empty' : lines.join('\n'));
  }

  if (name === 'peer_whisper') {
    const toClanId = requireBody(parsed, 'toClanId');
    const body = requireBody(parsed);
    return text((await runCommand('peer', 'whisper', [toClanId, body], deps, env, deps.homeBase)).trim());
  }

  if (name === 'ack_clear') {
    const elder = getElderN(env);
    const file = ackFile(elder, deps.homeBase);
    await writeRestrictedFileAtomic(file, new Date().toISOString() + '\n');
    return text('ack cleared');
  }

  if (name === 'rules') {
    return text(await runCommand('rules', undefined, [], deps, env, deps.homeBase));
  }

  throw new UsageError(`unknown elder MCP tool: ${name}`);
}

const tools = [
  {
    name: 'world_snapshot',
    description: 'Read full ClanWorld state; call this first each tick. Returns JSON with tick, tickEpoch, regions[], and clans[]. Find your clan in clans[]; each clansman has state (0=WAITING/idle, 1=TRAVELING, 2=ACTING, 3=DEAD; only submit orders for idle clansmen), currentRegion, and activeMission.settlesAtTick. Also shows vault resources, wall/base/monument levels, winter status, and active bandit data. Prefer this over clan_view for clansman state, missions, region ownership, and vault planning.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'clan_view',
    description: 'Read a sparse single-clan view for THIS elder. clanId defaults to your own ELDER_N and cannot target another clan; cross-clan access is denied. This is mostly treasury/pending-order detail. For clansman states, currentRegion, activeMission, vault resources, regions, and missions, use world_snapshot instead.',
    inputSchema: {
      type: 'object',
      properties: {
        clanId: { type: 'string', description: 'Optional. Defaults to your own ELDER_N. Passing another clan id is rejected.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'submit_orders',
    description: 'The ONLY way to act in the world. Submit one mission per IDLE clansman. Each order item MUST be { "kind": "mission", "payload": { "clansmanId", "gotoRegion", "action", ... } }; other kind values are silently dropped. ONE order per clansman per tick: a duplicate clansmanId silently overwrites the prior mission. Each new order replaces that clansman\'s current mission, so do not re-task a clansman mid-gather unless you intend to lose partial progress. clanId defaults to your own ELDER_N and cannot target another clan. gotoRegion: 0 is REGION_NOOP/stay put, NOT home; deposits/upgrades/withdraws at 0 silently no-op, so use your real baseRegion from world_snapshot. Gather actions do NOT auto-deposit; send explicit action 6 DepositResources at baseRegion. WEI WARNING: marketAmount, maxGoldIn, and withdrawResources values are raw 1e18-scaled on-chain integers as strings; "sell 8 fish" is "8000000000000000000", not "8". ActionType (0=None is NOT a usable order action — to hold position use 13=Wait): 1=ChopWood,2=MineIron,3=FishDocks,4=FishDeepSea,5=HarvestWheat,6=DepositResources,7=UpgradeWall,8=UpgradeBase,9=UpgradeMonument,10=DefendBase,11=MarketBuy,12=MarketSell,13=Wait,14=WithdrawResources. Regions: 1=Forest,2=Mountains,3=Unicorn Town,4=West Farms,5=East Farms,6=West Docks,7=East Docks,8=Deep Sea. Returns per-order StatusCode values: OK, ERR_CLAN_DEAD, ERR_CLAN_NOT_OWNED, ERR_CLANSMAN_DEAD, ERR_INVALID_CLANSMAN, ERR_INVALID_REGION, ERR_INVALID_ACTION, ERR_INVALID_TARGET, ERR_COOLDOWN_ACTIVE, ERR_NOT_WAITING, ERR_NOT_IN_UNICORN_TOWN, ERR_NOT_AT_HOMEBASE, ERR_NOT_AT_TARGET_BASE, ERR_NOT_DEFENDABLE, ERR_MISSING_RESOURCES, ERR_EMPTY_CARGO, ERR_PLOT_NOT_READY, ERR_PLOT_EMPTY, ERR_MARKET_ZERO_AMOUNT, ERR_MARKET_UNSUPPORTED_TOKEN, ERR_IMMEDIATE_MARKET_NOT_ELIGIBLE, ERR_MARKET_BUY_OVER_CAPACITY, ERR_MAX_GOLD_IN_EXCEEDED, ERR_WORLD_TICK_MISMATCH, ERR_NO_ACTIVE_BANDIT, ERR_SEASON_ENDED, ERR_NOT_ENOUGH_GOLD, ERR_CARRY_FULL, ERR_WINTER_LOCKED, ERR_MUST_SETTLE_FIRST, ERR_LIQUIDITY_INSUFFICIENT, ERR_SLIPPAGE_REQUIRED. Example orders: [{ "kind": "mission", "payload": { "clansmanId": 1, "gotoRegion": 1, "action": 1 } }, { "kind": "mission", "payload": { "clansmanId": 2, "gotoRegion": 6, "action": 6 } }, { "kind": "mission", "payload": { "clansmanId": 3, "gotoRegion": 1, "action": 6 } }] (deposit at your baseRegion). For a MarketSell, use action 12 with a SUPPORTED marketToken from world_snapshot market data (NEVER the zero address) plus marketAmount in wei. Call rules for the full reference.',
    inputSchema: {
      type: 'object',
      properties: {
        clanId: { type: 'string', description: 'Optional. Defaults to your own ELDER_N. Passing another clan id is rejected.' },
        orders: {
          type: 'array',
          description: 'One mission per idle clansman. Max one order per clansmanId per tick; duplicates overwrite earlier missions.',
          items: {
            type: 'object',
            required: ['kind', 'payload'],
            properties: {
              kind: {
                type: 'string',
                enum: ['mission'],
                description: 'MUST be "mission". Other kinds are silently dropped.',
              },
              payload: {
                type: 'object',
                required: ['clansmanId', 'gotoRegion', 'action'],
                properties: {
                  clansmanId: { type: 'number', description: 'Your clansman id, usually 1..4. Submit only for state 0=WAITING/idle clansmen.' },
                  gotoRegion: {
                    type: 'number',
                    enum: [0, 1, 2, 3, 4, 5, 6, 7, 8],
                    description: 'Destination. 0=REGION_NOOP/stay put, NOT home; deposits at 0 silently no-op. 1=Forest, 2=Mountains, 3=Unicorn Town, 4=West Farms, 5=East Farms, 6=West Docks, 7=East Docks, 8=Deep Sea. For DepositResources, UpgradeWall, UpgradeBase, UpgradeMonument, and WithdrawResources use your real baseRegion from world_snapshot. For DefendBase, travel to the base region of the clan you defend — your own baseRegion to defend self, or the ally clan\'s base region together with targetClanId to defend an ally.',
                  },
                  action: {
                    type: 'number',
                    enum: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
                    description: '0=None (NOT usable in an order — to hold position use 13=Wait), 1=ChopWood, 2=MineIron, 3=FishDocks, 4=FishDeepSea, 5=HarvestWheat, 6=DepositResources (gotoRegion must be baseRegion; gather does NOT auto-deposit), 7=UpgradeWall, 8=UpgradeBase, 9=UpgradeMonument, 10=DefendBase, 11=MarketBuy, 12=MarketSell, 13=Wait, 14=WithdrawResources.',
                  },
                  targetClanId: { type: 'number', description: 'DefendBase only. 0=defend self, or 1..12 to defend an ally.' },
                  marketToken: { type: 'string', description: 'MarketBuy/MarketSell only. A SUPPORTED 0x 20-byte resource-token address from world_snapshot market data. The zero address is rejected (ERR_MARKET_UNSUPPORTED_TOKEN).' },
                  marketAmount: { type: 'string', description: 'WEI (1e18-scaled) bigint string. MarketSell exact amount-in; MarketBuy exact amount-out. Example: 8 fish = "8000000000000000000", NOT "8".' },
                  maxGoldIn: { type: 'string', description: 'MarketBuy only. WEI (1e18-scaled) bigint string gold cap. Must be greater than 0; example 5 gold = "5000000000000000000".' },
                  withdrawResources: {
                    type: 'object',
                    description: 'WithdrawResources only. Per-resource WEI (1e18-scaled) bigint strings; example { "wood": "1000000000000000000", "iron": "0", "wheat": "0", "fish": "0" }.',
                    properties: {
                      wood: { type: 'string', description: 'Wood amount in raw WEI (1e18-scaled) bigint string.' },
                      iron: { type: 'string', description: 'Iron amount in raw WEI (1e18-scaled) bigint string.' },
                      wheat: { type: 'string', description: 'Wheat amount in raw WEI (1e18-scaled) bigint string.' },
                      fish: { type: 'string', description: 'Fish amount in raw WEI (1e18-scaled) bigint string.' },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
          },
        },
      },
      required: ['orders'],
      additionalProperties: false,
    },
  },
  {
    name: 'post_bulletin',
    description: 'Post a public bulletin visible to ALL clans on the Unicorn Town board. You do NOT need to be in Unicorn Town. clanId defaults to your own ELDER_N; slot defaults to the current tick.',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Public message text visible to all clans.' },
        clanId: { type: 'string', description: 'Optional. Defaults to your own ELDER_N. Passing another clan id is rejected.' },
        slot: { type: 'number', description: 'Optional board slot/tick. Defaults to current world_snapshot tick.' },
      },
      required: ['body'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_recall',
    description: 'Read a saved strategy note after a context wipe. Returns the saved value, or "no memory for <key>" if unset. Convention key: active-strategy.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Memory key to read, commonly active-strategy.' } },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_save',
    description: 'Persist a strategy note across the 50-tick context wipe. Save durable strategy before ack_clear. Convention key: active-strategy.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key to write, commonly active-strategy.' },
        value: { type: 'string', description: 'Durable note/plan to recall after a wipe.' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'peer_inbox',
    description: 'Read this Elder peer inbox. Returns "inbox empty" or newline-separated private whisper lines. Side-channel only; inbox messages have no on-chain effect.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'peer_whisper',
    description: 'Send a private 1-to-1 whisper to another clan. Send several whispers to reach several peers. toClanId is usually 1..12. This is a side-channel only; OTC deals are pure trust and have no on-chain effect.',
    inputSchema: {
      type: 'object',
      properties: {
        toClanId: { type: 'string', description: 'Recipient clan id, usually 1..12.' },
        body: { type: 'string', description: 'Private message body.' },
      },
      required: ['toClanId', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'ack_clear',
    description: 'Signal the runner that this Elder is done for now; your context WILL be wiped next. Save durable strategy with memory_save first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rules',
    description: 'Read the full game rules reference: action codes, region codes, constants, resource/carry notes, timing, order examples, and error codes. Use this when unsure how to form submit_orders payloads.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function writeResponse(id: JsonRpcRequest['id'], result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function writeError(id: JsonRpcRequest['id'], code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

export async function handleRequest(request: JsonRpcRequest, deps: ElderToolDeps): Promise<void> {
  const id = request.id ?? null;
  if (request.method === 'initialize') {
    writeResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'elder', version: '0.1.0' },
    });
    return;
  }

  if (request.method === 'notifications/initialized') return;

  if (request.method === 'tools/list') {
    writeResponse(id, { tools });
    return;
  }

  if (request.method === 'tools/call') {
    const params = asRecord(request.params);
    const name = stringArg(params, 'name');
    if (!name) {
      writeResponse(id, errorText('tools/call requires name'));
      return;
    }
    try {
      writeResponse(id, await callElderTool(name, params.arguments, deps));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeResponse(id, errorText(message));
    }
    return;
  }

  writeError(id, -32601, `method not found: ${request.method ?? ''}`);
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const deps = { convex: createConvexClient(), chain: createChainClient() };
  for await (const line of rl) {
    if (!line.trim()) continue;
    let request: JsonRpcRequest | undefined;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
      await handleRequest(request, deps);
    } catch (err) {
      const id = request?.id ?? null;
      const message = err instanceof Error ? err.message : String(err);
      writeError(id, -32000, message);
    }
  }
}

const argv1 = process.argv[1] ?? '';
if (argv1.endsWith('/mcp.ts') || argv1.endsWith('/mcp.js') || argv1.endsWith('/elder-mcp')) {
  main().catch(err => {
    process.stderr.write(`elder-mcp: fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
