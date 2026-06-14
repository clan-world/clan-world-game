import { motion } from 'framer-motion';
import { agentTokens as t, type AgentDef } from './agent-tokens';

interface Props {
  agent: AgentDef;
  loading: boolean;
  onConnect: () => void;
}

/**
 * Locked-out state — full-page CTA over a blurred peek of the agent panel.
 *
 * Composition:
 *   - Background = a faint, blurred silhouette of the agent (rune sigil +
 *     archetype label) so the user sees what's *behind* the lock.
 *   - Foreground = a centered ritual lockstone: ornamental brackets, the
 *     Cinzel "ÆLDER LOCKED" headline, sigil glyph, and a primary "CONNECT
 *     WALLET" button styled as hot-iron.
 *   - Three rotating rune rings give the lockstone a sense of slow,
 *     persistent ceremony.
 */
export function ConnectGate({ agent, loading, onConnect }: Props) {
  return (
    <div
      data-testid="connect-gate"
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse at top, #150f0a 0%, ${t.bg.obsidian} 60%, #050405 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: '24px',
      }}
    >
      <style>{`
        @keyframes ringSpinSlow  { from { transform: rotate(0); }       to { transform: rotate(360deg); } }
        @keyframes ringSpinSlowR { from { transform: rotate(0); }       to { transform: rotate(-360deg); } }
        @keyframes lockShine     { 0% { background-position: -120% 0; } 100% { background-position: 220% 0; } }
        @keyframes flickerBg     { 0%,100% { opacity: 0.35; } 50% { opacity: 0.55; } }
        @keyframes runeFloat     { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      `}</style>

      {/* Background blurred peek — faint silhouette of the agent identity */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          filter: 'blur(8px)',
          opacity: 0.25,
          gap: '8px',
          pointerEvents: 'none',
          animation: 'flickerBg 4s ease-in-out infinite',
        }}
      >
        <div
          style={{
            fontFamily: t.font.rune,
            fontSize: '120px',
            color: agent.accent,
            lineHeight: 1,
            textShadow: `0 0 60px ${agent.accent}`,
          }}
        >
          {agent.glyph}
        </div>
        <div
          style={{
            fontFamily: t.font.display,
            fontSize: '32px',
            color: t.text.primary,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
        >
          {agent.name}
        </div>
        <div
          style={{
            fontFamily: t.font.mono,
            fontSize: '12px',
            color: t.rune.core,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
          }}
        >
          {agent.archetype}
        </div>
      </div>

      {/* Faint scattered runes */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          fontFamily: t.font.rune,
          color: t.rune.core,
          opacity: 0.18,
          fontSize: '14px',
        }}
      >
        <span style={{ position: 'absolute', top: '8%',  left: '10%' }}>{agent.rune}</span>
        <span style={{ position: 'absolute', top: '12%', right: '8%' }}>ᚱᛏᛁ</span>
        <span style={{ position: 'absolute', bottom: '14%', left: '12%' }}>ᚦᛟᛗ</span>
        <span style={{ position: 'absolute', bottom: '18%', right: '14%' }}>{agent.rune}</span>
      </div>

      {/* Lockstone */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: 'relative',
          width: '296px',
          maxWidth: '88vw',
          padding: '32px 22px 26px',
          background:
            'linear-gradient(180deg, rgba(40,28,20,0.92) 0%, rgba(20,14,10,0.95) 100%)',
          border: `1px solid ${t.border.ironLight}`,
          borderRadius: t.radius.lg,
          boxShadow: `0 0 40px rgba(255,107,53,0.12), 0 18px 54px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,180,120,0.08)`,
          textAlign: 'center',
          zIndex: 2,
        }}
      >
        {/* Ornamental corner brackets */}
        {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
          <span
            key={corner}
            aria-hidden
            style={{
              position: 'absolute',
              width: '14px',
              height: '14px',
              borderColor: t.ember.core,
              borderStyle: 'solid',
              borderWidth: 0,
              ...(corner === 'tl' && { top: 6, left: 6, borderTopWidth: 1, borderLeftWidth: 1 }),
              ...(corner === 'tr' && { top: 6, right: 6, borderTopWidth: 1, borderRightWidth: 1 }),
              ...(corner === 'bl' && { bottom: 6, left: 6, borderBottomWidth: 1, borderLeftWidth: 1 }),
              ...(corner === 'br' && { bottom: 6, right: 6, borderBottomWidth: 1, borderRightWidth: 1 }),
              opacity: 0.7,
            }}
          />
        ))}

        {/* Rune rings */}
        <div
          aria-hidden
          style={{
            position: 'relative',
            width: '120px',
            height: '120px',
            margin: '0 auto 16px',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: `1px dashed ${t.border.rune}`,
              animation: 'ringSpinSlow 28s linear infinite',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: '10px',
              borderRadius: '50%',
              border: `1px solid ${t.border.ember}`,
              animation: 'ringSpinSlowR 18s linear infinite',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: t.font.rune,
              fontSize: '52px',
              color: agent.accent,
              textShadow: `0 0 22px ${agent.accent}`,
              animation: 'runeFloat 5s ease-in-out infinite',
            }}
          >
            {agent.glyph}
          </div>
        </div>

        <div
          style={{
            fontFamily: t.font.body,
            fontSize: '9.5px',
            color: t.rune.core,
            letterSpacing: '0.42em',
            textTransform: 'uppercase',
            marginBottom: '4px',
          }}
        >
          ælder · {String(agent.id).padStart(2, '0')} · sealed
        </div>
        <h1
          style={{
            margin: '0 0 6px',
            fontFamily: t.font.display,
            fontSize: '24px',
            color: t.text.primary,
            letterSpacing: '0.18em',
            fontWeight: 700,
            textShadow: `0 0 18px rgba(255,107,53,0.4)`,
          }}
        >
          {agent.name}
        </h1>
        <div
          style={{
            fontFamily: t.font.body,
            fontSize: '11px',
            color: t.text.secondary,
            letterSpacing: '0.16em',
            fontStyle: 'italic',
            marginBottom: '20px',
          }}
        >
          “{agent.oneLineEssence}”
        </div>

        <p
          style={{
            margin: '0 0 18px',
            fontFamily: t.font.body,
            fontSize: '11.5px',
            color: t.text.secondary,
            lineHeight: 1.55,
            letterSpacing: '0.02em',
          }}
        >
          The Ælder's NFT essence is sealed in agent memory. Connect a wallet
          bearing the matching covenant to whisper and reshape its mind.
        </p>

        <button
          data-testid="connect-wallet-btn"
          type="button"
          onClick={onConnect}
          disabled={loading}
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            width: '100%',
            padding: '13px 18px',
            background: loading
              ? `linear-gradient(180deg, ${t.ember.deep}, #4a1a08)`
              : `linear-gradient(180deg, ${t.ember.core} 0%, ${t.ember.deep} 100%)`,
            color: t.text.onEmber,
            fontFamily: t.font.display,
            fontSize: '13px',
            letterSpacing: '0.32em',
            fontWeight: 700,
            textTransform: 'uppercase',
            border: `1px solid ${t.ember.core}`,
            borderRadius: t.radius.md,
            cursor: loading ? 'wait' : 'pointer',
            boxShadow: loading
              ? 'inset 0 2px 6px rgba(0,0,0,0.5)'
              : `0 0 20px rgba(255,107,53,0.55), inset 0 1px 0 rgba(255,200,140,0.5)`,
            overflow: 'hidden',
            transition: 'transform 120ms ease, box-shadow 240ms ease',
          }}
        >
          {/* Shine sweep */}
          {!loading && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.32) 50%, transparent 70%)',
                backgroundSize: '200% 100%',
                animation: 'lockShine 2.6s ease-in-out infinite',
                pointerEvents: 'none',
              }}
            />
          )}
          <span style={{ position: 'relative' }}>
            {loading ? 'Sealing…' : 'Connect Wallet'}
          </span>
          {!loading && (
            <span aria-hidden style={{ position: 'relative', fontFamily: t.font.rune, fontSize: '14px' }}>
              ⟢
            </span>
          )}
        </button>

        <div
          style={{
            marginTop: '12px',
            fontFamily: t.font.mono,
            fontSize: '8.5px',
            color: t.text.muted,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
          }}
        >
          mock SIWS · solana mobile · no funds at risk
        </div>
      </motion.div>
    </div>
  );
}
