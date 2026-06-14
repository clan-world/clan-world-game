import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { verifyMessage } from 'viem';

type WalletKind = 'evm' | 'solana';
type SocialKind = 'x' | 'telegram' | 'tiktok';
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

type WalletProfile = {
  address: string;
  verifiedAt: number;
};

type SocialProfile = {
  handle: string;
  status: 'idle' | 'verifying' | 'pending' | 'granted';
  openedAt?: number;
  verifiedAt?: number;
};

type SpinReward = {
  id: string;
  key: string;
  name: string;
  rarity: Rarity;
  xp: number;
  wonAt: number;
};

type UserProfile = {
  id: string;
  alias: string;
  createdAt: number;
  totalXp: number;
  currentStreak: number;
  longestStreak: number;
  lastSpinDay?: string;
  dailySpins: Record<string, number>;
  collection: SpinReward[];
  evm?: WalletProfile;
  solana?: WalletProfile;
  x: SocialProfile;
  telegram: SocialProfile;
  tiktok: SocialProfile;
};

type NonceRecord = {
  nonce: string;
  walletKind: WalletKind;
  address: string;
  message: string;
  expiresAt: number;
};

type Db = {
  users: Record<string, UserProfile>;
  nonces: Record<string, NonceRecord>;
};

type ApiResult = {
  status: number;
  body: unknown;
};

type RewardDefinition = {
  key: string;
  name: string;
  rarity: Rarity;
};

const PORT = Number(process.env.RETENTION_API_PORT || process.env.PORT || 38742);
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = resolve(APP_ROOT, 'runtime/retention-prototype-db.json');
const MAX_BODY_BYTES = 16 * 1024;
const NONCE_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 90;

const REWARDS: RewardDefinition[] = [
  { key: 'dawnWatch', name: 'Dawn Watch Keep', rarity: 'common' },
  { key: 'ironGuard', name: 'Iron Guard Bastion', rarity: 'common' },
  { key: 'tideWardens', name: 'Tide Wardens Dock', rarity: 'common' },
  { key: 'boneStandard', name: 'Bone Standard Camp', rarity: 'uncommon' },
  { key: 'cobaltKeep', name: 'Cobalt Keep', rarity: 'uncommon' },
  { key: 'verdantGrove', name: 'Verdant Grove', rarity: 'uncommon' },
  { key: 'blackForge', name: 'Black Forge', rarity: 'rare' },
  { key: 'amethystSpire', name: 'Amethyst Spire', rarity: 'rare' },
  { key: 'paleCathedral', name: 'Pale Cathedral', rarity: 'epic' },
  { key: 'gildedHold', name: 'Gilded Hold', rarity: 'epic' },
  { key: 'stormRiders', name: 'Storm Riders Citadel', rarity: 'legendary' },
  { key: 'emberHand', name: 'Ember Hand Furnace', rarity: 'legendary' },
];

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let dbWriteQueue = Promise.resolve();

const emptySocial = (): SocialProfile => ({ handle: '', status: 'idle' });

const emptyDb = (): Db => ({ users: {}, nonces: {} });

const readDb = async (): Promise<Db> => {
  try {
    return JSON.parse(await readFile(DB_PATH, 'utf8')) as Db;
  } catch {
    return emptyDb();
  }
};

const writeDb = async (db: Db) => {
  await mkdir(dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, DB_PATH);
};

const updateDb = async <T,>(mutate: (db: Db) => Promise<T> | T) => {
  const task = dbWriteQueue.then(async () => {
    const db = await readDb();
    const result = await mutate(db);
    await writeDb(db);
    return result;
  });
  dbWriteQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    'content-type': 'application/json',
  });
  res.end(JSON.stringify(body));
};

const readJson = async (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolveBody, reject) => {
    let body = '';
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      body += chunk.toString('utf8');
      if (body.length > MAX_BODY_BYTES) {
        settled = true;
        req.destroy();
        reject(new Error('Request too large'));
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });

const clientKey = (req: IncomingMessage) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return `${req.socket.remoteAddress ?? 'local'}:${url.pathname}`;
};

const isRateLimited = (req: IncomingMessage) => {
  const key = clientKey(req);
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
};

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const walletKind = (value: unknown): WalletKind | undefined => (value === 'evm' || value === 'solana' ? value : undefined);

const socialKind = (value: unknown): SocialKind | undefined =>
  value === 'x' || value === 'telegram' || value === 'tiktok' ? value : undefined;

const buildMessage = (kind: WalletKind, address: string, nonce: string) =>
  [
    'ClanWorld Campaign Access',
    '',
    `Wallet: ${address}`,
    `Chain: ${kind}`,
    `Nonce: ${nonce}`,
    '',
    'Sign this message to register your wallet and create a campaign profile.',
  ].join('\n');

const verifySolana = (address: string, message: string, signature: unknown) => {
  if (!Array.isArray(signature)) return false;
  const signatureBytes = Uint8Array.from(signature.map((value) => Number(value)));
  const publicKeyBytes = bs58.decode(address);
  return nacl.sign.detached.verify(new TextEncoder().encode(message), signatureBytes, publicKeyBytes);
};

const findUserByWallet = (db: Db, kind: WalletKind, address: string) =>
  Object.values(db.users).find((user) => {
    const registered = user[kind]?.address;
    if (!registered) return false;
    return kind === 'evm' ? registered.toLowerCase() === address.toLowerCase() : registered === address;
  });

const defaultUser = (id: string): UserProfile => ({
  id,
  alias: '',
  createdAt: Date.now(),
  totalXp: 0,
  currentStreak: 0,
  longestStreak: 0,
  dailySpins: {},
  collection: [],
  x: emptySocial(),
  telegram: emptySocial(),
  tiktok: emptySocial(),
});

const getPacificDay = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const getPreviousPacificDay = () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return getPacificDay(date);
};

const completedTasks = (user: UserProfile) =>
  [user.evm, user.solana, user.x.status !== 'idle', user.telegram.status !== 'idle', user.tiktok.status !== 'idle'].filter(Boolean)
    .length;

const pickXp = () => {
  const roll = Math.random();
  if (roll < 0.45) return randomInt(3, 12);
  if (roll < 0.8) return randomInt(30, 39);
  if (roll < 0.93) return randomInt(40, 64);
  if (roll < 0.99) return randomInt(13, 24);
  return randomInt(65, 99);
};

const pickReward = () => {
  const roll = Math.random();
  const rarity: Rarity = roll < 0.5 ? 'common' : roll < 0.78 ? 'uncommon' : roll < 0.92 ? 'rare' : roll < 0.985 ? 'epic' : 'legendary';
  const choices = REWARDS.filter((reward) => reward.rarity === rarity);
  return choices[randomInt(0, choices.length - 1)] ?? REWARDS[0]!;
};

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const verifyWalletSignature = async (kind: WalletKind, address: string, message: string, signature: unknown) => {
  try {
    return kind === 'evm'
      ? await verifyMessage({ address: address as `0x${string}`, message, signature: str(signature) as `0x${string}` })
      : verifySolana(address, message, signature);
  } catch {
    return false;
  }
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (isRateLimited(req)) return json(res, 429, { error: 'Slow down for a moment.' });

  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/profile') {
      const db = await readDb();
      const user = db.users[url.searchParams.get('userId') ?? ''];
      return user ? json(res, 200, { profile: user }) : json(res, 404, { error: 'Profile not found.' });
    }

    if (req.method === 'POST' && url.pathname === '/api/nonce') {
      const body = await readJson(req);
      const kind = walletKind(body.walletKind);
      const address = str(body.address);
      if (!kind || !address) return json(res, 400, { error: 'Wallet kind and address are required.' });

      const nonce = randomBytes(16).toString('hex');
      const message = buildMessage(kind, address, nonce);
      const result = await updateDb<ApiResult>((db) => {
        db.nonces[nonce] = { nonce, walletKind: kind, address, message, expiresAt: Date.now() + NONCE_TTL_MS };
        return { status: 200, body: { nonce, message } };
      });
      return json(res, result.status, result.body);
    }

    if (req.method === 'POST' && url.pathname === '/api/wallet/verify') {
      const body = await readJson(req);
      const kind = walletKind(body.walletKind);
      const address = str(body.address);
      const nonce = str(body.nonce);
      const message = str(body.message);
      const alias = str(body.alias).slice(0, 32);
      const requestedUserId = str(body.userId);
      const dbBeforeVerify = await readDb();
      const record = dbBeforeVerify.nonces[nonce];
      if (!kind || !address || !record || record.expiresAt < Date.now()) return json(res, 400, { error: 'Signature request expired.' });
      if (record.walletKind !== kind || record.address !== address || record.message !== message) {
        return json(res, 400, { error: 'Signature request does not match this wallet.' });
      }

      const ok = await verifyWalletSignature(kind, address, message, body.signature);
      if (!ok) return json(res, 401, { error: 'Signature verification failed.' });

      const result = await updateDb<ApiResult>((db) => {
        const freshRecord = db.nonces[nonce];
        if (!freshRecord || freshRecord.expiresAt < Date.now()) {
          return { status: 400, body: { error: 'Signature request expired.' } };
        }
        if (freshRecord.walletKind !== kind || freshRecord.address !== address || freshRecord.message !== message) {
          return { status: 400, body: { error: 'Signature request does not match this wallet.' } };
        }

        const existingByWallet = findUserByWallet(db, kind, address);
        const requestedUser = requestedUserId ? db.users[requestedUserId] : undefined;
        if (requestedUserId && !requestedUser) {
          return { status: 404, body: { error: 'Profile not found. Reset local session and sign again.' } };
        }
        if (existingByWallet && requestedUser && existingByWallet.id !== requestedUser.id) {
          return { status: 409, body: { error: 'Wallet is already registered to another profile.' } };
        }

        const user = requestedUser ?? existingByWallet ?? defaultUser(randomUUID());
        user.alias = alias || user.alias;
        user[kind] = { address, verifiedAt: Date.now() };
        db.users[user.id] = user;
        delete db.nonces[nonce];
        return { status: 200, body: { profile: user } };
      });
      return json(res, result.status, result.body);
    }

    if (req.method === 'POST' && url.pathname === '/api/social') {
      const body = await readJson(req);
      const kind = socialKind(body.kind);
      const handle = str(body.handle).replace(/^@/, '').slice(0, 40);
      if (!kind || !handle) return json(res, 400, { error: 'Social handle is required.' });

      const result = await updateDb<ApiResult>((db) => {
        const user = db.users[str(body.userId)];
        if (!user?.evm && !user?.solana) return { status: 401, body: { error: 'Register a wallet first.' } };

        user[kind] = { handle, status: 'pending', openedAt: Date.now(), verifiedAt: Date.now() };
        return { status: 200, body: { profile: user } };
      });
      return json(res, result.status, result.body);
    }

    if (req.method === 'POST' && url.pathname === '/api/profile') {
      const body = await readJson(req);
      const alias = str(body.alias).slice(0, 32);
      const result = await updateDb<ApiResult>((db) => {
        const user = db.users[str(body.userId)];
        if (!user?.evm && !user?.solana) return { status: 401, body: { error: 'Register a wallet first.' } };

        user.alias = alias;
        return { status: 200, body: { profile: user } };
      });
      return json(res, result.status, result.body);
    }

    if (req.method === 'POST' && url.pathname === '/api/spin') {
      const body = await readJson(req);
      const result = await updateDb<ApiResult>((db) => {
        const user = db.users[str(body.userId)];
        if (!user?.evm && !user?.solana) return { status: 401, body: { error: 'Register a wallet first.' } };

        const today = getPacificDay();
        const credits = completedTasks(user) - (user.dailySpins[today] ?? 0);
        if (credits <= 0) return { status: 409, body: { error: 'No spin credits left until midnight PT.' } };

        const rewardDef = pickReward();
        const reward: SpinReward = {
          ...rewardDef,
          id: randomUUID(),
          xp: pickXp(),
          wonAt: Date.now(),
        };

        const yesterday = getPreviousPacificDay();
        const currentStreak =
          user.lastSpinDay === today
            ? Math.max(1, user.currentStreak || 1)
            : user.lastSpinDay === yesterday
              ? Math.max(1, user.currentStreak || 0) + 1
              : 1;
        user.totalXp += reward.xp;
        user.currentStreak = currentStreak;
        user.longestStreak = Math.max(user.longestStreak, currentStreak);
        user.lastSpinDay = today;
        user.dailySpins[today] = (user.dailySpins[today] ?? 0) + 1;
        user.collection = [reward, ...user.collection].slice(0, 24);
        return { status: 200, body: { profile: user, reward } };
      });
      return json(res, result.status, result.body);
    }

    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : 'Unexpected server error.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Retention API listening on http://127.0.0.1:${PORT}`);
});
