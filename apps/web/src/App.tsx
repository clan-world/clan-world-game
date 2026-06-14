import { Component } from 'react';
import type { ReactNode } from 'react';
import { Cockpit } from './pages/Cockpit';
import { AgentControlPage } from './pages/agent/AgentControlPage';
import { WorldMapEmbed } from './components/WorldMapEmbed';

class CockpitErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  override state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  override componentDidCatch(error: unknown, info: unknown) {
    console.error('[Cockpit] uncaught error — full panel crash:', error, info);
  }
  override render() {
    if (this.state.hasError) {
      return (
        <main
          className="cw-fullheight"
          style={{
            background: '#0a0a0a',
            width: '100vw',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '16px',
            color: 'white',
            fontFamily: 'monospace',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '32px', opacity: 0.5 }}>◈</div>
          <div style={{ fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            Cockpit offline
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: '4px',
              background: 'transparent',
              color: 'rgba(255,255,255,0.7)',
              fontFamily: 'monospace',
              fontSize: '11px',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Tap to reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

// Env flags moved to ./config/env to break the WorldMap ↔ App circular
// dependency (PR #133 review MUST FIX #3). Re-exported here for any external
// callers; new internal callers should import directly from ./config/env.
import { DEMO_MODE } from './config/env';
export { DEMO_MODE };

/**
 * Top-level route decision. Lightweight path-based routing avoids a router
 * dep for a single side route. Reading window.location once at render is
 * fine here — the cockpit is the default surface and the world map lives
 * on `/map`, so we never need client-side navigation between them.
 */
function isMapRoute(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.location.pathname === '/map' ||
      window.location.pathname.startsWith('/map/'))
  );
}

function isRootRoute(): boolean {
  return typeof window !== 'undefined' && window.location.pathname === '/';
}

function isLegacyCockpitRoute(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.location.pathname === '/cockpit' ||
      window.location.pathname.startsWith('/cockpit/'))
  );
}

/**
 * /agents/:agentId — single-agent control page (mobile-portrait first).
 * Pure mock — no real Solana wallet, no Convex. Routed here BEFORE any
 * World-App / IDKit hooks fire so it works in a plain browser tab.
 */
function parseAgentRoute(): number | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/^\/agents\/(\d+)\/?$/);
  const raw = m?.[1];
  if (!raw) return null;
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

export function App() {
  if (isLegacyCockpitRoute()) {
    if (typeof window !== 'undefined') {
      window.location.replace(`/${window.location.search}${window.location.hash}`);
    }
    return null;
  }
  if (isRootRoute()) {
    return (
      <CockpitErrorBoundary>
        <Cockpit />
      </CockpitErrorBoundary>
    );
  }
  if (isMapRoute()) {
    return <MainApp />;
  }
  const agentId = parseAgentRoute();
  if (agentId !== null) {
    return (
      <CockpitErrorBoundary>
        <AgentControlPage agentId={agentId} />
      </CockpitErrorBoundary>
    );
  }
  return <MainApp />;
}

function MainApp() {
  return (
    <main
      className="cw-fullheight"
      style={{
        background: '#0a0a0a',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <WorldMapEmbed />
    </main>
  );
}
