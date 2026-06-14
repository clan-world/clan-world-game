/**
 * walrusKvStore — a key→value store emulated on top of the MemWal SDK
 * (Walrus Memory).
 *
 * MemWal is a semantic memory store, not a literal KV store: you `remember`
 * free text and `recall` by semantic query. We emulate exact-key KV on top of
 * it with a deterministic tagged-text encoding:
 *
 *     kv:<key> = <value>
 *
 * On `save` we `rememberAndWait` that line. On `recall(key)` we issue a
 * semantic `recall({ query: "kv:<key>" })`, then scan the returned results for
 * the FIRST one whose decoded text carries the exact `kv:<key>` tag and return
 * its value. Because semantic search can return near-miss neighbours, we never
 * trust the top hit blindly — we re-parse the tag and require an exact key
 * match before returning a value.
 *
 * Design constraints (the Elder MCP must never hard-fail a tick):
 *   - Credentials (`~/.memwal/credentials.json`) or the relayer being absent /
 *     unreachable degrades gracefully: `save` returns `{ ok: false }` and
 *     `recall` returns `undefined`. The caller keeps using the local file
 *     store as the source of truth.
 *   - The MemWal client is constructed lazily and memoised per process. A
 *     failed construction is cached as "disabled" so we do not re-read a
 *     missing/broken credential file on every tick.
 *   - All network calls are time-boxed so a hung relayer cannot stall a tick.
 *
 * One Elder == one credential file == one MemWal account/delegate identity.
 * The namespace further isolates this Elder's KV namespace under that account.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemWal } from '@mysten-incubation/memwal';

/** Shape of `~/.memwal/credentials.json` (only the fields we consume). */
export type MemWalCredentials = {
  delegatePrivateKey: string;
  accountId: string;
  relayerUrl: string;
  // packageId / registryId / label etc. are present in the file but are not
  // needed to construct a runtime MemWal client (they are provisioning-time
  // values), so we do not require them here.
  packageId?: string;
  namespace?: string;
};

export type WalrusSaveResult = {
  ok: boolean;
  /** Walrus blob id when the write succeeded; undefined on degrade/failure. */
  blobId?: string;
  /** Populated when degraded so the caller can log/observe (best-effort). */
  reason?: string;
};

/** Default credential path. HOME is /home/elder inside the elder container. */
function defaultCredentialsPath(home: string = os.homedir()): string {
  return path.join(home, '.memwal', 'credentials.json');
}

/**
 * Deterministic tag prefix for a key. Kept stable so a value written in one
 * process can be recalled in another.
 *
 * Keys MUST NOT contain newlines: the encoding is a single line, and a key
 * like `a\nb` would otherwise collide with the literal key `"a b"`. We reject
 * such keys (the caller catches and degrades to the file store) rather than
 * silently normalising them into a different key. KV keys in practice are
 * short identifiers like `active-strategy`.
 */
function kvTag(key: string): string {
  if (/[\r\n]/.test(key)) {
    throw new Error('walrus-kv: key must not contain newline characters');
  }
  return `kv:${key}`;
}

/**
 * Encode a key/value pair into a single tagged line. The value is
 * JSON-encoded so embedded newlines / control characters / `=` survive the
 * round-trip losslessly. A monotonic `v=<version>` field lets recall pick the
 * latest write among multiple stored entries for the same key (MemWal append
 * semantics mean an overwrite leaves the older entry in the index).
 */
function encodeKv(key: string, value: string, version: number): string {
  return `${kvTag(key)} v=${version} = ${JSON.stringify(value)}`;
}

/** Parsed KV memory line: the value plus its write version (0 if absent). */
export type ParsedKv = { value: string; version: number };

/**
 * Parse a value (and its version) back out of a tagged line, requiring an
 * EXACT key match. Returns `undefined` when the text is not a
 * `kv:<key> v=<n> = <json>` line for this exact key — guarding against
 * semantic near-miss neighbours returned by the relayer.
 *
 * The whole memory text is treated as ONE line: encode never emits a newline
 * (the value is JSON-encoded), so a stored KV memory is always single-line.
 */
export function parseKvValue(text: string, key: string): ParsedKv | undefined {
  const tag = kvTag(key);
  // ^kv:<key> v=<digits> = <json-rest>$  — anchored, exact key, rest is the
  // JSON-encoded value (may legitimately contain spaces, `=`, escaped \n).
  const prefix = `${tag} v=`;
  if (!text.startsWith(prefix)) return undefined;
  const afterPrefix = text.slice(prefix.length);
  const sep = afterPrefix.indexOf(' = ');
  if (sep < 0) return undefined;
  const versionStr = afterPrefix.slice(0, sep);
  if (!/^\d+$/.test(versionStr)) return undefined;
  const jsonValue = afterPrefix.slice(sep + 3);
  let value: unknown;
  try {
    value = JSON.parse(jsonValue);
  } catch {
    return undefined;
  }
  if (typeof value !== 'string') return undefined;
  return { value, version: Number(versionStr) };
}

export type WalrusKvStoreOptions = {
  /** Override credential path (tests). Defaults to ~/.memwal/credentials.json. */
  credentialsPath?: string;
  /**
   * Namespace isolating this Elder's KV under its MemWal account. Strongly
   * recommended to be per-Elder (e.g. `elder-3-kv`).
   */
  namespace: string;
  /** Per-call timeout for remember (ms). */
  rememberTimeoutMs?: number;
  /** Per-call timeout for recall (ms). */
  recallTimeoutMs?: number;
  /** recall() top-K. We scan results for an exact tag match. */
  recallLimit?: number;
  /** Timeout (ms) for lazy client construction (credential read + create). */
  initTimeoutMs?: number;
  /** Injectable MemWal factory for tests. */
  memwalFactory?: typeof MemWal.create;
};

// Kept well under typical agentic tool-call ceilings (~30-60s). The local file
// write in memory_save already succeeded by the time we await this, so a slow
// relayer just degrades that one save to file-only rather than stalling the
// Elder's tool call. The blob still lands in the local cache and the next save
// re-attempts Walrus.
const DEFAULT_REMEMBER_TIMEOUT_MS = 15_000;
const DEFAULT_RECALL_TIMEOUT_MS = 12_000;
const DEFAULT_INIT_TIMEOUT_MS = 8_000;
const DEFAULT_RECALL_LIMIT = 5;

/**
 * A lazily-initialised KV-over-MemWal store. Construct once per Elder process;
 * the underlying MemWal client + credentials are loaded on first use and then
 * memoised. All public methods are degrade-safe and never throw.
 */
export class WalrusKvStore {
  private readonly options: Required<Omit<WalrusKvStoreOptions, 'credentialsPath' | 'memwalFactory'>> &
    Pick<WalrusKvStoreOptions, 'credentialsPath' | 'memwalFactory'>;
  /**
   * Tri-state init cache:
   *   - undefined  → not yet attempted
   *   - null       → attempted and disabled (no creds / construction failed)
   *   - MemWal     → ready
   */
  private client: MemWal | null | undefined = undefined;
  private initPromise: Promise<MemWal | null> | undefined;
  /**
   * Monotonic write-version source. Each save() stamps the encoded line with a
   * strictly-increasing version so recall() can pick the latest among the
   * (append-only) MemWal entries for a key. Seeded from wall-clock ms so
   * versions stay ordered across process restarts; the in-process counter then
   * guarantees strict monotonicity even for sub-millisecond consecutive saves.
   */
  private versionCounter = Date.now();

  constructor(options: WalrusKvStoreOptions) {
    this.options = {
      namespace: options.namespace,
      rememberTimeoutMs: options.rememberTimeoutMs ?? DEFAULT_REMEMBER_TIMEOUT_MS,
      recallTimeoutMs: options.recallTimeoutMs ?? DEFAULT_RECALL_TIMEOUT_MS,
      recallLimit: options.recallLimit ?? DEFAULT_RECALL_LIMIT,
      initTimeoutMs: options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS,
      credentialsPath: options.credentialsPath,
      memwalFactory: options.memwalFactory,
    };
  }

  private nextVersion(): number {
    this.versionCounter = Math.max(this.versionCounter + 1, Date.now());
    return this.versionCounter;
  }

  /** True if a MemWal client could be constructed (creds present + valid). */
  async isAvailable(): Promise<boolean> {
    return (await this.ensureClient()) !== null;
  }

  /**
   * Save a key/value to Walrus. Best-effort: returns `{ ok: false, reason }`
   * if the store is unavailable or the write fails — never throws.
   */
  async save(key: string, value: string): Promise<WalrusSaveResult> {
    let encoded: string;
    try {
      // kvTag (via encodeKv) throws on newline-bearing keys — treat as a
      // degrade, not a crash, so the local file write (already done) stands.
      encoded = encodeKv(key, value, this.nextVersion());
    } catch (err) {
      return { ok: false, reason: errMessage(err) };
    }
    const client = await this.ensureClient();
    if (!client) return { ok: false, reason: 'walrus-kv unavailable' };
    try {
      // Outer backstop deadline is the SDK timeout + a margin so the SDK's own
      // timeout fires first in the normal case; the outer guard only trips if
      // the SDK call hangs past its own deadline.
      const remembered = await this.withTimeout(
        client.rememberAndWait(encoded, this.options.namespace, {
          timeoutMs: this.options.rememberTimeoutMs,
          pollIntervalMs: 2_000,
        }),
        this.options.rememberTimeoutMs + 5_000,
        'walrus-kv save',
      );
      return { ok: true, blobId: remembered.blob_id };
    } catch (err) {
      return { ok: false, reason: errMessage(err) };
    }
  }

  /**
   * Recall a value for an exact key. Returns `undefined` when unavailable, on
   * error, or when no stored memory carries the exact `kv:<key>` tag — never
   * throws.
   *
   * MemWal is append-only, so several entries may exist for the same key after
   * repeated saves. We scan ALL exact-tag matches and return the one with the
   * highest write version (latest write wins) rather than trusting the
   * similarity-ranked top hit, which would otherwise serve stale state.
   */
  async recall(key: string): Promise<string | undefined> {
    let query: string;
    try {
      query = kvTag(key);
    } catch {
      return undefined;
    }
    const client = await this.ensureClient();
    if (!client) return undefined;
    try {
      const result = await this.withTimeout(
        client.recall({ query, limit: this.options.recallLimit }),
        this.options.recallTimeoutMs,
        'walrus-kv recall',
      );
      let best: ParsedKv | undefined;
      for (const memory of result.results ?? []) {
        const parsed = parseKvValue(memory.text, key);
        if (parsed && (!best || parsed.version > best.version)) best = parsed;
      }
      return best?.value;
    } catch {
      return undefined;
    }
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async ensureClient(): Promise<MemWal | null> {
    if (this.client !== undefined) return this.client;
    if (!this.initPromise) {
      this.initPromise = this.buildClient()
        .then(client => {
          this.client = client;
          return client;
        })
        .catch(() => {
          this.client = null;
          return null;
        })
        .finally(() => {
          this.initPromise = undefined;
        });
    }
    return this.initPromise;
  }

  private async buildClient(): Promise<MemWal | null> {
    // Time-box construction (credential read + MemWal.create). A hung relayer
    // probe during create() must not stall the first memory tool call; on
    // timeout we degrade to the file store (returns null → disabled).
    return this.withTimeout(this.buildClientInner(), this.options.initTimeoutMs, 'walrus-kv init');
  }

  private async buildClientInner(): Promise<MemWal | null> {
    const creds = await this.loadCredentials();
    if (!creds) return null;
    const create = this.options.memwalFactory ?? MemWal.create;
    return create({
      key: creds.delegatePrivateKey,
      accountId: creds.accountId,
      serverUrl: creds.relayerUrl,
      namespace: this.options.namespace,
    });
  }

  private async loadCredentials(): Promise<MemWalCredentials | null> {
    const file = this.options.credentialsPath ?? defaultCredentialsPath();
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch {
      // Missing / unreadable credentials → degrade silently.
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isCredentials(parsed)) return null;
    return parsed;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function isCredentials(value: unknown): value is MemWalCredentials {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.delegatePrivateKey === 'string' &&
    v.delegatePrivateKey.length > 0 &&
    typeof v.accountId === 'string' &&
    v.accountId.length > 0 &&
    typeof v.relayerUrl === 'string' &&
    v.relayerUrl.length > 0
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Stable per-Elder KV namespace, e.g. elder 3 → `elder-3-kv`. */
export function elderKvNamespace(elderN: number): string {
  return `elder-${elderN}-kv`;
}

/**
 * Build a WalrusKvStore for an Elder. `credentialsPath` is optional (tests).
 * Construction is cheap; the client is lazy-initialised on first save/recall.
 */
export function createWalrusKvStore(elderN: number, opts?: Partial<WalrusKvStoreOptions>): WalrusKvStore {
  return new WalrusKvStore({
    namespace: opts?.namespace ?? elderKvNamespace(elderN),
    credentialsPath: opts?.credentialsPath,
    rememberTimeoutMs: opts?.rememberTimeoutMs,
    recallTimeoutMs: opts?.recallTimeoutMs,
    recallLimit: opts?.recallLimit,
    initTimeoutMs: opts?.initTimeoutMs,
    memwalFactory: opts?.memwalFactory,
  });
}
