import React from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { SuiWalletConnectors } from '@dynamic-labs/sui';
import App from './App';
import './index.css';

// environmentId is injected at build time. Empty during local dev is fine —
// the wallet widget renders but auth is gated until a real ID is supplied.
const environmentId = import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID ?? '';

if (!environmentId) {
  // Surface a broken build clearly: with no environment ID the Dynamic wallet
  // never initializes, so the mint flow silently can't connect a wallet.
  console.error(
    'VITE_DYNAMIC_ENVIRONMENT_ID is not set — the Dynamic wallet will not ' +
      'initialize and minting will be unavailable. Set it before building.',
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DynamicContextProvider
      settings={{
        environmentId,
        walletConnectors: [SuiWalletConnectors],
      }}
    >
      <App />
    </DynamicContextProvider>
  </React.StrictMode>,
);
