# ClanWorld — current architecture

**BLUF:** ClanWorld runs as a set of Docker containers on the do-box VPS. A
dockerized **heartbeat runner** fires `heartbeat()` every **30 seconds** against
an **EIP-2535 diamond** on **Base Sepolia** (`0x098fa5c2dc8372cde5c99db47365fa84b69f7af1`,
chainId **84532**). A **self-hosted Convex backend** indexes the chain logs and
drives a per-tick pipeline that wakes **four dockerized elder agents**, who
submit their clans' orders back on-chain. Local dev runs against an **anvil fork**
of Base Sepolia instead of the live chain.

This doc is the current-truth picture. If another doc contradicts it (e.g. says
"60s ticks", an external keeper, or external sponsor memory storage), that doc
is stale — see [../index.md](../index.md).

## Key facts

| Fact | Value |
|---|---|
| Chain | Base Sepolia, chainId `84532` |
| Diamond (proxy) | `0x098fa5c2dc8372cde5c99db47365fa84b69f7af1` |
| Contract shape | **EIP-2535 diamond** — selectors route to small facets. There is **no monolithic `ClanWorld.sol`** deployed; reason about behavior via the facets / `DiamondLoupeFacet`, not the `ClanWorld.sol` source stub. |
| Heartbeat interval | **30s** (`heartbeatIntervalSeconds()` on-chain; owner-settable via `setHeartbeatIntervalSeconds(uint64)` on `HeartbeatConfigFacet`). |
| Gather yields | **2x** (doubled WOOD/IRON/WHEAT/FISH) — inlined in `LibSettlement`; changing them needs a recompile + diamondCut REPLACE, not a runtime setter. |
| Convex | **Self-hosted** backend container `clan-world-convex-backend-1`, not Convex Cloud. |
| Elders | 4 Claude TUIs in `clan-world-elder-1` .. `clan-world-elder-4`. |
| Heartbeat runner | `clan-world-heartbeat-1` (source: `packages/heartbeat`). |
| Dev chain | `clan-world-anvil-fork-1` — an anvil fork of Base Sepolia (still reports chainId `84532`). |
| Memory backend | Interim **file-backed** stores (`FileMemoryStore`, `FilePeerInbox`). **Walrus Memory** (encrypted agent memory on Sui) is the planned next backend, replacing the retired sponsor memory/iNFT integration. |

### Deployed facets (from the loupe)

`AdminRecoveryFacet`, `BanditViewsFacet`, `BlueprintTransferFacet`,
`BundleTransferFacet`, `ClanFullViewFacet`, `ClanLifecycleFacet`,
`ClanOwnershipFacet`, `DerivedViewsFacet`, `DiamondCutFacet`,
`DiamondLoupeFacet`, `DirectTransfersFacet`, `FinalizeSeasonFacet`,
`GoldTransferFacet`, **`HeartbeatConfigFacet`** (interval/cooldown setters),
**`HeartbeatFacet`** (the `heartbeat()` tick), `MarketViewsFacet`,
`OwnershipFacet`, `QuoteViewsFacet`, `RawBanditViewsFacet`, `RawClanViewsFacet`,
`RawTreasuryViewsFacet`, `RawWorldViewsFacet`, `RegionViewsFacet`,
`ScoringViewsFacet`, `SettlementFacet`, `SnapshotViewsFacet`,
**`SubmitOrdersFacet`** (elder order submission), `TreasuryFacet`,
`VaultResourceTransferFacet`, `WorldPauseFacet`.

> Verify live: `cast call <diamond> 'facets()((address,bytes4[])[])' --rpc-url <rpc>`.

## (1) Container topology

```mermaid
graph TB
  subgraph host["do-box VPS"]
    cf["cloudflared"] --> caddy["clan-world-caddy-1"]
    caddy --> web["apps/web — cockpit + game UI"]
    caddy -->|"/elder-N/ ttyd"| elders

    subgraph elders["elder agents (Claude TUIs)"]
      e1["clan-world-elder-1"]
      e2["clan-world-elder-2"]
      e3["clan-world-elder-3"]
      e4["clan-world-elder-4"]
    end

    cvx["clan-world-convex-backend-1<br/>(self-hosted Convex:<br/>indexer + tick clock)"]
    hb["clan-world-heartbeat-1<br/>(packages/heartbeat runner)"]
    anvil["clan-world-anvil-fork-1<br/>(dev only — anvil fork)"]
  end

  chain[("Base Sepolia diamond<br/>0x098fa5c2…7af1 (84532)")]

  hb -->|"heartbeat() every 30s"| chainOrFork
  cvx -->|"indexes logs (poll every 3s)"| chainOrFork
  e1 & e2 & e3 & e4 -->|"submit orders (elder CLI)"| chainOrFork
  cvx -->|"per-tick driver wakes elders<br/>(tmux send-keys)"| elders

  chainOrFork{{"RPC target"}}
  chainOrFork -->|"prod (CHAIN_NETWORK=prod)"| chain
  chainOrFork -->|"dev (CHAIN_NETWORK=dev)"| anvil
  anvil -.->|"forks state from"| chain
```

In **dev**, the heartbeat runner / Convex indexer / elders all point at
`clan-world-anvil-fork-1` (`DEV_RPC_URL=http://anvil-fork:8545`). In **prod**
they point at live Base Sepolia (`PROD_RPC_URL`). The container picks the RPC
from `CHAIN_NETWORK` (`dev` | `prod`).

## (2) On-chain ↔ Convex ↔ elder data flow

```mermaid
flowchart LR
  hb["heartbeat runner"] -->|"heartbeat() tx (30s)"| diamond["diamond"]
  diamond -->|"advances tick,<br/>seeds randomness,<br/>emits logs"| logs[("chain logs")]

  subgraph convex["self-hosted Convex backend"]
    poller["real-indexer-log-poller<br/>(cron, every 3s)"]
    poller -->|"persists"| chk["chainEvents +<br/>eventCheckpoint"]
    chk --> proj["snapshot / projection<br/>(worldSnapshot)"]
    driver["per-tick driver"]
    driver --> trl["tickReceiveLog<br/>(per elder)"]
  end

  logs --> poller
  proj --> driver
  driver -->|"composeSituationBlock +<br/>tmux send-keys"| elder["elder-N (Claude TUI)"]
  elder -->|"elder CLI:<br/>submit orders"| diamond
```

The Convex indexer registers three crons (see `apps/server/convex/INDEXER.md`):
`real-indexer-log-poller` (every 3s, persists `chainEvents`/`eventCheckpoint`),
`real-indexer-snapshot-refresh-fallback` (every 60s), and
`real-indexer-poller-watchdog` (every 60s, reads the `pollerHealth` singleton).
`eventCheckpoint` is the indexer's high-water block; `tickReceiveLog` records the
last tick each elder was driven with.

## (3) Heartbeat tick lifecycle

```mermaid
sequenceDiagram
  participant R as heartbeat runner
  participant D as diamond (HeartbeatFacet)
  participant C as Convex indexer
  participant E as elder-N

  R->>D: read getWorldState().nextHeartbeatAtTs
  Note over R: wait until now ≥ nextHeartbeatAtTs + safety margin (1500ms)<br/>(no early fire — clears the auto-mine boundary on a fork)
  R->>D: heartbeat()
  alt due (block.timestamp ≥ nextHeartbeatAtTs) AND runner funded
    D-->>R: tx confirmed → tick advances, randomness seeded, logs emitted
    R->>R: write /tmp/last-heartbeat-success (healthcheck marker)
  else fired early → revert "heartbeat rate limited"
    D-->>R: revert
    Note over R: re-read nextHeartbeatAtTs, sleep until due+margin,<br/>retry IN-WINDOW (do not consume failure-retry budget)
  else runner out of gas
    D-->>R: revert with EMPTY 0x data
    Note over R: eth_call simulation SUCCEEDS but tx reverts empty ⇒ insufficient funds.<br/>This is the #652 freeze — top up the runner wallet (see runbooks/heartbeat-runner.md).
  end
  D-->>C: logs polled (every 3s) → eventCheckpoint advances
  C->>E: driver composes situation block → tmux send-keys
  E->>D: elder reasons, submits clan orders (cooldown 60s per clansman)
  Note over R,E: loop repeats every 30s
```

> **Fork caveat:** on the anvil fork, `block.timestamp` does **not** track
> wall-clock on its own — it advances per mined tx / explicit time-jump. A naive
> "fire when wall ≥ target" scheduler can hot-loop (fire → revert → fire) while
> chain time stays below target. The runner handles this on the fork; details +
> the full #652 root-cause are in [../runbooks/heartbeat-runner.md](../runbooks/heartbeat-runner.md).

## Related

- [../runbooks/fresh-session-checklist.md](../runbooks/fresh-session-checklist.md) — verify all of the above against live state.
- [../runbooks/heartbeat-runner.md](../runbooks/heartbeat-runner.md) — heartbeat ops + failure modes.
- [diamond-pattern.md](diamond-pattern.md) — EIP-2535 design rationale.
- `apps/server/convex/INDEXER.md` — indexer crons + `eventCheckpoint` semantics.
