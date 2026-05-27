import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  WaitForTransactionReceiptTimeoutError,
  type Account,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, CLAN_WORLD_ABI } from '@clan-world/shared/adapters';
import {
  HeartbeatRateLimitedError,
  type IHeartbeatCaller,
} from '@clan-world/agents/seams';
import { writeHeartbeatSuccessFile } from './heartbeatSuccessFile';

export interface RunnerHeartbeatConfig {
  /** Hex-encoded 64-char private key, optionally 0x-prefixed. */
  privateKey: string;
  /** Override RPC URL; defaults to the Base Sepolia public endpoint. */
  rpcUrl?: string;
  /** ClanWorld contract address. */
  contractAddress: `0x${string}`;
  /** Wait time for heartbeat receipt confirmation. */
  receiptTimeoutMs?: number;
  /** Convex deployment base URL for best-effort heartbeat webhook pings. */
  convexWebhookUrl?: string;
  /** Shared webhook auth secret. */
  webhookSharedSecret?: string;
}

/**
 * Reads `RUNNER_PRIVATE_KEY`, `RPC_URL_PRIMARY`, `CLAN_WORLD_CONTRACT_ADDRESS`
 * from env. Throws if `RUNNER_PRIVATE_KEY` is missing — the runner intentionally
 * does not generate or store its own wallet; provisioning is operator-side.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): RunnerHeartbeatConfig {
  const pk = env['RUNNER_PRIVATE_KEY'];
  if (!pk) {
    throw new Error(
      'RUNNER_PRIVATE_KEY is not set — the runner needs a dedicated wallet (NEVER reuse an Elder wallet). ' +
        'Provision a fresh key, fund it with testnet ETH, and export RUNNER_PRIVATE_KEY before starting the daemon.',
    );
  }
  const contractAddress = env['CLAN_WORLD_CONTRACT_ADDRESS'];
  if (!contractAddress || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error(
      `CLAN_WORLD_CONTRACT_ADDRESS missing or invalid; expected 0x-prefixed 40-hex-char address, got ${String(contractAddress)}`,
    );
  }
  const hasExplicitWebhookUrl = Object.prototype.hasOwnProperty.call(env, 'CONVEX_WEBHOOK_URL');
  let convexWebhookUrl: string | undefined;
  if (hasExplicitWebhookUrl) {
    convexWebhookUrl = env['CONVEX_WEBHOOK_URL'] || undefined;
    if (env['CONVEX_WEBHOOK_URL'] === '') {
      console.info('CONVEX_WEBHOOK_URL is empty; heartbeat webhook disabled');
    }
  } else {
    convexWebhookUrl = deriveConvexWebhookUrl(env['CONVEX_DEPLOY_URL']);
    if (convexWebhookUrl) {
      console.warn(
        'Deriving CONVEX_WEBHOOK_URL from CONVEX_DEPLOY_URL — set CONVEX_WEBHOOK_URL explicitly in env',
      );
    } else if (env['CONVEX_DEPLOY_URL']) {
      console.warn(
        'CONVEX_DEPLOY_URL is non-standard; CONVEX_WEBHOOK_URL required for webhook ingest',
      );
    }
  }
  return {
    privateKey: pk,
    rpcUrl: env['RPC_URL_PRIMARY'] || env['RPC_URL_FALLBACK'],
    contractAddress: contractAddress as `0x${string}`,
    convexWebhookUrl,
    webhookSharedSecret: env['WEBHOOK_SHARED_SECRET'],
  };
}

/**
 * Viem-backed `IHeartbeatCaller`. Wallet account is the dedicated runner key.
 *
 * Rate-limit detection: ClanWorld.heartbeat() reverts when called before
 * `nextHeartbeatAtTs`. We don't have a typed custom error in the ABI, so on
 * any revert we re-read `getWorldState().nextHeartbeatAtTs` and, if it is
 * still in the future, throw `HeartbeatRateLimitedError(nextAllowedAt)`.
 * Other reverts surface as the original error.
 */
export class RunnerCastHeartbeat implements IHeartbeatCaller {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: Account;
  private readonly contractAddress: `0x${string}`;
  private readonly receiptTimeoutMs: number;
  private readonly convexWebhookUrl?: string;
  private readonly webhookSharedSecret?: string;

  constructor(cfg: RunnerHeartbeatConfig) {
    const pk = normalizePk(cfg.privateKey);
    this.account = privateKeyToAccount(pk);
    const transport = cfg.rpcUrl ? http(cfg.rpcUrl) : http();
    this.publicClient = createPublicClient({ chain: baseSepolia, transport });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: baseSepolia,
      transport,
    });
    this.contractAddress = cfg.contractAddress;
    this.receiptTimeoutMs = cfg.receiptTimeoutMs ?? 15_000;
    this.convexWebhookUrl = cfg.convexWebhookUrl;
    this.webhookSharedSecret = cfg.webhookSharedSecret;
  }

  async callHeartbeat(): Promise<{ txHash: string }> {
    try {
      const hash = await this.walletClient.writeContract({
        account: this.account,
        chain: baseSepolia,
        address: this.contractAddress,
        abi: CLAN_WORLD_ABI,
        functionName: 'heartbeat',
        args: [],
      });
      // Wait for confirmation per the seam contract ("not fire-and-forget").
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
        timeout: this.receiptTimeoutMs,
      });
      if (receipt.status !== 'success') {
        // Mined-but-reverted. Most common cause is the rate-limit window
        // hadn't elapsed yet (when simulation succeeded but execution didn't).
        // Re-read state to upgrade to HeartbeatRateLimitedError when applicable.
        const next = await this.readNextHeartbeatAtTs().catch(() => undefined);
        if (next !== undefined && next > Math.floor(Date.now() / 1000)) {
          throw new HeartbeatRateLimitedError(next);
        }
        throw new Error(`heartbeat tx ${hash} reverted on-chain`);
      }
      await this.postHeartbeatWebhook({
        txHash: hash,
        blockNumber: receipt.blockNumber,
      });
      writeHeartbeatSuccessFile();
      return { txHash: hash };
    } catch (err) {
      // Already a rate-limit error — rethrow immediately; no second RPC read.
      if (err instanceof HeartbeatRateLimitedError) throw err;
      if (err instanceof WaitForTransactionReceiptTimeoutError) {
        throw new HeartbeatTimeoutError(
          `heartbeat tx receipt timed out after ${this.receiptTimeoutMs}ms`,
        );
      }
      // Upgrade simulation-level contract reverts to HeartbeatRateLimitedError.
      // viem wraps the revert in ContractFunctionExecutionError (and similar
      // BaseError subclasses), so a bare `instanceof ContractFunctionRevertedError`
      // MISSES it and the rate-limit revert leaks out as a generic error — which
      // sends the scheduler down its retry-with-backoff path instead of cleanly
      // waiting for the window. Walk the cause chain to find the real revert.
      // Pre-flight / RPC errors (no contract revert) must surface unchanged.
      const revert = extractContractRevert(err);
      if (!revert) throw err;
      // The contract's rate-limit revert reason is the authoritative, clock-basis
      // independent signal; fall back to the nextHeartbeatAtTs timestamp check.
      const next = await this.readNextHeartbeatAtTs().catch(() => undefined);
      if (
        isRateLimitRevert(revert) ||
        (next !== undefined && next > Math.floor(Date.now() / 1000))
      ) {
        throw new HeartbeatRateLimitedError(next ?? 0);
      }
      throw err;
    }
  }

  async readHeartbeatIntervalSeconds(): Promise<number> {
    const interval = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: CLAN_WORLD_ABI,
      functionName: 'heartbeatIntervalSeconds',
      args: [],
    });
    return Number(interval);
  }

  async readNextHeartbeatAtTs(): Promise<number> {
    const state = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: CLAN_WORLD_ABI,
      functionName: 'getWorldState',
      args: [],
    });
    // viem decodes the named tuple into an object with the same field names.
    return Number((state as { nextHeartbeatAtTs: bigint }).nextHeartbeatAtTs);
  }

  private async postHeartbeatWebhook(args: {
    txHash: `0x${string}`;
    blockNumber?: bigint | number | null;
  }): Promise<void> {
    if (!this.convexWebhookUrl) return;
    try {
      const webhookUrl = new URL('/api/heartbeat-webhook', this.convexWebhookUrl);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
        headers: {
          'content-type': 'application/json',
          ...(this.webhookSharedSecret
            ? { Authorization: `Bearer ${this.webhookSharedSecret}` }
            : {}),
        },
        body: JSON.stringify({
          chain: baseSepolia.name,
          engineAddress: this.contractAddress,
          txHash: args.txHash,
          blockNumber: args.blockNumber === undefined || args.blockNumber === null
            ? undefined
            : Number(args.blockNumber),
          firedAtTs: Math.floor(Date.now() / 1000),
          source: 'ts-runner',
        }),
      });
      if (!response.ok) {
        console.warn(
          `[RunnerCastHeartbeat] heartbeat webhook POST failed: ${response.status} ${response.statusText}`,
        );
      }
    } catch (err) {
      console.warn('[RunnerCastHeartbeat] heartbeat webhook POST failed:', err);
    }
  }
}

export class HeartbeatTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeartbeatTimeoutError';
  }
}

/** ClanWorld.heartbeat() rate-limit revert reason (see IClanWorld.sol). */
const RATE_LIMIT_REVERT_REASON = 'heartbeat rate limited';

/**
 * viem wraps contract reverts in ContractFunctionExecutionError (a BaseError
 * subclass), so a bare `instanceof ContractFunctionRevertedError` misses them.
 * Walk the error cause chain to find the underlying revert, returning it (or
 * undefined for non-contract errors like RPC/network failures).
 */
function extractContractRevert(err: unknown): ContractFunctionRevertedError | undefined {
  if (err instanceof ContractFunctionRevertedError) return err;
  if (err instanceof BaseError) {
    const walked = err.walk(e => e instanceof ContractFunctionRevertedError);
    if (walked instanceof ContractFunctionRevertedError) return walked;
  }
  return undefined;
}

/**
 * True when the revert is the contract's rate-limit guard (basis-independent).
 * Scans reason + shortMessage + message rather than `??`-picking one field,
 * because viem may populate a generic shortMessage while the decoded reason
 * carries the actual `ClanWorld: heartbeat rate limited` string.
 */
function isRateLimitRevert(revert: ContractFunctionRevertedError): boolean {
  const haystack = [revert.reason, revert.shortMessage, revert.message]
    .filter((s): s is string => typeof s === 'string')
    .join(' ')
    .toLowerCase();
  return haystack.includes(RATE_LIMIT_REVERT_REASON);
}

function normalizePk(pk: string): `0x${string}` {
  const trimmed = pk.trim();
  const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error(
      'RUNNER_PRIVATE_KEY is not a valid 64-hex-char private key (0x-prefixed optional)',
    );
  }
  return withPrefix as `0x${string}`;
}

function deriveConvexWebhookUrl(convexDeployUrl?: string): string | undefined {
  if (!convexDeployUrl) return undefined;
  // Hostname-suffix check (not substring) so URLs like
  // `https://attacker.convex.cloud.evil.com` or `https://example.com/.convex.cloud/x`
  // don't false-positive into a rewritten webhook target. R5 super-swarm hardening.
  let url: URL;
  try {
    url = new URL(convexDeployUrl);
  } catch {
    return undefined;
  }
  if (!url.hostname.endsWith('.convex.cloud')) return undefined;
  url.hostname = url.hostname.replace(/\.convex\.cloud$/, '.convex.site');
  // Preserve protocol/port; strip trailing slash if URL had no explicit path.
  return url.toString().replace(/\/$/, '');
}
