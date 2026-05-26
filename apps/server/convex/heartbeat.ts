// Heartbeat webhook entry point. When `CLANWORLD_USE_REAL_INDEXER=true`,
// fetches the tx receipt, validates the engine address, decodes engine logs
// via parseHeartbeatEngineEvents, ingests events, and schedules a snapshot
// refresh. When the flag is off, accepts the ping and returns OK so legacy
// callers don't error. Companion `advanceTick` synthetic mutation runs under
// `CLANWORLD_USE_FAKE_HEARTBEAT=true` for demo / dev mode.
import { httpAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { iClanWorldAbi } from "@clan-world/contract-types";
import { baseSepolia } from "@clan-world/shared/adapters/chains";
import {
  createPublicClient,
  http,
  parseEventLogs,
  WaitForTransactionReceiptTimeoutError,
  type Hex,
  type Log,
} from "viem";
import { deriveSeasonState } from "./getSnapshot";

const indexerApi = internal.indexer;

type HeartbeatWebhookPayload = {
  txHash?: unknown;
  blockNumber?: unknown;
  engineAddress?: unknown;
  firedAtTs?: unknown;
  chain?: unknown;
  source?: unknown;
};

const isHexHash = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

const numberFromPayload = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return undefined;
};

export const snapshotRefreshBlockFromReceipt = (receipt: ReceiptLike): number =>
  Number(receipt.blockNumber);

const bigintSafe = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(bigintSafe);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, bigintSafe(nested)]),
  );
};

type ReceiptLike = {
  status: "success" | "reverted";
  to?: string | null;
  logs: readonly Log[];
  blockNumber: bigint | number;
};

export function validateHeartbeatReceipt(
  receipt: ReceiptLike,
  expectedEngine: string,
  payloadEngine?: unknown,
):
  | { ok: true; engineLogs: readonly Log[] }
  | { ok: false; status: number; body: string } {
  if (receipt.status !== "success") {
    console.warn("[heartbeat] tx reverted, skipping");
    return { ok: false, status: 200, body: "tx reverted" };
  }

  const normalizedExpectedEngine = expectedEngine.toLowerCase();
  const receiptTo = receipt.to?.toLowerCase();
  if (receiptTo !== normalizedExpectedEngine) {
    console.warn(
      `[heartbeat] tx not to engine (${receiptTo} != ${normalizedExpectedEngine})`,
    );
    return { ok: false, status: 200, body: "not engine tx" };
  }

  if (
    typeof payloadEngine === "string" &&
    payloadEngine.toLowerCase() !== normalizedExpectedEngine
  ) {
    console.warn("[heartbeat] payload engineAddress mismatch");
    return { ok: false, status: 400, body: "engine mismatch" };
  }

  const engineLogs = receipt.logs.filter(
    (log) => log.address.toLowerCase() === normalizedExpectedEngine,
  );
  if (engineLogs.length === 0) {
    console.log("[heartbeat] tx has no engine logs, skipping");
    return { ok: false, status: 200, body: "no engine logs" };
  }

  return { ok: true, engineLogs };
}

export function parseHeartbeatEngineEvents(engineLogs: readonly Log[]) {
  return parseEventLogs({
    abi: iClanWorldAbi,
    logs: [...engineLogs],
    strict: false,
  }).map((event) => ({
    eventName: event.eventName,
    args: bigintSafe(event.args ?? {}),
    address: event.address,
    blockHash: event.blockHash,
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
  }));
}

export const heartbeatWebhook = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const secret = process.env.WEBHOOK_SHARED_SECRET;
  const auth = request.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = (await request.json()) as HeartbeatWebhookPayload;
  const txData = {
    txHash: payload.txHash,
    blockNumber: payload.blockNumber,
    engineAddress: payload.engineAddress,
    chain: payload.chain,
    source: payload.source,
  };

  console.log("heartbeat webhook tx ping", txData);

  if (process.env.CLANWORLD_USE_REAL_INDEXER === "true") {
    if (!isHexHash(payload.txHash)) {
      return new Response(JSON.stringify({ error: "txHash is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const rpcUrl = process.env.RPC_URL_PRIMARY;
    if (!rpcUrl) {
      return new Response(
        JSON.stringify({ error: "RPC_URL_PRIMARY is required" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    });
    const receipt = await publicClient
      .waitForTransactionReceipt({ hash: payload.txHash, timeout: 15_000 })
      .catch((error: unknown) => {
        if (error instanceof WaitForTransactionReceiptTimeoutError) {
          return undefined;
        }
        throw error;
      });
    if (!receipt) {
      return new Response(
        JSON.stringify({
          error: "Timed out waiting for transaction receipt",
          txHash: payload.txHash,
          timeoutMs: 15_000,
        }),
        {
          status: 408,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const expectedEngine = process.env.CLAN_WORLD_CONTRACT_ADDRESS;
    if (!expectedEngine) {
      return new Response(
        JSON.stringify({ error: "CLAN_WORLD_CONTRACT_ADDRESS is required" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const validation = validateHeartbeatReceipt(
      receipt,
      expectedEngine,
      payload.engineAddress,
    );
    if (!validation.ok) {
      return new Response(validation.body, { status: validation.status });
    }

    const parsed = parseHeartbeatEngineEvents(validation.engineLogs);
    // Receipt blockNumber is the chain fact; payload blockNumber is keeper metadata.
    const blockNumber = snapshotRefreshBlockFromReceipt(receipt);
    await ctx.runMutation(indexerApi.ingestEvents, {
      events: parsed,
      blockNumber,
      txHash: payload.txHash,
      firedAtTs: numberFromPayload(payload.firedAtTs),
      advanceCheckpoint: false,
    });
    await ctx.scheduler.runAfter(0, indexerApi.refreshSnapshot, {
      blockNumber,
    });

    return new Response(
      JSON.stringify({
        status: "ok",
        received: txData,
        decodedEvents: parsed.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(JSON.stringify({ status: "ok", received: txData }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

type AdvanceTickResult =
  | { status: "ok"; tick: number }
  | { status: "no-op"; reason: string };

export const advanceTick = internalMutation({
  handler: async (ctx): Promise<AdvanceTickResult> => {
    // Read tickClock first — authoritative cursor after worldSnapshot delta-check (#333).
    // worldSnapshot can freeze at tick N while tickClock advances to N+k.
    // tickClock is a single-row table, so .first() (no ordering) is sufficient.
    // Singleton table; .order("desc") defends against dup-row scenarios
    // (manual seed, demo-reset race, cold-start TOCTOU) where the read site
    // would otherwise see the OLDEST row while writers see the NEWEST. Standardize
    // across all 5 singleton .first() call sites per opus 4.7 R1 M1.
    const clockRow = await ctx.db.query("tickClock").order("desc").first();
    const snap = await ctx.db.query("worldSnapshot").order("desc").first();
    if (!snap) return { status: "no-op", reason: "no snapshot to refresh" };

    const baseTick = clockRow?.tick ?? snap.tick;
    const baseEpochStartedAt = clockRow?.tickEpochStartedAt ?? snap.tickEpochStartedAt;
    const baseEpochDurationMs = clockRow?.tickEpochDurationMs ?? snap.tickEpochDurationMs;
    const baseHeartbeatIntervalSeconds =
      clockRow?.heartbeatIntervalSeconds ??
      snap.heartbeatIntervalSeconds ??
      Math.max(1, Math.floor(baseEpochDurationMs / 1000));

    // Staleness gate: only advance if the current epoch has elapsed.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const epochEndSeconds = baseEpochStartedAt + Math.floor(baseEpochDurationMs / 1000);
    if (nowSeconds < epochEndSeconds) {
      return { status: "no-op", reason: "epoch not yet elapsed" };
    }

    const newTick = baseTick + 1;
    const newEpochStartedAt = Math.floor(Date.now() / 1000);
    // Monotonic guard around both writes. Note: given `baseTick = clockRow.tick`
    // when clockRow exists, `newTick > clockRow.tick` is tautologically true
    // and the guard is dead code with the current calculation. Kept for intent
    // and for the case where `!clockRow` (cold start). A future refactor that
    // computes baseTick differently (e.g. from snap.tick when clockRow is
    // stale-but-present) should re-evaluate. opus 4.7 R3 M1 + follow-up.
    if (!clockRow || newTick > clockRow.tick) {
      // Synthetic tick advance for fake-heartbeat / demo mode. Spread the
      // previous snapshot to preserve REGIONS + CLANS + SEASON state that
      // R1 originally dropped — gemini super-swarm HIGH. CLEAR per-tick /
      // per-block PROVENANCE (txHash, lastUpdatedAt, lastUpdatedBlock,
      // currentTickSeed) so cockpit UI doesn't attribute this synthetic
      // tick to a prior real-indexer commit. OVERRIDE nextHeartbeatAtTick
      // to newTick+1 (chain semantic is currentTick+1).
      // opus 4.7 R2 M2 + codex 5.3 R3 (seasonFinalized preserved).
      //
      // If we just crossed a season boundary in synthetic mode, recompute
      // season fields via `deriveSeasonState(newTick)` and reset
      // `seasonFinalized` to false (no chain `finalizeSeason()` ran).
      // Without this, currentSeasonNumber/seasonStartTick/seasonEndTick
      // freeze on the old season + seasonFinalized stays stale.
      // codex 5.3 R4 MED.
      const { _id: _prevId, _creationTime: _prevCreationTime, ...prevSnap } = snap;
      const crossedBoundary =
        typeof prevSnap.seasonEndTick === "number" &&
        newTick > prevSnap.seasonEndTick;
      const seasonOverrides = crossedBoundary
        ? {
            ...deriveSeasonState(newTick),
            seasonFinalized: false,
          }
        : {};
      await ctx.db.insert("worldSnapshot", {
        ...prevSnap,
        tick: newTick,
        tickEpochStartedAt: newEpochStartedAt,
        tickEpochDurationMs: baseEpochDurationMs,
        heartbeatIntervalSeconds: baseHeartbeatIntervalSeconds,
        nextHeartbeatAtTick: newTick + 1,
        ...seasonOverrides,
        // Clear per-block provenance so UI consumers don't attribute this
        // synthetic tick to a prior real-indexer commit.
        txHash: undefined,
        lastUpdatedAt: undefined,
        lastUpdatedBlock: undefined,
        currentTickSeed: undefined,
      });
      // agentLogs MUST stay inside the monotonic guard so audit trail does
      // not diverge from worldSnapshot/tickClock when the guard skips.
      // silent-failure-hunter R6 H-3.
      await ctx.db.insert("agentLogs", {
        level: "info",
        message: `heartbeat: tick ${baseTick} → ${newTick}`,
        timestamp: Date.now(),
      });
    }

    // Also keep tickClock in sync (same monotonic guard — reuses condition above).
    if (!clockRow || newTick > clockRow.tick) {
      if (clockRow) {
        await ctx.db.patch(clockRow._id, {
          tick: newTick,
          tickEpochStartedAt: newEpochStartedAt,
          tickEpochDurationMs: baseEpochDurationMs,
          heartbeatIntervalSeconds: baseHeartbeatIntervalSeconds,
        });
      } else {
        await ctx.db.insert("tickClock", {
          tick: newTick,
          tickEpochStartedAt: newEpochStartedAt,
          tickEpochDurationMs: baseEpochDurationMs,
          heartbeatIntervalSeconds: baseHeartbeatIntervalSeconds,
          seasonStartTick: 0,
          seasonEndTick: 0,
          winterActive: false,
        });
      }
    }

    return { status: "ok", tick: newTick };
  },
});
