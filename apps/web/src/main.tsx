import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { App } from './App';
import './styles/viewport.css';

// Telegram Mini App fullscreen: hide the platform top chrome (the bar that
// shows the app title + V down-arrow). Available in Telegram Mini App API
// v8.0+. Falls back to expand() on older clients. Wrapped in try/catch so a
// missing API or unsupported platform never blocks render.
type TgWebApp = {
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => void;
  isVersionAtLeast?: (v: string) => boolean;
};
const tg: TgWebApp | undefined = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
if (tg) {
  try {
    tg.ready?.();
    tg.expand?.();
    if (tg.isVersionAtLeast?.('8.0') && tg.requestFullscreen) {
      tg.requestFullscreen();
    } else if (tg.requestFullscreen) {
      // Some builds don't expose isVersionAtLeast — try anyway, swallow errors.
      try { tg.requestFullscreen(); } catch { /* unsupported */ }
    }
  } catch (err) {
    console.warn('Telegram WebApp fullscreen init failed:', err);
  }
}

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;

// Cast required: convex's React.FC type conflicts with @types/react@18.3 ReactNode (bigint addition)
const Provider = ConvexProvider as React.ComponentType<{
  client: ConvexReactClient;
  children?: React.ReactNode;
}>;

const root = ReactDOM.createRoot(document.getElementById('root')!);

// The cockpit (now at `/`), `/map`, `/cockpit`, `/owner`, and `/agents/:id`
// are standalone surfaces — always render them, even if Convex env is
// missing. The Phase-A panels are pure placeholders; the embedded
// WorldMap consumes Convex via useQuery which returns undefined when no
// data is available, so a stub client is enough to satisfy the provider.
//
// `/agents/:id` (PR #9) + `/owner` (PR #14) are also Convex-free: they
// render without any useQuery/useMutation calls, so the stub provider is
// sufficient. Without these exemptions, screenshot/dev environments
// without VITE_CONVEX_URL render "Backend not configured" instead of the
// actual page.
const pathname =
  typeof window !== 'undefined' ? window.location.pathname : '';
// Match the actual route shapes defined in App.tsx:
//   /                 → Cockpit
//   /map              → MainApp / WorldMap
//   /cockpit          → legacy alias → redirect to /
//   /owner            → isOwnerRoute   (startsWith '/owner')
//   /agents/:digits   → parseAgentRoute (regex /^\/agents\/(\d+)\/?$/)
// Bare `/agents` is NOT a real route in App.tsx — it falls through to
// MainApp (the WorldMap), which DOES need Convex. So `/agents` must only
// be treated as standalone when followed by a digit segment.
const isStandalonePath =
  pathname === '/' ||
  pathname === '/map' ||
  pathname.startsWith('/map/') ||
  pathname === '/cockpit' ||
  pathname.startsWith('/cockpit/') ||
  pathname === '/owner' ||
  pathname.startsWith('/owner/') ||
  /^\/agents\/\d+\/?$/.test(pathname);

if (!convexUrl && !isStandalonePath) {
  // Fail soft instead of throwing — a thrown error here leaves a blank page,
  // which is unacceptable for the hackathon submission. Render a visible
  // message so the user sees something even if the build is misconfigured.
  console.error('VITE_CONVEX_URL is not set — rendering degraded fallback');
  root.render(
    <main
      className="cw-fullheight-min"
      style={{
        background: '#0d1a0d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          color: 'white',
          fontFamily: 'monospace',
          maxWidth: '420px',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '20px', lineHeight: 1.2 }}>
          Clan World
          <div style={{ fontSize: '14px', fontStyle: 'italic', opacity: 0.7, marginTop: '2px' }}>
            Ælder Whispers
          </div>
        </h1>
        <p style={{ marginTop: '12px', opacity: 0.8 }}>
          Backend not configured. Contact the team.
        </p>
      </div>
    </main>,
  );
} else {
  // Use an RFC 5737 documentation IP when env is missing on the cockpit
  // route. The Convex client requires a URL at construction time; pointing
  // it at an unroutable address is harmless for the read-only stub view —
  // useQuery will simply return undefined forever, which the cockpit's
  // placeholder content already handles gracefully.
  // PR #133 review SHOULD FIX (Copilot): use `||` not `??` so an EMPTY string
  // VITE_CONVEX_URL also falls back. `??` only handles null/undefined and
  // would let `''` through, breaking ConvexReactClient construction.
  const convex = new ConvexReactClient(convexUrl || 'https://203.0.113.1');
  root.render(
    <React.StrictMode>
      <Provider client={convex}>
        <App />
      </Provider>
    </React.StrictMode>,
  );
}
