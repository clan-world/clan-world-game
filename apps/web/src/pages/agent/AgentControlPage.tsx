import { useCallback, useEffect, useRef, useState } from 'react';
import {
  agentTokens as t,
  AGENTS,
  findAgent,
  type AgentDef,
  INITIAL_GOLD,
  MOCK_WALLET,
  MOCK_ESSENCE,
  WHISPER_BURN,
  WHISPER_COOLDOWN_MS,
  SKIP_TAX_PER_FULL_MINUTE,
  FAUCET_DROP,
} from './agent-tokens';
import { ConnectGate } from './ConnectGate';
import { DetailBack } from './DetailBack';
import { HeroCard } from './HeroCard';
import { EssenceSection } from './EssenceSection';
import { WhispersSection, type Whisper } from './WhispersSection';
import { SignSealModal } from './SignSealModal';
import { ToastStack, type ToastDef } from './Toast';
import { useTimeouts } from './useTimeouts';

/**
 * Single-Agent Control Page — "the writ of {name}".
 *
 * Vertical mobile-portrait layout:
 *
 *   ◀  HALL  ·  the writ of {name}             ← DetailBack
 *   ┌──── parchment-letter HeroCard ──────┐
 *   │ tkn · name · archetype · clan-pill  │
 *   │ sigil · sealed tick · 3-stat grid   │
 *   └─────────────────────────────────────┘
 *   ── ÆLDER ESSENCE ──                         ← OrnamentRule
 *   strategy / notes textareas + commit CTA
 *   ── ÆLDER WHISPERS ──
 *   whisper feed (scrolls)
 *   ┌── ChatInput (LLM-style) ────────────┐
 *   │ textarea + cooldown chip + send btn │
 *   └─────────────────────────────────────┘
 *   [+5 BURNED] (ephemeral, post-tx only)
 *   GOLD · 12,450 g     [+ MINT 10K · DEVNET]
 *   status line
 *
 * Auth flow + sign-seal modal + decrypt skeleton are unchanged from the
 * previous design — only the visual layer was rewritten.
 */

interface Props {
  agentId: number;
}

type AuthState = 'gated' | 'gateConnecting' | 'decrypting' | 'live';

export function AgentControlPage({ agentId }: Props) {
  const agent = findAgent(agentId);
  if (!agent) return <NotFound id={agentId} />;
  return <AgentControlInner agent={agent} />;
}

function AgentControlInner({ agent }: { agent: AgentDef }) {
  const [auth, setAuth] = useState<AuthState>('gated');
  const [signSeal, setSignSeal] = useState<{ open: boolean; caption: string }>(
    { open: false, caption: 'to authenticate' },
  );

  // Wallet / balances
  const [gold, setGold] = useState<number>(INITIAL_GOLD);
  const [goldBouncing, setGoldBouncing] = useState(false);
  const [faucetCooling, setFaucetCooling] = useState(false);

  // Essence — server truth + editor draft
  const [committedStrategy, setCommittedStrategy] = useState<string>('');
  const [committedNotes, setCommittedNotes] = useState<string>('');
  const [strategy, setStrategy] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [signing, setSigning] = useState(false);
  const [essenceStatus, setEssenceStatus] = useState<{
    kind: 'success' | 'error';
    body: string;
  } | null>(null);

  // Whispers — feed state, draft, send-in-flight
  const [whispers, setWhispers] = useState<ReadonlyArray<Whisper>>([]);
  const [draft, setDraft] = useState<string>('');
  const [lastSentAt, setLastSentAt] = useState<number>(-1);
  const [sending, setSending] = useState(false);
  const [whisperStatus, setWhisperStatus] = useState<{
    kind: 'success' | 'error';
    body: string;
  } | null>(null);

  // BurnFlash trigger — increments per send, drives the ephemeral counter.
  const [lastBurnAt, setLastBurnAt] = useState<number>(0);
  const [lastBurnAmount, setLastBurnAmount] = useState<number>(WHISPER_BURN);

  // Toasts
  const [toasts, setToasts] = useState<ToastDef[]>([]);
  const toastIdRef = useRef(0);

  // Centralised setTimeout tracker — auto-clears all pending IDs on unmount.
  const tt = useTimeouts();

  /* ---------- Playwright test hook (unchanged) -------------------------- */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasFlag = new URLSearchParams(window.location.search).has('test');
    if (!hasFlag) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__agentTestHook = {
      setCooldownAgo(secondsAgo: number, _sentCount: number) {
        setLastSentAt(Date.now() - secondsAgo * 1000);
      },
      setGold(g: number) {
        setGold(g);
      },
    };
  }, []);

  /* ---------- toast helper ---------- */
  const pushToast = useCallback(
    (kind: ToastDef['kind'], body: string, ttl = 2400) => {
      const id = ++toastIdRef.current;
      setToasts((arr) => [...arr, { id, kind, body }]);
      tt.set(() => setToasts((arr) => arr.filter((toast) => toast.id !== id)), ttl);
    },
    [tt],
  );

  /* ---------- auto-dismiss success status ---------- */
  useEffect(() => {
    if (essenceStatus?.kind === 'success') {
      const id = setTimeout(() => setEssenceStatus(null), 5000);
      return () => clearTimeout(id);
    }
  }, [essenceStatus]);
  useEffect(() => {
    if (whisperStatus?.kind === 'success') {
      const id = setTimeout(() => setWhisperStatus(null), 5000);
      return () => clearTimeout(id);
    }
  }, [whisperStatus]);

  /* ---------- handlers ---------- */

  const handleConnect = useCallback(() => {
    setAuth('gateConnecting');
    setSignSeal({ open: true, caption: 'to authenticate' });
    const fast =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('fast');
    const sealDelay = fast ? 200 : 800;
    tt.set(() => {
      setSignSeal({ open: false, caption: 'to authenticate' });
      setAuth('decrypting');
      const decryptDuration = fast ? 400 : 1500 + Math.random() * 1500;
      tt.set(() => {
        const ess = MOCK_ESSENCE[agent.id] ?? { strategy: '', notes: '' };
        setCommittedStrategy(ess.strategy);
        setCommittedNotes(ess.notes);
        setStrategy(ess.strategy);
        setNotes(ess.notes);
        setAuth('live');
        pushToast('success', 'NFT unsealed · welcome, ælder-keeper');
      }, decryptDuration);
    }, sealDelay);
  }, [agent.id, pushToast, tt]);

  const handleFaucet = useCallback(() => {
    if (faucetCooling) return;
    setFaucetCooling(true);
    setGold((g) => g + FAUCET_DROP);
    setGoldBouncing(true);
    pushToast('success', `${FAUCET_DROP.toLocaleString()} GOLD added — devnet only`);
    tt.set(() => setGoldBouncing(false), 800);
    tt.set(() => setFaucetCooling(false), 1200);
  }, [faucetCooling, pushToast, tt]);

  const handleCommitEssence = useCallback(() => {
    if (signing) return;
    setSigning(true);
    setEssenceStatus(null);
    setSignSeal({ open: true, caption: 'to commit ælder essence' });

    tt.set(() => {
      setSignSeal({ open: false, caption: 'to commit ælder essence' });
      setCommittedStrategy(strategy);
      setCommittedNotes(notes);
      setSigning(false);
      const fields: string[] = [];
      if (strategy !== committedStrategy) fields.push('strategy');
      if (notes !== committedNotes) fields.push('notes');
      setEssenceStatus({
        kind: 'success',
        body: `essence sealed · ${fields.join(' + ')} written to agent memory`,
      });
    }, 900);
  }, [signing, strategy, notes, committedStrategy, committedNotes, tt]);

  const handleSendWhisper = useCallback(() => {
    const body = draft.trim();
    if (body.length === 0 || sending) return;
    const cooldownMs =
      lastSentAt < 0 ? 0 : Math.max(0, WHISPER_COOLDOWN_MS - (Date.now() - lastSentAt));
    const fullMinutes = Math.ceil(cooldownMs / 60_000);
    const skipTax = cooldownMs > 0 ? fullMinutes * SKIP_TAX_PER_FULL_MINUTE : 0;
    const total = WHISPER_BURN + skipTax;
    if (gold < total) {
      setWhisperStatus({
        kind: 'error',
        body: `Insufficient GOLD (need ${total.toLocaleString()})`,
      });
      return;
    }

    setSending(true);
    setWhisperStatus(null);

    tt.set(() => {
      const sentAt = Date.now();
      setGold((g) => g - total);
      setWhispers((arr) => [...arr, { id: sentAt, body, sentAt }]);
      setLastSentAt(sentAt);
      setLastBurnAt(sentAt);
      setLastBurnAmount(WHISPER_BURN);
      setDraft('');
      setSending(false);
      setWhisperStatus({
        kind: 'success',
        body:
          skipTax > 0
            ? `whisper sent · 5 burned · ${skipTax.toLocaleString()} → treasury`
            : 'whisper sent · 5 GOLD burned',
      });
      pushToast('success', 'whisper delivered');
    }, 700);
  }, [draft, sending, lastSentAt, gold, pushToast, tt]);

  /* ---------- render ---------- */

  return (
    <div
      data-testid="agent-control-page"
      data-agent-id={agent.id}
      data-auth-state={auth}
      data-wallet={MOCK_WALLET}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100dvh',
        background: t.bg.obsidian,
        color: t.text.primary,
        overflowX: 'hidden',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: t.font.body,
      }}
    >
      <GlobalKeyframes />

      {/* Atmospheric corner gradients — mirrors slice-1 page-level treatment */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background:
            `radial-gradient(ellipse 80% 50% at 50% 0%, rgba(255,107,53,0.06), transparent 70%),
             radial-gradient(ellipse 60% 40% at 100% 100%, rgba(95,197,212,0.04), transparent 70%),
             radial-gradient(ellipse 50% 50% at 0% 80%, rgba(212,160,74,0.03), transparent 70%)`,
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background: `url("${pageNoise}")`,
          mixBlendMode: 'overlay',
          opacity: 0.6,
        }}
      />

      {auth === 'gated' || auth === 'gateConnecting' ? (
        <ConnectGate
          agent={agent}
          loading={auth === 'gateConnecting'}
          onConnect={handleConnect}
        />
      ) : (
        <main
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            paddingBottom: '24px',
          }}
        >
          <DetailBack agentName={agent.name} />

          <HeroCard agent={agent} />

          <EssenceSection
            decrypting={auth === 'decrypting'}
            committedStrategy={committedStrategy}
            committedNotes={committedNotes}
            strategy={strategy}
            notes={notes}
            signing={signing}
            status={essenceStatus}
            onStrategyChange={setStrategy}
            onNotesChange={setNotes}
            onCommit={handleCommitEssence}
            onDismissStatus={() => setEssenceStatus(null)}
          />

          <WhispersSection
            decrypting={auth === 'decrypting'}
            draft={draft}
            onDraftChange={setDraft}
            lastSentAt={lastSentAt}
            cooldownTotalMs={WHISPER_COOLDOWN_MS}
            feed={whispers}
            lastBurnAt={lastBurnAt}
            lastBurnAmount={lastBurnAmount}
            gold={gold}
            goldBouncing={goldBouncing}
            faucetCooling={faucetCooling}
            sending={sending}
            status={whisperStatus}
            onSend={handleSendWhisper}
            onFaucet={handleFaucet}
          />
        </main>
      )}

      <SignSealModal
        open={signSeal.open}
        caption={signSeal.caption}
        sigil={agent.glyph}
      />
      <ToastStack toasts={toasts} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function NotFound({ id }: { id: number }) {
  return (
    <main
      style={{
        background: t.bg.obsidian,
        color: t.text.primary,
        width: '100vw',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '24px',
        textAlign: 'center',
        fontFamily: t.font.body,
      }}
    >
      <div style={{ fontFamily: t.font.rune, fontSize: '52px', color: t.ember.core }}>⟁</div>
      <div
        style={{
          fontFamily: t.font.display,
          fontSize: '18px',
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
        }}
      >
        Unknown ælder
      </div>
      <div
        style={{
          fontFamily: t.font.mono,
          fontSize: '11px',
          color: t.text.muted,
          letterSpacing: '0.18em',
        }}
      >
        agent #{id} · not in the covenant
      </div>
      <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {AGENTS.map((a) => (
          <a
            key={a.id}
            href={`/agents/${a.id}`}
            style={{
              fontFamily: t.font.body,
              fontSize: '12px',
              color: t.rune.core,
              letterSpacing: '0.12em',
              textDecoration: 'none',
              padding: '6px 12px',
              border: `1px solid ${t.border.rune}`,
              borderRadius: t.radius.md,
              background: t.bg.iron,
            }}
          >
            <span style={{ color: a.accent, marginRight: '8px' }}>{a.glyph}</span>
            ælder #{a.id} · {a.name}
          </a>
        ))}
      </div>
    </main>
  );
}

function GlobalKeyframes() {
  return (
    <style>{`
      @keyframes spinFast { to { transform: rotate(360deg); } }
      @keyframes agentSendShimmer {
        40% { transform: translateX(-100%); }
        70% { transform: translateX(100%); }
        100% { transform: translateX(100%); }
      }
      [data-testid="agent-control-page"] {
        scrollbar-width: thin;
        scrollbar-color: ${t.border.iron} transparent;
      }
      [data-testid="agent-control-page"] *::selection {
        background: ${t.ember.core};
        color: ${t.bg.obsidian};
      }
      [data-testid="agent-control-page"] textarea::placeholder {
        color: ${t.text.muted};
        opacity: 0.55;
        font-style: italic;
      }
      [data-testid="agent-control-page"] textarea:focus {
        outline: none;
      }
    `}</style>
  );
}

/** Page-level grain — finer recipe than the parchment grain (stays subtle on dark). */
const pageNoise =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>" +
  "<feColorMatrix values='0 0 0 0 0.85  0 0 0 0 0.72  0 0 0 0 0.45  0 0 0 0.045 0'/></filter>" +
  "<rect width='100%' height='100%' filter='url(%23n)'/></svg>";
