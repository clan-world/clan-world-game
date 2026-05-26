import { defineChain } from 'viem';

// Pure chain definition (no Node built-ins). Extracted from IChainClient.ts so
// the Convex V8 bundle can import `baseSepolia` without pulling in IChainClient's
// `node:fs` dependency (which breaks `convex deploy` bundling). The adapters
// barrel re-exports this for back-compat; Convex functions import it directly via
// `@clan-world/shared/adapters/chains`.
export const baseSepolia = defineChain({
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://sepolia.base.org'] },
  },
});
