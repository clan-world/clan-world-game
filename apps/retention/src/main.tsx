import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createWalletClient, custom } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import amethystSpire from '../../web/public/bases/amethyst-spire-lv3.png';
import blackForge from '../../web/public/bases/black-forge-lv4.png';
import boneStandard from '../../web/public/bases/bone-standard-lv3.png';
import cobaltKeep from '../../web/public/bases/cobalt-keep-lv3.png';
import dawnWatch from '../../web/public/bases/dawn-watch-lv4.png';
import emberHand from '../../web/public/bases/ember-hand-lv5.png';
import gildedHold from '../../web/public/bases/gilded-hold-lv4.png';
import ironGuard from '../../web/public/bases/iron-guard-lv3.png';
import paleCathedral from '../../web/public/bases/pale-cathedral-lv4.png';
import stormRiders from '../../web/public/bases/storm-riders-lv5.png';
import tideWardens from '../../web/public/bases/tide-wardens-lv3.png';
import verdantGrove from '../../web/public/bases/verdant-grove-lv4.png';
import './styles.css';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
    solana?: {
      publicKey?: { toString: () => string };
      connect?: () => Promise<{ publicKey: { toString: () => string } }>;
      signMessage?: (message: Uint8Array, encoding?: string) => Promise<{ signature: Uint8Array }>;
    };
  }
}

type VerificationStatus = 'idle' | 'verifying' | 'pending' | 'granted';
type WalletKind = 'evm' | 'solana';
type SocialKind = 'x' | 'telegram' | 'tiktok';
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
type RequestState = 'idle' | 'loading' | 'success' | 'error';

type WalletProfile = {
  address: string;
  verifiedAt: number;
};

type SocialProfile = {
  handle: string;
  status: VerificationStatus;
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

type CampaignProfile = {
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

type RewardDefinition = {
  key: string;
  name: string;
  rarity: Rarity;
  image: string;
};

type ApiResponse<T> = T | { error: string };

const USER_ID_KEY = 'clanworld.retention.prototype.userId';
const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;
const STREAK_BONUSES = [3, 7, 15, 21, 25, 30];
const DEMO_EVM_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f094538e9b7f1ecb4f26dcb5f9969de231120439';
const DEMO_SIGNING_ENABLED = import.meta.env.DEV || import.meta.env.VITE_RETENTION_ENABLE_DEMO_SIGNING === 'true';

const REWARD_IMAGES: Record<string, string> = {
  dawnWatch,
  ironGuard,
  tideWardens,
  boneStandard,
  cobaltKeep,
  verdantGrove,
  blackForge,
  amethystSpire,
  paleCathedral,
  gildedHold,
  stormRiders,
  emberHand,
};

const REWARDS: RewardDefinition[] = [
  { key: 'dawnWatch', name: 'Dawn Watch Keep', rarity: 'common', image: dawnWatch },
  { key: 'ironGuard', name: 'Iron Guard Bastion', rarity: 'common', image: ironGuard },
  { key: 'tideWardens', name: 'Tide Wardens Dock', rarity: 'common', image: tideWardens },
  { key: 'boneStandard', name: 'Bone Standard Camp', rarity: 'uncommon', image: boneStandard },
  { key: 'cobaltKeep', name: 'Cobalt Keep', rarity: 'uncommon', image: cobaltKeep },
  { key: 'verdantGrove', name: 'Verdant Grove', rarity: 'uncommon', image: verdantGrove },
  { key: 'blackForge', name: 'Black Forge', rarity: 'rare', image: blackForge },
  { key: 'amethystSpire', name: 'Amethyst Spire', rarity: 'rare', image: amethystSpire },
  { key: 'paleCathedral', name: 'Pale Cathedral', rarity: 'epic', image: paleCathedral },
  { key: 'gildedHold', name: 'Gilded Hold', rarity: 'epic', image: gildedHold },
  { key: 'stormRiders', name: 'Storm Riders Citadel', rarity: 'legendary', image: stormRiders },
  { key: 'emberHand', name: 'Ember Hand Furnace', rarity: 'legendary', image: emberHand },
];

const LEADERBOARD_BASE = [
  { alias: 'mira.sol', xp: 1840, streak: 19 },
  { alias: 'ironbren.eth', xp: 1725, streak: 15 },
  { alias: 'sora.base', xp: 1550, streak: 12 },
  { alias: 'anon-7f4c', xp: 1320, streak: 9 },
  { alias: 'dawncaster', xp: 1185, streak: 7 },
];

const emptySocial = (): SocialProfile => ({ handle: '', status: 'idle' });

const emptyProfile = (): CampaignProfile => ({
  id: '',
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

const normalizeHandle = (value: string) => value.trim().replace(/^@/, '');

const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...options?.headers,
    },
  });
  const data = (await response.json()) as ApiResponse<T>;
  if (!response.ok || isApiError(data)) {
    throw new Error(isApiError(data) ? data.error : 'Request failed.');
  }
  return data;
};

const isApiError = (value: unknown): value is { error: string } =>
  typeof value === 'object' && value !== null && 'error' in value && typeof (value as { error?: unknown }).error === 'string';

const post = <T,>(path: string, body: unknown) =>
  api<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });

const getPacificDay = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const getNextPacificMidnight = (from = new Date()) => {
  const pacificParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(from);
  const year = Number(pacificParts.find((part) => part.type === 'year')?.value);
  const month = Number(pacificParts.find((part) => part.type === 'month')?.value);
  const day = Number(pacificParts.find((part) => part.type === 'day')?.value);
  const noonUtcTomorrow = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(noonUtcTomorrow, 'America/Los_Angeles');
  return new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0) - offsetMinutes * 60000);
};

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return (asUtc - date.getTime()) / 60000;
};

const formatCountdown = (ms: number) => {
  if (ms <= 0) return 'Ready';
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
};

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const settledReel = (reward: RewardDefinition, frame: HTMLDivElement | null) => {
  const frameWidth = frame?.clientWidth ?? 1080;
  const compact = frameWidth < 520;
  const slotWidth = compact ? 112 : 132;
  const slotPitch = compact ? 122 : 142;
  const rewardIndex = compact ? 1 : Math.max(1, Math.floor((frameWidth / 2 - slotWidth / 2) / slotPitch));

  return [
    ...Array.from({ length: rewardIndex }, () => REWARDS[randomInt(0, REWARDS.length - 1)]!),
    reward,
    ...Array.from({ length: 8 }, () => REWARDS[randomInt(0, REWARDS.length - 1)]!),
  ];
};

const taskCount = (profile: CampaignProfile) =>
  [profile.evm, profile.solana, profile.x.status !== 'idle', profile.telegram.status !== 'idle', profile.tiktok.status !== 'idle'].filter(
    Boolean,
  ).length;

const displayAlias = (profile: CampaignProfile) => {
  if (profile.alias.trim()) return profile.alias.trim();
  if (profile.solana?.address.endsWith('.sol')) return profile.solana.address;
  if (profile.evm?.address.endsWith('.eth')) return profile.evm.address;
  return profile.id ? `anon-${profile.id.slice(0, 4)}` : 'anon-cw';
};

const rewardImage = (reward: SpinReward) => REWARD_IMAGES[reward.key] ?? dawnWatch;

function App() {
  const [profile, setProfile] = useState<CampaignProfile>(() => emptyProfile());
  const [aliasInput, setAliasInput] = useState('');
  const [evmInput, setEvmInput] = useState('');
  const [solanaInput, setSolanaInput] = useState('');
  const [socialInputs, setSocialInputs] = useState<Record<SocialKind, string>>({ x: '', telegram: '', tiktok: '' });
  const [now, setNow] = useState(Date.now());
  const [walletStates, setWalletStates] = useState<Record<WalletKind, RequestState>>({ evm: 'idle', solana: 'idle' });
  const [walletErrors, setWalletErrors] = useState<Record<WalletKind, string>>({ evm: '', solana: '' });
  const [socialStates, setSocialStates] = useState<Record<SocialKind, RequestState>>({ x: 'idle', telegram: 'idle', tiktok: 'idle' });
  const [socialErrors, setSocialErrors] = useState<Record<SocialKind, string>>({ x: '', telegram: '', tiktok: '' });
  const [aliasState, setAliasState] = useState<RequestState>('idle');
  const [spinState, setSpinState] = useState<RequestState>('idle');
  const [spinError, setSpinError] = useState('');
  const [lastReward, setLastReward] = useState<SpinReward | undefined>();
  const reelFrameRef = useRef<HTMLDivElement | null>(null);
  const [reelItems, setReelItems] = useState<RewardDefinition[]>(() =>
    Array.from({ length: 18 }, () => REWARDS[randomInt(0, REWARDS.length - 1)]!),
  );

  useEffect(() => {
    const userId = window.localStorage.getItem(USER_ID_KEY);
    if (!userId) return;

    api<{ profile: CampaignProfile }>(`/api/profile?userId=${encodeURIComponent(userId)}`)
      .then(({ profile: nextProfile }) => {
        hydrateProfile(nextProfile);
      })
      .catch(() => {
        window.localStorage.removeItem(USER_ID_KEY);
      });
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!profile.id || aliasInput === profile.alias) return;

    setAliasState('loading');
    const timeout = window.setTimeout(() => {
      post<{ profile: CampaignProfile }>('/api/profile', { userId: profile.id, alias: aliasInput })
        .then(({ profile: nextProfile }) => {
          hydrateProfile(nextProfile);
          setAliasState('success');
        })
        .catch(() => setAliasState('error'));
    }, 650);

    return () => window.clearTimeout(timeout);
  }, [aliasInput, profile.alias, profile.id]);

  const hydrateProfile = (nextProfile: CampaignProfile) => {
    setProfile(nextProfile);
    setAliasInput(nextProfile.alias);
    setEvmInput(nextProfile.evm?.address ?? '');
    setSolanaInput(nextProfile.solana?.address ?? '');
    setSocialInputs({
      x: nextProfile.x.handle,
      telegram: nextProfile.telegram.handle,
      tiktok: nextProfile.tiktok.handle,
    });
    window.localStorage.setItem(USER_ID_KEY, nextProfile.id);
  };

  const today = getPacificDay(new Date(now));
  const completedTasks = taskCount(profile);
  const usedToday = profile.dailySpins[today] ?? 0;
  const creditsToday = Math.max(0, completedTasks - usedToday);
  const nextReset = getNextPacificMidnight(new Date(now));
  const hasWallet = Boolean(profile.evm || profile.solana);
  const unlockAt = profile.createdAt + TWENTY_HOURS_MS;
  const rewardReady = hasWallet && now >= unlockAt;
  const leaderboard = useMemo(
    () =>
      [
        ...(profile.id ? [{ alias: displayAlias(profile), xp: profile.totalXp, streak: profile.currentStreak }] : []),
        ...LEADERBOARD_BASE,
      ]
        .sort((a, b) => b.xp - a.xp || b.streak - a.streak)
        .slice(0, 6),
    [profile],
  );

  const verifyWallet = async (kind: WalletKind, mode: 'wallet' | 'demo') => {
    const requestedAddress = kind === 'evm' ? evmInput.trim() : solanaInput.trim();
    setWalletStates((current) => ({ ...current, [kind]: 'loading' }));
    setWalletErrors((current) => ({ ...current, [kind]: '' }));

    try {
      if (mode === 'demo' && !DEMO_SIGNING_ENABLED) throw new Error('Demo signing is disabled for this build.');
      const signed = await signWallet(kind, mode, requestedAddress);
      const response = await post<{ profile: CampaignProfile }>('/api/wallet/verify', {
        userId: profile.id || undefined,
        walletKind: kind,
        address: signed.address,
        nonce: signed.nonce,
        message: signed.message,
        signature: signed.signature,
        alias: aliasInput,
      });
      hydrateProfile(response.profile);
      setWalletStates((current) => ({ ...current, [kind]: 'success' }));
    } catch (error) {
      setWalletErrors((current) => ({
        ...current,
        [kind]: error instanceof Error ? error.message : 'Could not verify wallet.',
      }));
      setWalletStates((current) => ({ ...current, [kind]: 'error' }));
    }
  };

  const signWallet = async (kind: WalletKind, mode: 'wallet' | 'demo', requestedAddress: string) => {
    if (kind === 'evm') {
      const address = mode === 'demo' ? privateKeyToAccount(DEMO_EVM_PRIVATE_KEY).address : await requestEvmAddress();
      const nonce = await post<{ nonce: string; message: string }>('/api/nonce', { walletKind: kind, address });
      const signature =
        mode === 'demo'
          ? await privateKeyToAccount(DEMO_EVM_PRIVATE_KEY).signMessage({ message: nonce.message })
          : await signInjectedEvm(address, nonce.message);
      return { address, ...nonce, signature };
    }

    if (mode === 'demo') {
      const keypair = nacl.sign.keyPair.fromSeed(new TextEncoder().encode('clanworld-retention-demo-solana!').slice(0, 32));
      const address = bs58.encode(keypair.publicKey);
      const nonce = await post<{ nonce: string; message: string }>('/api/nonce', { walletKind: kind, address });
      return { address, ...nonce, signature: Array.from(nacl.sign.detached(new TextEncoder().encode(nonce.message), keypair.secretKey)) };
    }

    const address = requestedAddress || (await requestSolanaAddress());
    const nonce = await post<{ nonce: string; message: string }>('/api/nonce', { walletKind: kind, address });
    const signature = await signInjectedSolana(nonce.message);
    return { address, ...nonce, signature };
  };

  const requestEvmAddress = async () => {
    if (!window.ethereum) {
      throw new Error(DEMO_SIGNING_ENABLED ? 'No EVM wallet detected. Use demo sign or install a wallet.' : 'No EVM wallet detected.');
    }
    const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
    const address = accounts[0];
    if (!address) throw new Error('No EVM account selected.');
    return address;
  };

  const signInjectedEvm = async (address: string, message: string) => {
    if (!window.ethereum) throw new Error('No EVM wallet detected.');
    const client = createWalletClient({ chain: mainnet, transport: custom(window.ethereum) });
    return client.signMessage({ account: address as `0x${string}`, message });
  };

  const requestSolanaAddress = async () => {
    if (!window.solana?.connect) {
      throw new Error(DEMO_SIGNING_ENABLED ? 'No Solana wallet detected. Use demo sign or install a wallet.' : 'No Solana wallet detected.');
    }
    const account = await window.solana.connect();
    return account.publicKey.toString();
  };

  const signInjectedSolana = async (message: string) => {
    if (!window.solana?.signMessage) throw new Error('No Solana wallet message signer detected.');
    const result = await window.solana.signMessage(new TextEncoder().encode(message), 'utf8');
    return Array.from(result.signature);
  };

  const setSocialHandle = (key: SocialKind, value: string) => {
    setSocialInputs((current) => ({ ...current, [key]: normalizeHandle(value) }));
  };

  const openSocialLink = (key: SocialKind) => {
    const href = {
      x: 'https://x.com/intent/follow?screen_name=ClanWorldGame',
      telegram: 'https://t.me/ClanWorldGame',
      tiktok: 'https://www.tiktok.com/@clanworldgame',
    }[key];
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const verifySocial = (key: SocialKind) => {
    if (!profile.id) return;

    setSocialStates((current) => ({ ...current, [key]: 'loading' }));
    setSocialErrors((current) => ({ ...current, [key]: '' }));

    window.setTimeout(() => {
      post<{ profile: CampaignProfile }>('/api/social', {
        userId: profile.id,
        kind: key,
        handle: socialInputs[key],
      })
        .then(({ profile: nextProfile }) => {
          hydrateProfile(nextProfile);
          setSocialStates((current) => ({ ...current, [key]: 'success' }));
        })
        .catch((error) => {
          setSocialErrors((current) => ({
            ...current,
            [key]: error instanceof Error ? error.message : 'Could not save social handle.',
          }));
          setSocialStates((current) => ({ ...current, [key]: 'error' }));
        });
    }, 5000);
  };

  const spin = () => {
    if (creditsToday <= 0 || spinState === 'loading' || !profile.id) return;

    setSpinState('loading');
    setSpinError('');
    const teaserItems = Array.from({ length: 32 }, () => REWARDS[randomInt(0, REWARDS.length - 1)]!);
    setReelItems(teaserItems);

    post<{ profile: CampaignProfile; reward: SpinReward }>('/api/spin', { userId: profile.id })
      .then(({ profile: nextProfile, reward }) => {
        const rewardDef = REWARDS.find((item) => item.key === reward.key) ?? REWARDS[0]!;
        setReelItems([
          ...Array.from({ length: 24 }, () => REWARDS[randomInt(0, REWARDS.length - 1)]!),
          rewardDef,
          ...Array.from({ length: 6 }, () => REWARDS[randomInt(0, REWARDS.length - 1)]!),
        ]);
        window.setTimeout(() => {
          setReelItems(settledReel(rewardDef, reelFrameRef.current));
          hydrateProfile(nextProfile);
          setLastReward(reward);
          setSpinState('success');
        }, 2300);
      })
      .catch((error) => {
        setSpinError(error instanceof Error ? error.message : 'Spin failed.');
        setSpinState('error');
      });
  };

  const resetLocal = () => {
    window.localStorage.removeItem(USER_ID_KEY);
    setProfile(emptyProfile());
    setAliasInput('');
    setEvmInput('');
    setSolanaInput('');
    setSocialInputs({ x: '', telegram: '', tiktok: '' });
    setLastReward(undefined);
    setSpinError('');
    setWalletErrors({ evm: '', solana: '' });
    setSocialErrors({ x: '', telegram: '', tiktok: '' });
  };

  return (
    <main className="shell">
      <section className="workspace" aria-labelledby="page-title">
        <div className="masthead">
          <div>
            <p className="eyebrow">ClanWorld Campaign Access</p>
            <h1 id="page-title">Register optional accounts. Earn daily spins. Build a collectible streak.</h1>
          </div>
          <div className="progressDial" aria-label={`${completedTasks} of 5 optional spin sources active`}>
            <span>{completedTasks}/5</span>
          </div>
        </div>

        <section className="panel spinPanel" aria-labelledby="spin-title">
          <div className="spinHeader">
            <div>
              <p className="step">Daily Wheel</p>
              <h2 id="spin-title">Loot Reel</h2>
            </div>
            <div className="spinStats">
              <Stat label="Credits" value={`${creditsToday}/${completedTasks}`} />
              <Stat label="XP" value={String(profile.totalXp)} />
              <Stat label="Streak" value={`${profile.currentStreak}d`} />
              <Stat label="Reset" value={formatCountdown(nextReset.getTime() - now)} />
            </div>
          </div>

          <div className="reelFrame" ref={reelFrameRef}>
            <div className="reelMarker" />
            <div className={`reelTrack ${spinState === 'loading' ? 'spinning' : ''}`}>
              {reelItems.map((item, index) => (
                <div className={`reelSlot ${item.rarity}`} key={`${item.name}-${index}`}>
                  <img src={item.image} alt="" />
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="spinFooter">
            <button
              className="primaryButton spinButton"
              type="button"
              onClick={spin}
              disabled={!hasWallet || creditsToday <= 0 || spinState === 'loading'}
            >
              {spinState === 'loading' ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Spinning...
                </>
              ) : (
                'Spin Wheel'
              )}
            </button>
            <p className={spinError ? 'errorText' : 'statusCopy'}>
              {spinError ||
                (lastReward
                  ? `Last pull: ${lastReward.name}, ${lastReward.xp} XP.`
                  : hasWallet
                    ? 'Each active wallet/social source grants one spin per PT day.'
                    : 'Verify at least one wallet to activate the campaign profile.')}
            </p>
          </div>
        </section>

        <div className="layout">
          <section className="panel walletPanel" aria-labelledby="wallet-title">
            <div className="panelHeader">
              <p className="step">Spin Sources</p>
              <h2 id="wallet-title">Wallets</h2>
            </div>

            <AliasRow alias={aliasInput} state={aliasState} onChange={setAliasInput} />
            <WalletRow
              label="EVM"
              placeholder="Wallet fills after signing"
              value={evmInput}
              wallet={profile.evm}
              state={walletStates.evm}
              error={walletErrors.evm}
              onChange={setEvmInput}
              onVerify={() => verifyWallet('evm', 'wallet')}
              onDemo={() => verifyWallet('evm', 'demo')}
              demoEnabled={DEMO_SIGNING_ENABLED}
            />
            <WalletRow
              label="Solana"
              placeholder="Wallet fills after signing"
              value={solanaInput}
              wallet={profile.solana}
              state={walletStates.solana}
              error={walletErrors.solana}
              onChange={setSolanaInput}
              onVerify={() => verifyWallet('solana', 'wallet')}
              onDemo={() => verifyWallet('solana', 'demo')}
              demoEnabled={DEMO_SIGNING_ENABLED}
            />
          </section>

          <section className={`panel ${hasWallet ? '' : 'locked'}`} aria-labelledby="social-title">
            <div className="panelHeader">
              <p className="step">Optional</p>
              <h2 id="social-title">Social Sources</h2>
            </div>

            <SocialQuest
              label="X"
              handleLabel="X handle"
              placeholder="ClanWorldGame"
              profile={profile.x}
              value={socialInputs.x}
              state={socialStates.x}
              error={socialErrors.x}
              disabled={!hasWallet}
              linkLabel="Follow @ClanWorldGame"
              onHandle={(value) => setSocialHandle('x', value)}
              onOpen={() => openSocialLink('x')}
              onVerify={() => verifySocial('x')}
            />
            <SocialQuest
              label="Telegram"
              handleLabel="Telegram handle"
              placeholder="your_handle"
              profile={profile.telegram}
              value={socialInputs.telegram}
              state={socialStates.telegram}
              error={socialErrors.telegram}
              disabled={!hasWallet}
              linkLabel="Join ClanWorldGame"
              onHandle={(value) => setSocialHandle('telegram', value)}
              onOpen={() => openSocialLink('telegram')}
              onVerify={() => verifySocial('telegram')}
            />
            <SocialQuest
              label="TikTok"
              handleLabel="TikTok handle"
              placeholder="clanworldgame"
              profile={profile.tiktok}
              value={socialInputs.tiktok}
              state={socialStates.tiktok}
              error={socialErrors.tiktok}
              disabled={!hasWallet}
              linkLabel="Follow @clanworldgame"
              onHandle={(value) => setSocialHandle('tiktok', value)}
              onOpen={() => openSocialLink('tiktok')}
              onVerify={() => verifySocial('tiktok')}
            />
          </section>

          <aside className="panel statusPanel" aria-labelledby="status-title">
            <div className="panelHeader">
              <p className="step">Campaign</p>
              <h2 id="status-title">Profile</h2>
            </div>

            <div className="rewardMeter">
              <div className={`rewardOrb ${rewardReady ? 'ready' : ''}`} />
              <div>
                <p className="statusLabel">{rewardReady ? 'Campaign access granted' : 'Campaign access pending'}</p>
                <p className="statusCopy">
                  {hasWallet
                    ? `Automatic grant window: ${formatCountdown(unlockAt - now)}`
                    : 'Register at least one wallet to start the access timer.'}
                </p>
              </div>
            </div>

            <BonusTrack streak={profile.currentStreak} />

            <dl className="profileList">
              <ProfileItem label="Alias" value={displayAlias(profile)} />
              <ProfileItem label="EVM" value={profile.evm?.address ?? 'Not registered'} />
              <ProfileItem label="Solana" value={profile.solana?.address ?? 'Not registered'} />
              <ProfileItem label="X" value={profile.x.handle ? `@${profile.x.handle}` : 'Not linked'} />
              <ProfileItem label="Telegram" value={profile.telegram.handle ? `@${profile.telegram.handle}` : 'Not linked'} />
              <ProfileItem label="TikTok" value={profile.tiktok.handle ? `@${profile.tiktok.handle}` : 'Not linked'} />
            </dl>

            <button className="secondaryButton" type="button" onClick={resetLocal}>
              Reset Local Session
            </button>
          </aside>
        </div>

        <div className="lowerGrid">
          <section className="panel" aria-labelledby="collection-title">
            <div className="panelHeader">
              <p className="step">Collection</p>
              <h2 id="collection-title">Recent Sprites</h2>
            </div>
            <div className="collectionGrid">
              {profile.collection.length ? (
                profile.collection.map((reward) => (
                  <div className={`collectionItem ${reward.rarity}`} key={reward.id}>
                    <img src={rewardImage(reward)} alt="" />
                    <span>{reward.xp} XP</span>
                  </div>
                ))
              ) : (
                <p className="emptyState">Spin to start collecting ClanWorld sprites.</p>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="leaderboard-title">
            <div className="panelHeader">
              <p className="step">Hourly</p>
              <h2 id="leaderboard-title">Leaderboard</h2>
            </div>
            <ol className="leaderboard">
              {leaderboard.map((entry, index) => (
                <li key={`${entry.alias}-${index}`}>
                  <span className="rank">#{index + 1}</span>
                  <span>{entry.alias}</span>
                  <strong>{entry.xp} XP</strong>
                  <small>{entry.streak}d streak</small>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AliasRow({
  alias,
  state,
  onChange,
}: {
  alias: string;
  state: RequestState;
  onChange: (value: string) => void;
}) {
  return (
    <div className="aliasRow">
      <div className="fieldGroup">
        <label>Leaderboard alias</label>
        <div className="inputStatusWrap">
          <input
            aria-label="Leaderboard alias"
            value={alias}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Optional username"
          />
          <InlineState state={state} />
        </div>
      </div>
    </div>
  );
}

type WalletRowProps = {
  label: string;
  placeholder: string;
  value: string;
  wallet?: WalletProfile;
  state: RequestState;
  error: string;
  demoEnabled: boolean;
  onChange: (value: string) => void;
  onVerify: () => void;
  onDemo: () => void;
};

function WalletRow({ label, placeholder, value, wallet, state, error, demoEnabled, onChange, onVerify, onDemo }: WalletRowProps) {
  const loading = state === 'loading';

  return (
    <div className="walletRow expanded">
      <div className="fieldGroup">
        <label>{label} Wallet</label>
        <div className="inputStatusWrap">
          <input
            aria-label={`${label} Wallet`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            disabled={Boolean(wallet)}
          />
          <InlineState state={state} />
        </div>
        {error ? <p className="errorText">{error}</p> : <p className="hintText">Cryptographic signature is verified before profile save.</p>}
      </div>
      <div className="walletActions">
        <button className={wallet ? 'verifiedButton' : 'primaryButton'} type="button" onClick={onVerify} disabled={loading || Boolean(wallet)}>
          {loading ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Signing...
            </>
          ) : wallet ? (
            '+1 Spin'
          ) : (
            'Connect'
          )}
        </button>
        {demoEnabled ? (
          <button className="secondaryButton" type="button" onClick={onDemo} disabled={loading || Boolean(wallet)}>
            Demo Sign
          </button>
        ) : null}
      </div>
    </div>
  );
}

type SocialQuestProps = {
  label: string;
  handleLabel: string;
  placeholder: string;
  profile: SocialProfile;
  value: string;
  state: RequestState;
  error: string;
  disabled: boolean;
  linkLabel: string;
  onHandle: (value: string) => void;
  onOpen: () => void;
  onVerify: () => void;
};

function SocialQuest({
  label,
  handleLabel,
  placeholder,
  profile,
  value,
  state,
  error,
  disabled,
  linkLabel,
  onHandle,
  onOpen,
  onVerify,
}: SocialQuestProps) {
  const loading = state === 'loading';
  const active = profile.status !== 'idle';

  return (
    <div className="questRow" aria-disabled={disabled}>
      <div className="questTitle">
        <span className="questBadge">{label}</span>
        <StatusPill status={profile.status} />
      </div>
      <div className="fieldGroup">
        <label>{handleLabel}</label>
        <div className="inputStatusWrap">
          <input
            aria-label={handleLabel}
            value={value}
            onChange={(event) => onHandle(event.target.value)}
            placeholder={placeholder}
            disabled={disabled || active}
          />
          <InlineState state={state} />
        </div>
      </div>
      <div className="buttonLine">
        <button className="secondaryButton" type="button" onClick={onOpen} disabled={disabled || !value || loading}>
          {linkLabel}
        </button>
        <button className={active ? 'verifiedButton' : 'primaryButton'} type="button" onClick={onVerify} disabled={disabled || !value || loading || active}>
          {loading ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Verifying...
            </>
          ) : active ? (
            '+1 Spin'
          ) : (
            'Click to verify'
          )}
        </button>
      </div>
      {error ? <p className="errorText">{error}</p> : null}
      {profile.verifiedAt ? <p className="notice">Verification can take up to 24h. Spin credit is provisionally active.</p> : null}
    </div>
  );
}

function InlineState({ state }: { state: RequestState }) {
  if (state === 'loading') return <span className="inlineState loading">Saving</span>;
  if (state === 'success') return <span className="inlineState success">Saved</span>;
  if (state === 'error') return <span className="inlineState error">Retry</span>;
  return null;
}

function StatusPill({ status }: { status: VerificationStatus }) {
  const label = {
    idle: 'Optional',
    verifying: 'Checking',
    pending: 'Active',
    granted: 'Granted',
  }[status];

  return <span className={`statusPill ${status}`}>{label}</span>;
}

function BonusTrack({ streak }: { streak: number }) {
  return (
    <div className="bonusTrack">
      {STREAK_BONUSES.map((day) => (
        <div className={streak >= day ? 'bonusNode earned' : 'bonusNode'} key={day}>
          <strong>{day}</strong>
          <span>days</span>
        </div>
      ))}
    </div>
  );
}

function ProfileItem({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
