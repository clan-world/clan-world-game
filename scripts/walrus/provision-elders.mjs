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
import { pathToFileURL } from "node:url";

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
const SECRETS_ROOT = join(homedir(), ".secrets", "clanworld-elder-walrus");
const FINDINGS_PATH =
  "/home/claude/claudes-world/tmp/codex-walmem-ownerkey/FINDINGS-provisioning.md";
const MIN_BALANCE_MIST = 50_000_000n;
const FUND_AMOUNT_MIST = 100_000_000n;
const PROBE_TEXT = "elder_1_isolation_probe | secret-ridge-cache";
const PROBE_QUERY = "elder_1_isolation_probe secret-ridge-cache";

class MemWalSuiClientCompat {
  constructor(inner) {
    this.inner = inner;
  }

  async signAndExecuteTransaction(input) {
    return this.inner.signAndExecuteTransaction(input);
  }

  async waitForTransaction(input) {
    const include = {};
    if (input.options?.showEffects) include.effects = true;
    if (input.options?.showObjectChanges) include.objectChanges = true;
    return this.inner.waitForTransaction({ digest: input.digest, include });
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
    ownerAddress: keypair.getPublicKey().toSuiAddress(),
    generated,
  };
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

async function fundIfNeeded(elderNumber, ownerAddress) {
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
  const after = await getSuiBalance(ownerAddress);

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

async function createOrRecoverAccount(ownerAddress, ownerKey) {
  try {
    const account = await createAccount({
      packageId: PACKAGE_ID,
      registryId: REGISTRY_ID,
      suiPrivateKey: ownerKey,
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

async function prepareDelegate(elderNumber, ownerKey, ownerAddress, account, credentialsPath) {
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
  const addDelegate = await addDelegateKey({
    packageId: PACKAGE_ID,
    accountId: account.accountId,
    publicKey: delegate.publicKey,
    label: `elder-${elderNumber}`,
    suiPrivateKey: ownerKey,
    suiClient,
    suiNetwork: "mainnet",
  });
  const credentials = {
    delegatePrivateKey: delegate.privateKey,
    delegatePublicKeyHex,
    delegateAddress: delegate.suiAddress,
    walletAddress: ownerAddress,
    accountId: account.accountId,
    packageId: PACKAGE_ID,
    relayerUrl: RELAYER,
    label: `elder-${elderNumber}`,
    createdAt: new Date().toISOString(),
    version: 1,
  };
  writeSecretFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, 0o600);
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

async function provisionElder(elderNumber) {
  const owner = loadOrCreateOwner(elderNumber);
  logPublic({
    elder: elderNumber,
    step: "owner",
    status: owner.generated ? "generated" : "loaded",
    ownerAddress: owner.ownerAddress,
    ownerKeyPath: owner.keyPath,
  });

  const funding = await fundIfNeeded(elderNumber, owner.ownerAddress);
  const account = await createOrRecoverAccount(owner.ownerAddress, owner.ownerKey);
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
    owner.ownerKey,
    owner.ownerAddress,
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
  const client1 = makeClient(elder1, "elder-1");
  const client2 = makeClient(elder2, "elder-2");
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
    "",
    "## VERDICT",
    "",
    `All 4 Elders provisioned: **YES**.`,
    `Isolation proof: **${isolation.pass ? "PASS" : "FAIL"}**.`,
    "",
    "## Per-Elder artifacts",
    "",
    "| Elder | Owner address | Account ID | Delegate address | Funded this run SUI | Owner balance after SUI | Credentials path |",
    "|---|---|---|---|---:|---:|---|",
    ...provisioned.map(
      (elder) =>
        `| ${elder.elderNumber} | \`${elder.ownerAddress}\` | \`${elder.accountId}\` | \`${elder.delegateAddress}\` | ${elder.funding.funded ? elder.funding.fundAmountSui : "0.000000"} | ${elder.funding.afterSui} | \`${elder.credentialsPath}\` |`,
    ),
    "",
    "## Isolation assertions",
    "",
    `- Elder 1 remembered \`${PROBE_TEXT}\` in namespace \`elder-1\`.`,
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

const provisioned = [];
provisioned.push(await provisionElder(1));
provisioned.push(await provisionElder(2));
const isolation = await proveIsolation(provisioned[0], provisioned[1]);
provisioned.push(await provisionElder(3));
provisioned.push(await provisionElder(4));
writeFindings(provisioned, isolation);
logPublic({
  step: "complete",
  allProvisioned: provisioned.length === 4,
  isolation: isolation.pass ? "PASS" : "FAIL",
  findingsPath: FINDINGS_PATH,
});
