import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function moduleFile(...parts) {
  const roots = (process.env.NODE_PATH ?? "").split(":").filter(Boolean);
  const root = roots.find((candidate) => existsSync(join(candidate, parts[0])));
  if (!root) {
    throw new Error(`Could not resolve ${parts.join("/")} from NODE_PATH`);
  }
  return pathToFileURL(join(root, ...parts)).href;
}

const { Ed25519Keypair } = await import(
  moduleFile("@mysten", "sui", "dist", "keypairs", "ed25519", "index.mjs")
);
const { Secp256k1Keypair } = await import(
  moduleFile("@mysten", "sui", "dist", "keypairs", "secp256k1", "index.mjs")
);
const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } = await import(
  moduleFile("@mysten", "sui", "dist", "jsonRpc", "index.mjs")
);
const { addDelegateKey, createAccount, generateDelegateKey } = await import(
  moduleFile("@mysten-incubation", "memwal", "dist", "account-entry.js")
);
const { delegateKeyToPublicKey, MemWal } = await import(
  moduleFile("@mysten-incubation", "memwal", "dist", "index.js")
);

const DEPLOYER =
  "0xa607735e95142e8540b17f055cbf55f48e24c99f847949b13989985ebcdf2b96";
const PACKAGE_ID =
  "0xcee7a6fd8de52ce645c38332bde23d4a30fd9426bc4681409733dd50958a24c6";
const REGISTRY_ID =
  "0x0da982cefa26864ae834a8a0504b904233d49e20fcc17c373c8bed99c75a7edd";
const RELAYER = "https://relayer.memory.walrus.xyz";

// --- Owner-source mode ----------------------------------------------------
// `ed25519`  (DEFAULT): each Elder owner is a fresh Ed25519 Sui key. This is the
//             behavior that provisioned the 4 live mainnet accounts — DO NOT change
//             its creds dir or the running Elders break.
// `base-key` (BONUS): each Elder owner is derived from its EXISTING secp256k1
//             Base/EVM private key (the "one identity across Base + Sui" story).
//             Creds land in a SEPARATE dir so the fresh-key accounts are untouched.
function parseOwnerSource() {
  const fromFlag = process.argv
    .find((arg) => arg.startsWith("--owner-source="))
    ?.split("=")[1];
  const raw = (fromFlag ?? process.env.WALRUS_OWNER_SOURCE ?? "ed25519").trim();
  if (raw !== "ed25519" && raw !== "base-key") {
    throw new Error(`Invalid --owner-source=${raw} (expected ed25519 | base-key)`);
  }
  return raw;
}
const OWNER_SOURCE = parseOwnerSource();
const DERIVE_ONLY =
  process.argv.includes("--derive-only") || process.env.WALRUS_DERIVE_ONLY === "1";

// Fresh-key creds (default mode) MUST keep this dir untouched — it holds the live
// mainnet accounts. base-key mode writes to a DISTINCT dir so it can never clobber them.
const SECRETS_ROOT =
  OWNER_SOURCE === "base-key"
    ? join(homedir(), ".secrets", "clanworld-elder-walrus-unified")
    : join(homedir(), ".secrets", "clanworld-elder-walrus");
// Source of the Elder secp256k1 Base/EVM keys (only read in base-key mode).
const ELDER_WALLETS_PATH =
  process.env.WALRUS_ELDER_WALLETS_PATH ??
  join(homedir(), ".secrets", "clanworld-elder-wallets.json");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FINDINGS_PATH =
  process.env.WALRUS_PROVISION_FINDINGS ??
  join(SCRIPT_DIR, "tmp", "FINDINGS-provisioning.md");
const MIN_BALANCE_MIST = 50_000_000n;
const FUND_AMOUNT_MIST = 100_000_000n;
// Hard cap: at most 4 Elders × FUND_AMOUNT_MIST per run.  Any rerun that would
// exceed this aborts early rather than silently double-spending.
const MAX_TOTAL_FUND_MIST = FUND_AMOUNT_MIST * 4n;
const PROBE_TEXT = "elder_1_isolation_probe | secret-ridge-cache";
const PROBE_QUERY = "elder_1_isolation_probe secret-ridge-cache";
// Throwaway namespace for the isolation probe — prevents the probe memory from
// being recalled by a live Elder 1 session running against the real "elder-1" namespace.
const PROBE_NAMESPACE = "__isolation_probe__";

class MemWalSuiClientCompat {
  constructor(inner) {
    this.inner = inner;
  }

  async signAndExecuteTransaction(input) {
    return this.inner.signAndExecuteTransaction(input);
  }

  async waitForTransaction(input) {
    // SuiJsonRpcClient.waitForTransaction spreads ...input into getTransactionBlock,
    // which passes input.options directly to the RPC — pass options through as-is.
    // (The prior include:{} mapping silently dropped showEffects/showObjectChanges.)
    return this.inner.waitForTransaction({ digest: input.digest, options: input.options });
  }
}

const rpc = new SuiJsonRpcClient({
  network: "mainnet",
  url: getJsonRpcFullnodeUrl("mainnet"),
});
const suiClient = new MemWalSuiClientCompat(rpc);

function logPublic(value) {
  console.log(JSON.stringify(value, null, 2));
}

function sui(mist) {
  return (Number(mist) / 1_000_000_000).toFixed(6);
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function hexToBytes(hex) {
  // Secp256k1Keypair.fromSecretKey REJECTS plain/0x hex strings (it only takes raw
  // Uint8Array(32) or Bech32 suiprivkey1...), so the Base key hex must be converted
  // to 32 raw bytes here first. See docs/walrus-memory-unified-key.md.
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`Expected a 32-byte (64 hex char) secp256k1 secret, got length ${clean.length}`);
  }
  return Uint8Array.from(Buffer.from(clean, "hex"));
}

function normalizeAddress(address) {
  return address.toLowerCase();
}

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function ensureSecretDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function writeSecretFile(path, contents, mode) {
  writeFileSync(path, contents, { mode });
  chmodSync(path, mode);
}

function loadOrCreateOwner(elderNumber) {
  const dir = join(SECRETS_ROOT, `elder-${elderNumber}`);
  const keyPath = join(dir, "owner.key");
  const credentialsPath = join(dir, "credentials.json");
  ensureSecretDir(dir);

  let ownerKey;
  let generated = false;
  if (existsSync(keyPath)) {
    ownerKey = readFileSync(keyPath, "utf8").trim();
  } else {
    ownerKey = Ed25519Keypair.generate().getSecretKey();
    writeSecretFile(keyPath, `${ownerKey}\n`, 0o600);
    generated = true;
  }
  chmodSync(keyPath, 0o600);

  const keypair = Ed25519Keypair.fromSecretKey(ownerKey);
  return {
    dir,
    keyPath,
    credentialsPath,
    ownerKey,
    ownerKeypair: keypair,
    ownerAddress: keypair.getPublicKey().toSuiAddress(),
    walletSigner: null, // ed25519 mode signs via suiPrivateKey, not a walletSigner
    generated,
  };
}

let elderWalletsCache = null;
function loadElderBaseKey(elderNumber) {
  if (!elderWalletsCache) {
    if (!existsSync(ELDER_WALLETS_PATH)) {
      throw new Error(`Elder Base wallets file not found: ${ELDER_WALLETS_PATH}`);
    }
    elderWalletsCache = JSON.parse(readFileSync(ELDER_WALLETS_PATH, "utf8"));
  }
  const elders = elderWalletsCache.elders ?? [];
  // Match strictly on the 1-based `index` field — these become PERMANENT on-chain
  // identities, so a positional/0-based fallback that silently returns the wrong
  // Elder's key is worse than a loud failure. If the file is ever 0-based, this
  // throws with a clear message rather than mis-owning an account.
  const entry = elders.find((e) => e.index === elderNumber);
  if (!entry?.privateKey) {
    throw new Error(
      `No Base private key with index=${elderNumber} in ${ELDER_WALLETS_PATH} ` +
        `(expected 1-based "elders[].index"; found indices: ${elders.map((e) => e.index).join(",")})`,
    );
  }
  return { privateKey: entry.privateKey, baseAddress: entry.address };
}

// Adapter that lets the MemWal account helpers sign with a non-Ed25519 keypair.
// MemWal's createAccount/addDelegateKey({ suiPrivateKey }) helper ALWAYS does
// Ed25519Keypair.fromSecretKey() under the hood — so a secp256k1 owner MUST go
// through walletSigner instead, or the account is created under the WRONG owner.
function makeWalletSigner(keypair) {
  const address = keypair.getPublicKey().toSuiAddress();
  return {
    address,
    // memwal calls this as signAndExecuteTransaction({ transaction }) and only reads .digest.
    // SuiJsonRpcClient handles build+sign+execute when given the keypair as `signer`.
    async signAndExecuteTransaction({ transaction }) {
      const result = await rpc.signAndExecuteTransaction({
        signer: keypair,
        transaction,
        options: { showEffects: true, showObjectChanges: true },
      });
      return { digest: result.digest };
    },
    async signPersonalMessage(message) {
      return keypair.signPersonalMessage(message);
    },
  };
}

// base-key mode: owner is the Elder's secp256k1 Base/EVM key. No owner.key is
// written (the Base key is the source of truth in clanworld-elder-wallets.json);
// only the Ed25519 delegate credentials are persisted in the unified creds dir.
function loadBaseKeyOwner(elderNumber) {
  const dir = join(SECRETS_ROOT, `elder-${elderNumber}`);
  const credentialsPath = join(dir, "credentials.json");
  ensureSecretDir(dir);

  const { privateKey, baseAddress } = loadElderBaseKey(elderNumber);
  const keypair = Secp256k1Keypair.fromSecretKey(hexToBytes(privateKey));
  const ownerAddress = keypair.getPublicKey().toSuiAddress();
  return {
    dir,
    keyPath: null, // Base key stays in clanworld-elder-wallets.json — never copied here
    credentialsPath,
    ownerKey: null, // signals walletSigner path (NOT suiPrivateKey)
    ownerKeypair: keypair,
    ownerAddress,
    baseAddress,
    walletSigner: makeWalletSigner(keypair),
    generated: false,
  };
}

function loadOwner(elderNumber) {
  return OWNER_SOURCE === "base-key"
    ? loadBaseKeyOwner(elderNumber)
    : loadOrCreateOwner(elderNumber);
}

// Offline (free) derivation of every Elder's Base→Sui owner address. No network,
// no spend — used by --derive-only and printed at the top of every base-key run.
function deriveBaseOwners() {
  const rows = [];
  for (let elderNumber = 1; elderNumber <= 4; elderNumber += 1) {
    const { privateKey, baseAddress } = loadElderBaseKey(elderNumber);
    const keypair = Secp256k1Keypair.fromSecretKey(hexToBytes(privateKey));
    rows.push({
      elder: elderNumber,
      baseAddress,
      suiOwnerAddress: keypair.getPublicKey().toSuiAddress(),
    });
  }
  return rows;
}

async function getSuiBalance(address) {
  const balance = await rpc.getBalance({ owner: address });
  return BigInt(balance.totalBalance);
}

function getTransferGasCoinId() {
  const raw = execFileSync("sui", ["client", "gas", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const coins = JSON.parse(raw);
  const coin = coins
    .map((candidate) => ({
      id: candidate.gasCoinId,
      mist: BigInt(candidate.mistBalance),
    }))
    .filter((candidate) => candidate.mist > FUND_AMOUNT_MIST + 20_000_000n)
    .sort((a, b) => (a.mist < b.mist ? 1 : -1))[0];
  if (!coin) {
    throw new Error("No deployer SUI gas coin has enough balance to fund an Elder");
  }
  return coin.id;
}

async function fundIfNeeded(elderNumber, ownerAddress, runFundingTotal) {
  const before = await getSuiBalance(ownerAddress);
  const result = {
    beforeMist: before.toString(),
    afterMist: before.toString(),
    beforeSui: sui(before),
    afterSui: sui(before),
    funded: false,
    fundAmountSui: "0.000000",
    digest: null,
  };

  if (before >= MIN_BALANCE_MIST) {
    logPublic({
      elder: elderNumber,
      step: "funding",
      status: "skip",
      ownerAddress,
      balanceSui: result.beforeSui,
    });
    return result;
  }

  const activeAddress = execFileSync("sui", ["client", "active-address"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const activeEnv = execFileSync("sui", ["client", "active-env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (normalizeAddress(activeAddress) !== normalizeAddress(DEPLOYER)) {
    throw new Error(`Sui CLI active address is ${activeAddress}, expected ${DEPLOYER}`);
  }
  if (activeEnv !== "mainnet") {
    throw new Error(`Sui CLI active env is ${activeEnv}, expected mainnet`);
  }

  if (runFundingTotal.value + FUND_AMOUNT_MIST > MAX_TOTAL_FUND_MIST) {
    throw new Error(
      `Per-run funding cap would be exceeded (already sent ${sui(runFundingTotal.value)} SUI this run). ` +
        `Aborting to prevent double-spend on Elder ${elderNumber}. Investigate before rerunning.`,
    );
  }

  const gasCoinId = getTransferGasCoinId();
  logPublic({
    elder: elderNumber,
    step: "funding",
    status: "transfer",
    ownerAddress,
    beforeSui: result.beforeSui,
    amountSui: sui(FUND_AMOUNT_MIST),
  });

  const raw = execFileSync(
    "sui",
    [
      "client",
      "transfer-sui",
      "--to",
      ownerAddress,
      "--sui-coin-object-id",
      gasCoinId,
      "--amount",
      FUND_AMOUNT_MIST.toString(),
      "--gas-budget",
      "10000000",
      "--json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const parsed = JSON.parse(raw);
  const txStatus = parsed.effects?.status?.status ?? parsed.status?.status;
  if (txStatus && txStatus !== "success") {
    throw new Error(
      `transfer-sui failed for Elder ${elderNumber}: status=${txStatus}, error=${parsed.effects?.status?.error ?? "unknown"}`,
    );
  }
  const after = await getSuiBalance(ownerAddress);
  if (after <= before) {
    throw new Error(
      `transfer-sui reported success for Elder ${elderNumber} but balance did not increase (before=${before}, after=${after})`,
    );
  }

  runFundingTotal.value += FUND_AMOUNT_MIST;

  return {
    beforeMist: before.toString(),
    afterMist: after.toString(),
    beforeSui: sui(before),
    afterSui: sui(after),
    funded: true,
    fundAmountSui: sui(FUND_AMOUNT_MIST),
    digest: parsed.digest ?? parsed.effects?.transactionDigest ?? null,
  };
}

async function findExistingAccount(ownerAddress) {
  const eventType = `${PACKAGE_ID}::account::AccountCreated`;
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const events = await rpc.queryEvents({
      query: { MoveEventType: eventType },
      cursor,
      limit: 50,
      order: "descending",
    });
    const event = events.data.find(
      (ev) => normalizeAddress(ev.parsedJson?.owner ?? "") === normalizeAddress(ownerAddress),
    );
    if (event?.parsedJson?.account_id) {
      return {
        accountId: event.parsedJson.account_id,
        owner: ownerAddress,
        digest: event.id.txDigest,
        reusedExisting: true,
      };
    }
    if (!events.hasNextPage || !events.nextCursor) break;
    cursor = events.nextCursor;
  }
  throw new Error(`MemWal account already exists for ${ownerAddress}, but no AccountCreated event was found`);
}

// Returns the signer-bearing opts for a MemWal account helper, choosing the
// walletSigner path for secp256k1 (base-key) owners and the suiPrivateKey path
// for Ed25519 owners. The two are mutually exclusive (memwal throws if both set).
function ownerSignerOpts(owner) {
  return owner.walletSigner
    ? { walletSigner: owner.walletSigner }
    : { suiPrivateKey: owner.ownerKey };
}

async function createOrRecoverAccount(owner) {
  const ownerAddress = owner.ownerAddress;
  try {
    const account = await createAccount({
      packageId: PACKAGE_ID,
      registryId: REGISTRY_ID,
      ...ownerSignerOpts(owner),
      suiClient,
      suiNetwork: "mainnet",
    });
    if (!account.accountId) {
      const recovered = await findExistingAccount(ownerAddress);
      return {
        ...recovered,
        createDigest: account.digest,
        recoveredFromEmptyCreateResult: true,
      };
    }
    return account;
  } catch (err) {
    if (String(err?.message ?? err).includes("abort code: 3")) {
      return findExistingAccount(ownerAddress);
    }
    throw err;
  }
}

async function readAccountDelegateKeys(accountId) {
  const object = await rpc.getObject({
    id: accountId,
    options: { showContent: true },
  });
  const fields = object.data?.content?.fields ?? {};
  const delegateKeys =
    fields.delegate_keys?.fields?.contents ??
    fields.delegate_keys?.contents ??
    fields.delegateKeys?.fields?.contents ??
    [];
  return Array.isArray(delegateKeys) ? delegateKeys : [];
}

function publicKeyHexFromDelegateEntry(entry) {
  const value = entry.fields?.key ?? entry.fields?.name ?? entry.key ?? entry.name;
  if (Array.isArray(value)) return bytesToHex(value);
  if (typeof value === "string") return value.startsWith("0x") ? value.slice(2) : value;
  if (value?.fields?.bytes && Array.isArray(value.fields.bytes)) return bytesToHex(value.fields.bytes);
  return null;
}

async function isDelegateValid(accountId, publicKeyHex) {
  const delegates = await readAccountDelegateKeys(accountId);
  const wanted = publicKeyHex.toLowerCase();
  return delegates.some((entry) => publicKeyHexFromDelegateEntry(entry)?.toLowerCase() === wanted);
}

async function prepareDelegate(elderNumber, owner, account, credentialsPath) {
  const ownerAddress = owner.ownerAddress;
  const existing = readJson(credentialsPath);
  if (
    existing?.delegatePrivateKey &&
    existing?.delegatePublicKeyHex &&
    existing?.accountId === account.accountId &&
    existing?.packageId === PACKAGE_ID &&
    (await isDelegateValid(account.accountId, existing.delegatePublicKeyHex))
  ) {
    logPublic({
      elder: elderNumber,
      step: "delegate",
      status: "skip-valid-existing",
      delegateAddress: existing.delegateAddress,
      accountId: account.accountId,
    });
    return {
      credentials: existing,
      addDelegate: null,
      reusedExisting: true,
    };
  }

  const delegate = await generateDelegateKey();
  const delegatePublicKeyHex = bytesToHex(delegate.publicKey);
  // Write credentials BEFORE the on-chain addDelegateKey so that if addDelegateKey
  // succeeds but a subsequent step throws, the credentials are already persisted.
  // A rerun will detect the existing valid on-chain delegate and skip re-registration.
  const credentials = {
    delegatePrivateKey: delegate.privateKey,
    delegatePublicKeyHex,
    delegateAddress: delegate.suiAddress,
    walletAddress: ownerAddress,
    accountId: account.accountId,
    packageId: PACKAGE_ID,
    relayerUrl: RELAYER,
    label: `elder-${elderNumber}`,
    ownerSource: OWNER_SOURCE,
    createdAt: new Date().toISOString(),
    version: 1,
  };
  writeSecretFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, 0o600);
  const addDelegate = await addDelegateKey({
    packageId: PACKAGE_ID,
    accountId: account.accountId,
    publicKey: delegate.publicKey,
    label: `elder-${elderNumber}`,
    ...ownerSignerOpts(owner),
    suiClient,
    suiNetwork: "mainnet",
  });
  return {
    credentials,
    addDelegate,
    reusedExisting: false,
  };
}

async function healCredentialsPublicKey(credentials) {
  if (credentials.delegatePublicKeyHex) return credentials;
  const publicKey = await delegateKeyToPublicKey(credentials.delegatePrivateKey);
  return { ...credentials, delegatePublicKeyHex: bytesToHex(publicKey) };
}

async function provisionElder(elderNumber, runFundingTotal) {
  const owner = loadOwner(elderNumber);
  logPublic({
    elder: elderNumber,
    step: "owner",
    status: owner.generated ? "generated" : "loaded",
    ownerSource: OWNER_SOURCE,
    ownerAddress: owner.ownerAddress,
    baseAddress: owner.baseAddress ?? null,
    ownerKeyPath: owner.keyPath,
  });

  // Done-marker: if credentials.json exists with a valid accountId, delegate, and
  // the delegate is confirmed on-chain, skip this Elder entirely (including funding).
  // This makes reruns safe against double-spend without re-checking everything.
  const existingCreds = readJson(owner.credentialsPath);
  // Guard the done-marker on ownerSource too. base-key and ed25519 modes use
  // DIFFERENT creds dirs so they can't read each other's files today, but this
  // also rejects stale creds written by an older script version (no ownerSource
  // field) and makes the invariant explicit: a creds file only short-circuits a
  // run of the SAME owner source it was provisioned under.
  if (
    existingCreds?.accountId &&
    existingCreds?.delegatePublicKeyHex &&
    (existingCreds.ownerSource ?? "ed25519") === OWNER_SOURCE
  ) {
    const alreadyValid = await isDelegateValid(
      existingCreds.accountId,
      existingCreds.delegatePublicKeyHex,
    );
    if (alreadyValid) {
      logPublic({
        elder: elderNumber,
        step: "provision",
        status: "skip-already-done",
        ownerAddress: owner.ownerAddress,
        accountId: existingCreds.accountId,
        delegateAddress: existingCreds.delegateAddress,
        credentialsPath: owner.credentialsPath,
      });
      const balance = await getSuiBalance(owner.ownerAddress);
      return {
        elderNumber,
        ownerAddress: owner.ownerAddress,
        baseAddress: owner.baseAddress ?? null,
        accountId: existingCreds.accountId,
        delegateAddress: existingCreds.delegateAddress,
        delegatePublicKeyHex: existingCreds.delegatePublicKeyHex,
        credentialsPath: owner.credentialsPath,
        ownerKeyPath: owner.keyPath,
        funding: {
          beforeMist: balance.toString(),
          afterMist: balance.toString(),
          beforeSui: sui(balance),
          afterSui: sui(balance),
          funded: false,
          fundAmountSui: "0.000000",
          digest: null,
        },
        accountDigest: null,
        delegateAddDigest: null,
        delegateReused: true,
        credentials: existingCreds,
      };
    }
  }

  const funding = await fundIfNeeded(elderNumber, owner.ownerAddress, runFundingTotal);
  const account = await createOrRecoverAccount(owner);
  logPublic({
    elder: elderNumber,
    step: "account",
    ownerAddress: owner.ownerAddress,
    accountId: account.accountId,
    digest: account.digest,
    reusedExisting: Boolean(account.reusedExisting),
  });

  const delegate = await prepareDelegate(
    elderNumber,
    owner,
    account,
    owner.credentialsPath,
  );
  const credentials = await healCredentialsPublicKey(delegate.credentials);
  if (credentials !== delegate.credentials) {
    writeSecretFile(owner.credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, 0o600);
  }
  logPublic({
    elder: elderNumber,
    step: "credentials",
    credentialsPath: owner.credentialsPath,
    delegateAddress: credentials.delegateAddress,
    delegatePublicKeyHex: credentials.delegatePublicKeyHex,
    delegateReused: delegate.reusedExisting,
    addDelegateDigest: delegate.addDelegate?.digest ?? null,
  });

  return {
    elderNumber,
    ownerAddress: owner.ownerAddress,
    baseAddress: owner.baseAddress ?? null,
    accountId: account.accountId,
    delegateAddress: credentials.delegateAddress,
    delegatePublicKeyHex: credentials.delegatePublicKeyHex,
    credentialsPath: owner.credentialsPath,
    ownerKeyPath: owner.keyPath,
    funding,
    accountDigest: account.digest,
    delegateAddDigest: delegate.addDelegate?.digest ?? null,
    delegateReused: delegate.reusedExisting,
    credentials,
  };
}

function makeClient(provisioned, namespace) {
  return MemWal.create({
    key: provisioned.credentials.delegatePrivateKey,
    accountId: provisioned.accountId,
    serverUrl: RELAYER,
    namespace,
  });
}

function recallContainsProbe(recall) {
  return (recall.results ?? []).some((result) => result.text?.includes(PROBE_TEXT));
}

async function proveIsolation(elder1, elder2) {
  // Use PROBE_NAMESPACE (not the real "elder-1" namespace) so the probe memory
  // never surfaces in live Elder 1 recall sessions.
  const client1 = makeClient(elder1, PROBE_NAMESPACE);
  const client2 = makeClient(elder2, PROBE_NAMESPACE);
  const remembered = await client1.rememberAndWait(PROBE_TEXT, undefined, {
    timeoutMs: 120_000,
    pollIntervalMs: 2_000,
  });
  const elder2Recall = await client2.recall({ query: PROBE_QUERY, limit: 5 });
  const elder1Recall = await client1.recall({ query: PROBE_QUERY, limit: 5 });
  const elder2DoesNotSee = !recallContainsProbe(elder2Recall);
  const elder1Sees = recallContainsProbe(elder1Recall);
  const pass = elder2DoesNotSee && elder1Sees;
  logPublic({
    step: "isolation",
    verdict: pass ? "PASS" : "FAIL",
    elder1Remembered: {
      id: remembered.id,
      jobId: remembered.job_id,
      blobId: remembered.blob_id,
      namespace: remembered.namespace,
    },
    elder2DoesNotSee,
    elder1Sees,
    elder2RecallTotal: elder2Recall.total,
    elder1RecallTotal: elder1Recall.total,
  });
  return {
    pass,
    remembered,
    elder2DoesNotSee,
    elder1Sees,
    elder2RecallTotal: elder2Recall.total,
    elder1RecallTotal: elder1Recall.total,
    elder2RecallMatches: (elder2Recall.results ?? [])
      .filter((result) => result.text?.includes(PROBE_TEXT))
      .map((result) => ({ blobId: result.blob_id, distance: result.distance })),
    elder1RecallMatches: (elder1Recall.results ?? [])
      .filter((result) => result.text?.includes(PROBE_TEXT))
      .map((result) => ({ blobId: result.blob_id, distance: result.distance })),
  };
}

function writeFindings(provisioned, isolation) {
  const totalFunded = provisioned.reduce(
    (sum, elder) => sum + (elder.funding.funded ? FUND_AMOUNT_MIST : 0n),
    0n,
  );
  const lines = [
    "# Walrus Elder provisioning findings",
    "",
    `Run date: ${new Date().toISOString()}`,
    `Owner source: **${OWNER_SOURCE}**${OWNER_SOURCE === "base-key" ? " (Elder Base/EVM secp256k1 key owns the Sui memory account)" : " (fresh Ed25519 Sui key per Elder)"}.`,
    "",
    "## VERDICT",
    "",
    `All 4 Elders provisioned: **YES**.`,
    `Isolation proof: **${isolation.pass ? "PASS" : "FAIL"}**.`,
    "",
    "## Per-Elder artifacts",
    "",
    "| Elder | Base/EVM address | Sui owner address | Account ID | Delegate address | Funded this run SUI | Owner balance after SUI | Credentials path |",
    "|---|---|---|---|---|---:|---:|---|",
    ...provisioned.map(
      (elder) =>
        `| ${elder.elderNumber} | \`${elder.baseAddress ?? "n/a"}\` | \`${elder.ownerAddress}\` | \`${elder.accountId}\` | \`${elder.delegateAddress}\` | ${elder.funding.funded ? elder.funding.fundAmountSui : "0.000000"} | ${elder.funding.afterSui} | \`${elder.credentialsPath}\` |`,
    ),
    "",
    "## Isolation assertions",
    "",
    `- Elder 1 remembered \`${PROBE_TEXT}\` in namespace \`${PROBE_NAMESPACE}\`.`,
    `- Elder 2 recall for \`${PROBE_QUERY}\` returned Elder 1 probe: **${isolation.elder2DoesNotSee ? "NO" : "YES"}**.`,
    `- Elder 1 recall for \`${PROBE_QUERY}\` returned Elder 1 probe: **${isolation.elder1Sees ? "YES" : "NO"}**.`,
    `- Elder 1 blob ID: \`${isolation.remembered.blob_id}\`.`,
    `- Elder 1 recall total: ${isolation.elder1RecallTotal}. Elder 2 recall total: ${isolation.elder2RecallTotal}.`,
    "",
    "## Spend",
    "",
    `- Deployer funding sent: approximately ${sui(totalFunded)} SUI.`,
    "- Additional SUI gas was spent by the deployer for funding transfers and by each Elder owner for MemWal account/delegate transactions.",
    "- WAL spent: not separately reported by the script; MemWal relayer/Walrus storage costs are represented by the successful remember blob write.",
    "",
    "## Runner wiring notes",
    "",
    "- Run each Elder with an isolated HOME or explicit credential path so `~/.memwal/credentials.json` maps to that Elder only.",
    "- For per-Elder HOME isolation, copy/symlink the relevant `credentials.json` into `<elder-home>/.memwal/credentials.json` and keep `owner.key` outside runtime containers unless rotation/provisioning is needed.",
    `- Credentials root: \`${SECRETS_ROOT}/elder-N/credentials.json\`. Owner keys are stored alongside credentials with mode 0600 and should not be logged.`,
    "",
  ];
  mkdirSync(dirname(FINDINGS_PATH), { recursive: true });
  writeFileSync(FINDINGS_PATH, `${lines.join("\n")}\n`, { mode: 0o600 });
}

logPublic({ step: "mode", ownerSource: OWNER_SOURCE, secretsRoot: SECRETS_ROOT, deriveOnly: DERIVE_ONLY });

// In base-key mode, ALWAYS print the offline (free, no-spend) Base→Sui owner
// mapping for all 4 Elders — this is the "one identity across Base + Sui" proof.
if (OWNER_SOURCE === "base-key") {
  logPublic({ step: "base-owner-derivation", owners: deriveBaseOwners() });
}

// --derive-only: stop here. Prove the secp256k1 derivation works with ZERO spend.
if (DERIVE_ONLY) {
  logPublic({ step: "complete", deriveOnly: true, ownerSource: OWNER_SOURCE });
} else {
  // Shared mutable counter — all provisionElder calls update it; fundIfNeeded enforces the cap.
  const runFundingTotal = { value: 0n };

  const provisioned = [];
  provisioned.push(await provisionElder(1, runFundingTotal));
  provisioned.push(await provisionElder(2, runFundingTotal));
  const isolation = await proveIsolation(provisioned[0], provisioned[1]);
  provisioned.push(await provisionElder(3, runFundingTotal));
  provisioned.push(await provisionElder(4, runFundingTotal));
  writeFindings(provisioned, isolation);
  logPublic({
    step: "complete",
    ownerSource: OWNER_SOURCE,
    allProvisioned: provisioned.length === 4,
    isolation: isolation.pass ? "PASS" : "FAIL",
    findingsPath: FINDINGS_PATH,
  });
}
