/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as agentLogs from "../agentLogs.js";
import type * as authShared from "../authShared.js";
import type * as bulletins from "../bulletins.js";
import type * as clansmen from "../clansmen.js";
import type * as comms from "../comms.js";
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as getSnapshot from "../getSnapshot.js";
import type * as gold from "../gold.js";
import type * as goldQuote from "../goldQuote.js";
import type * as heartbeat from "../heartbeat.js";
import type * as http from "../http.js";
import type * as indexer from "../indexer.js";
import type * as inft from "../inft.js";
import type * as kickstart from "../kickstart.js";
import type * as memory from "../memory.js";
import type * as mock from "../mock.js";
import type * as ops from "../ops.js";
import type * as resetLock from "../resetLock.js";
import type * as retention from "../retention.js";
import type * as vault from "../vault.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  agentLogs: typeof agentLogs;
  authShared: typeof authShared;
  bulletins: typeof bulletins;
  clansmen: typeof clansmen;
  comms: typeof comms;
  crons: typeof crons;
  events: typeof events;
  getSnapshot: typeof getSnapshot;
  gold: typeof gold;
  goldQuote: typeof goldQuote;
  heartbeat: typeof heartbeat;
  http: typeof http;
  indexer: typeof indexer;
  inft: typeof inft;
  kickstart: typeof kickstart;
  memory: typeof memory;
  mock: typeof mock;
  ops: typeof ops;
  resetLock: typeof resetLock;
  retention: typeof retention;
  vault: typeof vault;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
