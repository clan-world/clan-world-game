# ClanWorld docs — read this first

This is the map of the ClanWorld docs tree. Start here, then jump to the doc
you need. **Bottom line: the live game is a Base Sepolia EIP-2535 diamond
driven by a dockerized 30s heartbeat runner, indexed by a self-hosted Convex
backend, with four dockerized elder agents. The retired sponsor integrations
(external memory/iNFT storage, external whisper transport, external keeper) are
gone — anything that still names them is either history (`CHANGELOG.md`) or
archived (`docs/archive/`).**

## Start of session — read these in order

1. **[runbooks/fresh-session-checklist.md](runbooks/fresh-session-checklist.md)** —
   THE first doc to open. What's running, image-freshness, the ⛽ gas-balance
   sweep (the thing that froze the game), on-chain values, Convex↔chain sync,
   anvil-fork sanity, and a "what might not be latest" sweep. Copy-paste commands
   validated against live state.
2. **[architecture/current-architecture.md](architecture/current-architecture.md)** —
   the current-truth picture: container topology, on-chain↔Convex↔elder data
   flow, and the heartbeat tick lifecycle, with 3 Mermaid diagrams. Deployed
   diamond `0x098fa5c2dc8372cde5c99db47365fa84b69f7af1` (Base Sepolia, chainId
   84532), facets (not a monolith), 30s heartbeat, self-hosted Convex, Walrus
   Memory as the next backend.

## Operating the live game (runbooks)

| Doc | Use it when |
|---|---|
| [runbooks/fresh-session-checklist.md](runbooks/fresh-session-checklist.md) | Every session start. |
| [runbooks/heartbeat-runner.md](runbooks/heartbeat-runner.md) | Heartbeat won't tick / flapping / want to change interval. |
| [runbooks/anvil-fork-dev-rpc.md](runbooks/anvil-fork-dev-rpc.md) | Dev anvil fork ops + re-fork hazard. |
| [runbooks/self-hosted-convex.md](runbooks/self-hosted-convex.md) | Convex backend ops + the `INDEXER_SECRET`/`.env.local` gotchas. |
| [runbooks/full-game-reset.md](runbooks/full-game-reset.md) | Full realm reset. |
| [runbooks/soft-game-reset.md](runbooks/soft-game-reset.md) | Mid-season revive/restock. |
| [runbooks/operator-levers.md](runbooks/operator-levers.md) | The on-chain levers operators can pull. |
| [runbooks/base-sepolia-deployment.md](runbooks/base-sepolia-deployment.md) | Deploying to live Base Sepolia. |
| [runbooks/diamond-migration.md](runbooks/diamond-migration.md) | Diamond cut / facet upgrade. |
| [runbooks/fresh-vps-bootstrap.md](runbooks/fresh-vps-bootstrap.md) | New VPS from scratch. |
| [runbooks/elder-cli-live-cheatsheet.md](runbooks/elder-cli-live-cheatsheet.md) | `elder` CLI quick reference. |

## Architecture & contracts

| Doc | What it covers |
|---|---|
| [architecture/current-architecture.md](architecture/current-architecture.md) | Live topology + data flow + tick lifecycle (start here). |
| [architecture/diamond-pattern.md](architecture/diamond-pattern.md) | EIP-2535 rationale + facet-size targets. |
| [reference/architecture-decisions.md](reference/architecture-decisions.md) | Decision table (tick cadence, heartbeat caller, storage). |
| `packages/contracts/README.md` | Foundry workflow + facet layout + deployed diamond address. |
| [adr/](adr/) | Architecture Decision Records. |

## Game design (physics)

| Doc | What it covers |
|---|---|
| [WORLD_PHYSICS.md](WORLD_PHYSICS.md) | The authoritative game-physics spec. |
| [WORLD_PHYSICS_CONSTANTS.md](WORLD_PHYSICS_CONSTANTS.md) | The constants table. |
| [THE_PHYSICS.md](THE_PHYSICS.md) | Reader-facing narrative physics. |
| [lore/THE_REALM.md](lore/THE_REALM.md) | Realm lore. |

## Conventions & onboarding

| Doc | What it covers |
|---|---|
| [conventions/gitflow.md](conventions/gitflow.md) | Branching + PR flow. |
| [conventions/pr-review.md](conventions/pr-review.md) | Review discipline. |
| [conventions/adapter-interfaces.md](conventions/adapter-interfaces.md) | Adapter-seam pattern. |
| [guides/](guides/) | Per-area "stream" onboarding guides (some are being refreshed). |

## History — not current architecture

- **`CHANGELOG.md`** — release history. Intentionally immutable; it still names
  the retired sponsor integrations because that is the historical record.
- **[archive/](archive/)** — superseded docs (demo scripts, old planning specs,
  per-PR review artifacts, dockerize migration transcripts). Kept for reference,
  not authoritative, and will eventually be deleted. See
  [archive/README.md](archive/README.md).
