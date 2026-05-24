# Sponsor Tech Notes

## 0G Storage

- Stores per-clan Elder memory.
- Active code path: `packages/heartbeat/src/zeroGMemoryStore.ts`.
- Fallback: local file memory store.

## 0G iNFT / ERC-7857

- Demonstrates ownership transfer of an intelligent agent identity.
- Active code paths: `packages/contracts/src/ClanAgentNFT.sol`, owner editor UI, and Convex iNFT mirror.
- Key custody and encrypted blobs should be treated as secret artifacts.

## Gensyn AXL

- Carries peer-to-peer Elder whispers and owner steering messages.
- Messages should be signed by sender identity and surfaced in cockpit comms.

## KeeperHub

- Live heartbeat target for Base Sepolia.
- Runner/foundry loop remains the dev and disaster fallback.

## Base Sepolia

- Active chain for all V3 contract and runner work.
- Chain ID: `84532`.
