import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { ConvexProvider, ConvexReactClient } from 'convex/react';

// Cinzel
import {
  Cinzel_400Regular,
  Cinzel_500Medium,
  Cinzel_600SemiBold,
  Cinzel_700Bold,
} from '@expo-google-fonts/cinzel';
// Cormorant Garamond
import {
  CormorantGaramond_400Regular_Italic,
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold_Italic,
} from '@expo-google-fonts/cormorant-garamond';
// EB Garamond
import {
  EBGaramond_400Regular,
  EBGaramond_500Medium,
  EBGaramond_400Regular_Italic,
} from '@expo-google-fonts/eb-garamond';
// JetBrains Mono
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';
import { Connection } from '@solana/web3.js';

import { colors } from './src/theme';
import { TabBar, TabKey } from './src/components/TabBar';
import { Toast } from './src/components/Toast';
import { HireModal } from './src/components/HireModal';
import { Inft } from './src/data';
import {
  getLoadedInftId,
  setLoadedInftId,
  getWalletPubkey,
  resetForgeState,
  setActiveRaid,
} from './src/storage';
import { HeroWidget } from './src/widget/HeroWidget';
import { computeWidgetState } from './src/widget/widgetState';

// Defensive load — old dev client APKs that predate
// react-native-android-widget will silently no-op widget pushes.
let requestWidgetUpdateSafe: (
  args: {
    widgetName: string;
    renderWidget: () => React.ReactElement;
    widgetNotFound?: () => void;
  },
) => Promise<void> = async () => {};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const widgetLib = require('react-native-android-widget');
  if (widgetLib?.requestWidgetUpdate) {
    requestWidgetUpdateSafe = widgetLib.requestWidgetUpdate;
  }
} catch {
  if (__DEV__) {
    console.warn(
      '[widget] react-native-android-widget native module not available — widgets disabled until next dev client build.',
    );
  }
}
import { disconnectWallet } from './src/wallet/mwa';
import { hasSeekerGenesisToken, isSeekerDevice } from './src/seeker';
import { PublicKey } from '@solana/web3.js';

import { SplashScreen } from './src/screens/SplashScreen';
import { HearthScreen } from './src/screens/HearthScreen';
import { HallScreen } from './src/screens/HallScreen';
import { BazaarScreen } from './src/screens/BazaarScreen';
import { TreasuryScreen } from './src/screens/TreasuryScreen';
import { InftDetailScreen } from './src/screens/InftDetailScreen';
import { StrategyEditorScreen } from './src/screens/StrategyEditorScreen';
import { SteeringConsoleScreen } from './src/screens/SteeringConsoleScreen';
import { ForgeScreen } from './src/screens/ForgeScreen';
import { CockpitScreen } from './src/screens/CockpitScreen';
import { BridgeScreen } from './src/screens/BridgeScreen';
import { WhispersScreen } from './src/screens/WhispersScreen';
import { CodexScreen } from './src/screens/CodexScreen';
import { RaidAlertOverlay } from './src/components/RaidAlertOverlay';
import {
  cancelRaidAlert,
  installRaidNotificationHandler,
  isNotificationsAvailable,
  scheduleRaidAlert,
  subscribeToRaidResponses,
} from './src/raid';
import { findExtraInft } from './src/extraInfts';
import { mergeRealClan, REAL_CLAN_DISPLAY } from './src/clanData';
import { getForgedInfts } from './src/storage';

// Foreground notification handler — installed once at module load so a
// raid notification arriving while the app is open does NOT show a system
// banner. The themed RaidAlertOverlay takes its place.
installRaidNotificationHandler();

const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) {
  throw new Error(
    'EXPO_PUBLIC_CONVEX_URL env var is required; no fallback allowed. ' +
      'See apps/mobile/.env.example. For EAS builds set it in eas.json build profiles.',
  );
}
// Solana RPC keeps a soft default: the public mainnet endpoint is a fine
// fallback for low-traffic dev/demo flows. Convex has no equivalent public
// fallback — every deployment is a project-specific URL — so it fails loud.
const SOLANA_RPC = process.env.EXPO_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';

const convex = new ConvexReactClient(CONVEX_URL, { unsavedChangesWarning: false });
const solana = new Connection(SOLANA_RPC, 'confirmed');

type StackEntry =
  | { kind: 'whispers' }
  | { kind: 'codex' }
  | { kind: 'inft'; inft: Inft }
  | { kind: 'bazaar-inft'; inft: Inft }
  | { kind: 'strategy-edit'; inft: Inft }
  | { kind: 'steering'; inft: Inft };

export default function App() {
  const [fontsLoaded] = useFonts({
    Cinzel_400Regular,
    Cinzel_500Medium,
    Cinzel_600SemiBold,
    Cinzel_700Bold,
    CormorantGaramond_400Regular_Italic,
    CormorantGaramond_500Medium_Italic,
    CormorantGaramond_600SemiBold_Italic,
    EBGaramond_400Regular,
    EBGaramond_500Medium,
    EBGaramond_400Regular_Italic,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });

  // Auth — pubkey from MMKV cache; if present we skip Splash.
  const [pubkey, setPubkey] = useState<string | null>(() => getWalletPubkey());
  const splashSeen = pubkey !== null;

  // Seeker detection — M1 instant (sync), M2 async after auth resolves.
  const [seekerM1] = useState<boolean>(() => isSeekerDevice());
  const [seekerM2, setSeekerM2] = useState<boolean | null>(null);

  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    hasSeekerGenesisToken(solana, new PublicKey(pubkey)).then((has) => {
      if (!cancelled) setSeekerM2(has);
    });
    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  // Notification-tap handler: when the user taps a raid notification while
  // the app was backgrounded, route them to Hearth with the raid banner
  // active. Handled by the raid module so it's a safe no-op when
  // expo-notifications isn't available (old dev client APK).
  useEffect(() => {
    const unsubscribe = subscribeToRaidResponses((meta) => {
      setRaid(meta);
      setStack([]);
      setTab('hearth');
      setForge(false);
      setCockpit(null);
      setBridge(false);
    });
    return unsubscribe;
  }, []);

  // Cleanup the raid timer if App unmounts mid-countdown
  useEffect(() => {
    return () => {
      if (raidTimerRef.current) clearTimeout(raidTimerRef.current);
    };
  }, []);

  const isSeekerBearer = seekerM1 || seekerM2 === true;

  // Routing state
  const [tab, setTab] = useState<TabKey>('hearth');
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [hire, setHire] = useState<Inft | null>(null);
  const [bridge, setBridge] = useState(false);
  const [cockpit, setCockpit] = useState<Inft | null>(null);
  const [forge, setForge] = useState(false);
  const [loadedInftIdState, setLoadedInftIdState] = useState<string | null>(
    () => getLoadedInftId(),
  );
  // Raid demo — non-null when a raid is active (banner on hero, overlay
  // pops over the app). Cleared when the user enters the cockpit or
  // dismisses the overlay.
  const [raid, setRaid] = useState<{ victim: string; tick: number } | null>(null);
  const [showRaidOverlay, setShowRaidOverlay] = useState(false);
  const raidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist raid + loadedInftId to MMKV and push an immediate update to
  // any installed home-screen widgets. The widget itself reads MMKV in
  // its task handler for background updates, but a foreground push is
  // instant — the widget reflects raid state the moment it fires.
  useEffect(() => {
    setActiveRaid(raid);
    const state = computeWidgetState();
    requestWidgetUpdateSafe({
      widgetName: 'Hero',
      renderWidget: () => <HeroWidget state={state} />,
      widgetNotFound: () => undefined,
    }).catch(() => {
      // Old APK without react-native-android-widget natively linked —
      // silent no-op until a fresh build lands.
    });
  }, [raid, loadedInftIdState, pubkey]);

  const top = stack[stack.length - 1];
  const push = (s: StackEntry) => setStack((prev) => [...prev, s]);
  const pop = () => setStack((prev) => prev.slice(0, -1));
  const showToast = (text: string) => setToast(text);

  const navigate = (target: 'forge' | 'bazaar' | 'hearth' | 'hall') => {
    if (target === 'forge') setForge(true);
    else if (target === 'bazaar') {
      setStack([]);
      setTab('bazaar');
    } else if (target === 'hearth') {
      setStack([]);
      setTab('hearth');
    } else if (target === 'hall') {
      setStack([]);
      setTab('hall');
    }
  };

  const enterCockpit = (inft: Inft) => {
    setBridge(true);
    setTimeout(() => {
      setBridge(false);
      setCockpit(inft);
    }, 1400);
  };

  /** Load/Unload toggle — writes through to MMKV so it survives reloads. */
  const updateLoadedInft = (inftId: string | null) => {
    setLoadedInftId(inftId);
    setLoadedInftIdState(inftId);
  };

  /** Pick the victim name for a raid alert. Prefers the currently-loaded
   *  clan name; falls back to a default real clan so the demo always has
   *  someone to target. */
  const resolveRaidVictim = (): string => {
    if (loadedInftIdState) {
      // Real clan loaded
      const m = loadedInftIdState.match(/^clan-(\d+)$/);
      if (m) {
        const display = REAL_CLAN_DISPLAY.find((d) => d.clanId === Number(m[1]));
        if (display) return display.name;
      }
      // Forged Elder loaded
      if (loadedInftIdState.startsWith('forged-') && pubkey) {
        const f = getForgedInfts(pubkey).find((x) => x.id === loadedInftIdState);
        if (f) return f.name;
      }
      // Pre-populated extra Elder loaded
      if (loadedInftIdState.startsWith('extra-')) {
        const x = findExtraInft(loadedInftIdState);
        if (x) return x.name;
      }
    }
    return 'Crimson';
  };

  /** Demo trigger — schedules a raid alert 10s from now. */
  const handleTriggerRaid = async () => {
    const victim = resolveRaidVictim();
    const tick = 263 + Math.floor(Math.random() * 7);

    // Schedule the system notification (fires regardless of foreground state)
    try {
      await scheduleRaidAlert(10, victim, tick);
    } catch (e) {
      if (__DEV__) console.warn('[raid] schedule failed:', e);
    }

    // Foreground timer — fires only if the app stays open. Cancels the
    // system notification so we don't get a double banner.
    if (raidTimerRef.current) clearTimeout(raidTimerRef.current);
    raidTimerRef.current = setTimeout(() => {
      // Only fire foreground overlay when actually in the foreground
      if (AppState.currentState === 'active') {
        cancelRaidAlert();
        setRaid({ victim, tick });
        setShowRaidOverlay(true);
        // Drop user onto Hearth so the banner is visible after dismiss
        setStack([]);
        setTab('hearth');
        setForge(false);
        setCockpit(null);
        setBridge(false);
      }
    }, 10_000);

    showToast(
      isNotificationsAvailable()
        ? 'Raid scheduled. 10 seconds.'
        : 'Raid scheduled (in-app only). Install latest APK for system notifications.',
    );
  };

  /** Demo helper — clear forged INFTs + free-forge flag without dropping
   *  wallet auth. Lets the demo loop run again. */
  const handleResetForgeState = () => {
    resetForgeState();
    setLoadedInftIdState(null);
    showToast('Forge state reset. Ready for another run.');
  };

  /** Sign out — clear MMKV auth + reset routing state back to Splash. */
  const handleDisconnect = () => {
    disconnectWallet();
    setLoadedInftId(null);
    setLoadedInftIdState(null);
    setStack([]);
    setTab('hearth');
    setForge(false);
    setCockpit(null);
    setBridge(false);
    setHire(null);
    setSeekerM2(null);
    setPubkey(null); // flips splashSeen back to false
  };

  if (!fontsLoaded) {
    return (
      <SafeAreaProvider>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.bgCanvas,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator color={colors.goldPrimary} />
        </View>
      </SafeAreaProvider>
    );
  }

  let body: React.ReactNode = null;

  if (!splashSeen) {
    body = (
      <SplashScreen
        seekerDetected={seekerM1}
        onAuthed={(pk) => {
          setPubkey(pk);
          showToast('Welcome. Your hall awaits.');
        }}
      />
    );
  } else if (cockpit) {
    body = (
      <CockpitScreen
        inft={cockpit}
        onClose={() => setCockpit(null)}
        onWhisper={() => push({ kind: 'steering', inft: cockpit })}
      />
    );
  } else if (bridge) {
    body = <BridgeScreen />;
  } else if (forge) {
    body = (
      <ForgeScreen
        pubkey={pubkey!}
        isFreeForgeEligible={isSeekerBearer}
        connection={solana}
        onClose={() => setForge(false)}
        onComplete={() => {
          setForge(false);
          showToast('Forged. Welcome a new Elder to your hall.');
        }}
      />
    );
  } else if (top?.kind === 'whispers') {
    body = <WhispersScreen onBack={pop} />;
  } else if (top?.kind === 'codex') {
    body = (
      <CodexScreen
        onBack={pop}
        pubkey={pubkey}
        onDisconnect={handleDisconnect}
        onResetForgeState={handleResetForgeState}
        onTriggerRaid={handleTriggerRaid}
      />
    );
  } else if (top?.kind === 'steering') {
    body = (
      <SteeringConsoleScreen
        inft={top.inft}
        onBack={pop}
        onSend={() => showToast('Whisper queued for next tick.')}
      />
    );
  } else if (top?.kind === 'strategy-edit') {
    const editingInft = top.inft;
    body = (
      <StrategyEditorScreen
        inft={editingInft}
        onBack={pop}
        onSave={() => {
          showToast('Strategy editor — wired in slice 2.');
          pop();
        }}
      />
    );
  } else if (top?.kind === 'inft') {
    body = (
      <InftDetailScreen
        inft={top.inft}
        loadedInftId={loadedInftIdState}
        onBack={pop}
        onEdit={() => push({ kind: 'strategy-edit', inft: top.inft })}
        onWhisper={() => push({ kind: 'steering', inft: top.inft })}
        onCockpit={() => enterCockpit(top.inft)}
        onLoad={(inftId) => {
          updateLoadedInft(inftId);
          showToast(
            inftId == null
              ? 'Unloaded from your hall.'
              : `Loaded ${top.inft.name} into your hall.`,
          );
        }}
      />
    );
  } else if (top?.kind === 'bazaar-inft') {
    body = (
      <InftDetailScreen
        inft={top.inft}
        loadedInftId={loadedInftIdState}
        onBack={pop}
        isBazaar
        onHire={() => setHire(top.inft)}
      />
    );
  } else {
    if (tab === 'hearth') {
      body = (
        <HearthScreen
          loadedInftId={loadedInftIdState}
          pubkey={pubkey}
          isSeekerBearer={isSeekerBearer}
          raid={raid}
          onEnterCockpit={(inft) => {
            // Clear raid when user defends in the cockpit
            setRaid(null);
            enterCockpit(inft);
          }}
          onWhispers={() => push({ kind: 'whispers' })}
          onSettings={() => push({ kind: 'codex' })}
          navigate={navigate}
        />
      );
    } else if (tab === 'hall') {
      body = (
        <HallScreen
          pubkey={pubkey}
          loadedInftId={loadedInftIdState}
          onOpenInft={(inft) => push({ kind: 'inft', inft })}
          onForge={() => setForge(true)}
        />
      );
    } else if (tab === 'bazaar') {
      body = (
        <BazaarScreen onOpenInft={(inft) => push({ kind: 'bazaar-inft', inft })} />
      );
    } else if (tab === 'treasury') {
      body = (
        <TreasuryScreen
          onBuyGold={() => {
            const url =
              'https://kickstart.easya.io/token/4kWysUHVqtFmxrvwPUxA66exm2iJBMkvD4EBRrNmcieL';
            Linking.openURL(url).catch(() =>
              showToast('Could not open the Kickstart page.'),
            );
          }}
          onTx={() => showToast('Transaction details coming.')}
        />
      );
    }
  }

  const onRoot = !top && !cockpit && !bridge && !forge && splashSeen;

  return (
    <ConvexProvider client={convex}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SafeAreaView
          style={{ flex: 1, backgroundColor: colors.bgCanvas }}
          edges={['top', 'bottom']}
        >
          <View style={{ flex: 1, position: 'relative' }}>
            <View style={{ flex: 1 }}>{body}</View>
            {onRoot && <TabBar active={tab} onChange={setTab} />}
            {toast && <Toast text={toast} onDismiss={() => setToast(null)} />}
            <HireModal
              visible={!!hire}
              inft={hire}
              onCancel={() => setHire(null)}
              onConfirm={() => {
                const hiredInft = hire!;
                setHire(null);
                showToast(
                  `Hire flow — wired in slice 2. (${hiredInft.name})`,
                );
              }}
            />
            {showRaidOverlay && raid && (
              <RaidAlertOverlay
                victim={raid.victim}
                tick={raid.tick}
                onDismiss={() => setShowRaidOverlay(false)}
                onDefend={() => {
                  setShowRaidOverlay(false);
                  // If a real clan is loaded, dive straight into the cockpit;
                  // otherwise nudge the user to the hall to pick one.
                  const realId = loadedInftIdState
                    ? loadedInftIdState.match(/^clan-(\d+)$/)
                    : null;
                  if (realId) {
                    const display = REAL_CLAN_DISPLAY.find(
                      (d) => d.clanId === Number(realId[1]),
                    );
                    if (display) {
                      const inft = mergeRealClan(display, undefined, null);
                      setRaid(null);
                      enterCockpit(inft);
                      return;
                    }
                  }
                  // No real clan loaded — keep the raid banner up so the
                  // user knows it's still active, and route to the Hall.
                  setStack([]);
                  setTab('hall');
                }}
              />
            )}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </ConvexProvider>
  );
}
