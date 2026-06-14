import { AnimatePresence, motion } from 'framer-motion';
import { agentTokens as t } from './agent-tokens';
import { DecryptingSkeleton } from './DecryptingSkeleton';
import { OrnamentRule } from './OrnamentRule';
import { ChatInput } from './ChatInput';
import { BurnFlash } from './BurnFlash';
import { BalanceRow } from './BalanceRow';
import { useNow } from './useNow';

export interface Whisper {
  /** Unique id (use timestamp for now). */
  id: number;
  /** Body of the whisper. */
  body: string;
  /** Wall-clock ms when sent. */
  sentAt: number;
}

interface Props {
  decrypting: boolean;
  draft: string;
  onDraftChange: (s: string) => void;
  /** Wall-clock ms when the last whisper was sent. -1 if no sends yet. */
  lastSentAt: number;
  /** Total cooldown window length. */
  cooldownTotalMs: number;
  /** Past whispers, oldest → newest. */
  feed: ReadonlyArray<Whisper>;
  /** Wall-clock ms of the most recent burn (for BurnFlash trigger). */
  lastBurnAt: number;
  /** Burn amount in the most recent send. */
  lastBurnAmount: number;
  /** Wallet balances + bounce-on-faucet animation flag. */
  gold: number;
  goldBouncing: boolean;
  faucetCooling: boolean;
  sending: boolean;
  status: { kind: 'success' | 'error'; body: string } | null;
  onSend: () => void;
  onFaucet: () => void;
}

/**
 * Whispers section — sealed-letter conversation between the NFT owner
 * and their elder. Layout (chat-like):
 *
 *   ── ÆLDER WHISPERS ──
 *   ↑ feed (scrolls, recent at bottom)
 *   ┌──────────────────────────┐
 *   │ chat input                │  ← LLM-style box with cooldown chip + send inside
 *   └──────────────────────────┘
 *   [+5 BURNED]                    ← ephemeral, fades after each send
 *   GOLD · 12,450 g   [+ DEVNET 10K]
 *   status line
 */
export function WhispersSection({
  decrypting,
  draft,
  onDraftChange,
  lastSentAt,
  cooldownTotalMs,
  feed,
  lastBurnAt,
  lastBurnAmount,
  gold,
  goldBouncing,
  faucetCooling,
  sending,
  status,
  onSend,
  onFaucet,
}: Props) {
  return (
    <section
      data-testid="whispers-section"
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(180deg, ${t.bg.obsidian} 0%, #0a0807 100%)`,
        padding: '8px 22px 16px',
        gap: '10px',
        overflow: 'hidden',
        borderTop: `1px solid ${t.border.hairline}`,
      }}
    >
      <OrnamentRule label="ÆLDER WHISPERS" glyph="ᚺᚹᛁ" />

      {decrypting ? (
        <DecryptingSkeleton height={108} label="Awakening whisper channel" />
      ) : (
        <>
          <WhisperFeed feed={feed} />

          <ChatInput
            draft={draft}
            onDraftChange={onDraftChange}
            lastSentAt={lastSentAt}
            cooldownTotalMs={cooldownTotalMs}
            gold={gold}
            sending={sending}
            onSend={onSend}
          />

          <BurnFlash triggerKey={lastBurnAt} amount={lastBurnAmount} />

          <BalanceRow
            gold={gold}
            bouncing={goldBouncing}
            faucetCooling={faucetCooling}
            onFaucet={onFaucet}
          />

          <StatusLine status={status} />
        </>
      )}
    </section>
  );
}

/* ---------- whisper feed ---------- */

function WhisperFeed({ feed }: { feed: ReadonlyArray<Whisper> }) {
  // Tick the clock so "X ago" labels stay fresh without forcing the
  // parent to re-render every second.
  const now = useNow(15_000);

  if (feed.length === 0) {
    return (
      <div
        style={{
          flex: '1 1 auto',
          minHeight: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px 0',
          fontFamily: t.font.script,
          fontStyle: 'italic',
          fontSize: '14px',
          color: t.text.muted,
          opacity: 0.7,
          textAlign: 'center',
        }}
      >
        Awaiting first whisper. Press send to write.
      </div>
    );
  }

  return (
    <div
      data-testid="whisper-feed"
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '4px 0',
        // chat: keep scroll pinned to the bottom by reversing column order
        // and reversing the feed array. Newest item ends up at the bottom.
      }}
    >
      <AnimatePresence initial={false}>
        {feed.map((w) => (
          <WhisperRow key={w.id} whisper={w} now={now} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function WhisperRow({ whisper, now }: { whisper: Whisper; now: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      style={{
        background: t.bg.iron,
        borderLeft: `2px solid ${t.ember.deep}`,
        borderRadius: `0 ${t.radius.md} ${t.radius.md} 0`,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
      }}
    >
      <div
        style={{
          fontFamily: t.font.script,
          fontStyle: 'italic',
          fontSize: '14px',
          lineHeight: 1.45,
          color: t.text.primary,
        }}
      >
        “{whisper.body}”
      </div>
      <div
        style={{
          fontFamily: t.font.mono,
          fontSize: '8.5px',
          color: t.text.muted,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
        }}
      >
        whispered {formatRelative(now - whisper.sentAt)} ago
      </div>
    </motion.div>
  );
}

/* ---------- status line ---------- */

function StatusLine({
  status,
}: {
  status: { kind: 'success' | 'error'; body: string } | null;
}) {
  return (
    <div style={{ minHeight: '14px' }}>
      <AnimatePresence>
        {status && (
          <motion.div
            key={status.body}
            data-testid={`whisper-status-${status.kind}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            style={{
              fontFamily: t.font.mono,
              fontSize: '10px',
              letterSpacing: '0.06em',
              color: status.kind === 'success' ? t.text.success : t.text.danger,
            }}
          >
            <span aria-hidden style={{ marginRight: '6px' }}>
              {status.kind === 'success' ? '✓' : '✕'}
            </span>
            {status.body}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatRelative(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}
