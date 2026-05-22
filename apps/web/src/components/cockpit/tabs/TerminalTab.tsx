import { tokens } from '../../../styles/cockpit-tokens';
import type { ElderDef } from '../../../styles/cockpit-tokens';
import {
  useTerminalFrameReconnect,
  type TerminalFrameStatus,
} from '../../../hooks/useTerminalFrameReconnect';

interface Props {
  elder: ElderDef;
  testIdPrefix: string;
}

/**
 * Terminal tab — live ttyd iframe pointing at this Elder's tmux mirror.
 *
 * The iframe loads `https://app.clan-world.com/elder-{N}/`, which is
 * served by Caddy in front of the elder-N container's ttyd port. ttyd renders the
 * Elder's tmux session as a read-only WebSocket-fed terminal in the browser.
 *
 * If the upstream service is down, the iframe will show the browser's
 * default connection-refused chrome — the global ConnectionPill in the
 * cockpit header is responsible for surfacing connection state to the user.
 *
 * `sandbox="allow-scripts allow-same-origin"` is required because ttyd
 * upgrades to a WebSocket on the same origin; stripping `allow-same-origin`
 * breaks the WS handshake.
 */
export function TerminalTab({ elder, testIdPrefix }: Props) {
  const url = `https://app.clan-world.com/elder-${elder.clanId}/`;
  const { src, status, reconnectNow, onFrameLoad } = useTerminalFrameReconnect({
    baseUrl: url,
    clanId: elder.clanId,
  });
  const showOverlay = status !== 'connected';

  return (
    <div
      data-testid={`${testIdPrefix}-content-terminal`}
      data-terminal-status={status}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: '#000',
        minHeight: 0,
        position: 'relative',
      }}
    >
      <div
        style={{
          color: tokens.text.onIronDim,
          fontSize: '9px',
          letterSpacing: '0.15em',
          padding: `4px ${tokens.space.md}`,
          textTransform: 'uppercase',
          fontFamily: tokens.font.mono,
          background: tokens.bg.ironDeep,
          borderBottom: `1px solid ${tokens.border.iron}`,
          flexShrink: 0,
        }}
      >
        ── Elder-{elder.clanId} tmux mirror (read-only) ──
      </div>
      <iframe
        key={src}
        src={src}
        title={`Elder ${elder.clanId} tmux mirror`}
        className="cockpit-terminal-iframe"
        loading="lazy"
        onLoad={onFrameLoad}
        sandbox="allow-scripts allow-same-origin"
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          background: '#000',
        }}
      />
      {showOverlay && (
        <TerminalReconnectOverlay
          status={status}
          testIdPrefix={testIdPrefix}
          onReconnect={reconnectNow}
        />
      )}
    </div>
  );
}

interface OverlayProps {
  status: TerminalFrameStatus;
  testIdPrefix: string;
  onReconnect: () => void;
}

const STATUS_COPY: Record<TerminalFrameStatus, string> = {
  connecting: 'connecting',
  connected: 'connected',
  reconnecting: 'reconnecting',
  disconnected: 'disconnected',
};

function TerminalReconnectOverlay({ status, testIdPrefix, onReconnect }: OverlayProps) {
  return (
    <div
      data-testid={`${testIdPrefix}-terminal-reconnect-overlay`}
      data-status={status}
      style={{
        position: 'absolute',
        right: tokens.space.sm,
        bottom: tokens.space.sm,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 8px',
        border: `1px solid ${tokens.border.iron}`,
        borderRadius: tokens.radius.sm,
        background: 'rgba(0,0,0,0.82)',
        color: tokens.text.onIron,
        fontFamily: tokens.font.mono,
        fontSize: '10px',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        pointerEvents: 'auto',
      }}
      aria-live="polite"
    >
      <span>{STATUS_COPY[status]}</span>
      {status === 'disconnected' && (
        <button
          type="button"
          onClick={onReconnect}
          style={{
            border: `1px solid ${tokens.border.ironLight}`,
            borderRadius: tokens.radius.sm,
            background: 'transparent',
            color: tokens.text.accent,
            cursor: 'pointer',
            fontFamily: tokens.font.mono,
            fontSize: '10px',
            padding: '2px 6px',
            textTransform: 'uppercase',
          }}
        >
          Reconnect
        </button>
      )}
    </div>
  );
}
