# @clan-world/contracts

Solidity contracts for ClanWorld. The canonical interface is `src/IClanWorld.sol` — every other component (frontend, backend, orchestrator, agents) talks to the chain through this seam. See `docs/adr/ADR001-IClanWorld-as-web2-web3-integration-seam.md`.

Contracts deploy to **Base Sepolia** (chainId `84532`) for the active ClanWorld V3 build. The deployed **EIP-2535 diamond** is `0x098fa5c2dc8372cde5c99db47365fa84b69f7af1`. Heartbeat is driven by the dockerized `packages/heartbeat` runner (30s, owner-settable via `setHeartbeatIntervalSeconds` on `HeartbeatConfigFacet`) — not an external keeper.

## Workflow

```bash
forge build
forge test
forge script script/DeployDiamond.s.sol --rpc-url $RPC_URL_PRIMARY --broadcast
```

## Layout

- `src/IClanWorld.sol` — canonical seam interface (24KB, do not modify without ADR)
- `src/diamond/facets/` — EIP-2535 facets installed by `script/DeployDiamond.s.sol`
- `src/diamond/lib/` — shared diamond libraries; large public library functions are linked as deployed libraries
- `foundry.toml` — Foundry config; reads `RPC_URL_PRIMARY` from env

## Diamond Size Snapshot

Latest `forge build --sizes` production diamond pieces:

- 25 deployed facets, 172,776 bytes total facet runtime.
- 12 linked runtime libraries, 121,826 bytes total deployed library runtime.
- Closest deployed unit: `LibBundleTransfer` at 24,499 bytes, 77 bytes under EIP-170.
- Closest facet: `HeartbeatFacet` at 24,033 bytes, 543 bytes under EIP-170.
- Direct OTC transfer selectors are consolidated in `DirectTransfersFacet` and delegate to `LibDirectTransfers` plus `LibBundleTransfer`.
- `DeployDiamond.s.sol` links those transfer libraries automatically; run `DEPLOYER_PRIVATE_KEY=1 bash scripts/forge.sh script script/DeployDiamond.s.sol` as the no-broadcast link/deploy dry run.

Production facets:

`BanditViewsFacet`, `ClanFullViewFacet`, `ClanLifecycleFacet`, `ClanOwnershipFacet`, `DerivedViewsFacet`, `DiamondCutFacet`, `DiamondLoupeFacet`, `DirectTransfersFacet`, `FinalizeSeasonFacet`, `HeartbeatConfigFacet`, `HeartbeatFacet`, `MarketViewsFacet`, `OwnershipFacet`, `QuoteViewsFacet`, `RawBanditViewsFacet`, `RawClanViewsFacet`, `RawTreasuryViewsFacet`, `RawWorldViewsFacet`, `RegionViewsFacet`, `ScoringViewsFacet`, `SettlementFacet`, `SnapshotViewsFacet`, `SubmitOrdersFacet`, `TreasuryFacet`, `WorldPauseFacet`.

Linked runtime libraries:

`LibBanditCombat`, `LibBanditLifecycle`, `LibBanditSpawning`, `LibBundleTransfer`, `LibDirectTransfers`, `LibOrderDefenders`, `LibOrderMarket`, `LibOrderTravel`, `LibOrderUpgrades`, `LibSubmitOrderProcessing`, `LibSubmitOrderValidation`, `LibSubmitOrders`.

## World Pause Policy

`pauseWorld()` is a true game-time freeze. While paused, gameplay entrypoints that advance ticks, settle state, alter player-owned clans, or commit ranking inputs revert with `ClanWorld: world paused`.

Blocked during pause:

- `heartbeat`
- `settleClan`, `settleClansman`
- `submitClanOrders`
- `mintClan`
- `transferClanOwnership`
- `transferGold`, `transferVaultResource`, `transferBlueprint`, `transferBundle`
- treasury writes: `initTreasury`, `seedPools`
- `finalizeSeason`

Allowed during pause, owner only:

- `triggerBanditSpawn` — queues a spawn for the first post-unpause heartbeat; no bandit spawns until the clock resumes
- `setHeartbeatIntervalSeconds`
- `setClansmanCooldownSeconds`
- ownership/admin controls such as `transferOwnership` and `diamondCut`

Rationale: queued admin actions that do not advance ticks are allowed so operators can stage recovery safely. Gameplay state changes and deterministic season/ranking commits are blocked until `unpauseWorld()` resumes the clock.

See `../../docs/guides/stream-contracts.md` for the full deploy workflow.
