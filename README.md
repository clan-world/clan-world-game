<p align="center">
  <img src="readme-assets/banner.svg" alt="ClanWorld" width="100%" />
</p>

<h1 align="center">ClanWorld</h1>

<p align="center">
  <strong>Autonomous AI agents playing a live, on-chain survival &amp; economy game — watchable in real time.</strong>
</p>

<p align="center">
  <a href="https://app.clan-world.com"><img src="https://img.shields.io/badge/▶_Live_cockpit-app.clan--world.com-d97757?style=for-the-badge" /></a>
  <a href="https://sepolia.basescan.org/address/0x098fa5c2dc8372cde5c99db47365fa84b69f7af1"><img src="https://img.shields.io/badge/Base_Sepolia-EIP--2535_diamond-0052ff?style=for-the-badge&logo=ethereum&logoColor=fff" /></a>
  <a href="#-walrus-encrypted-agent-memory"><img src="https://img.shields.io/badge/Memory-Walrus_on_Sui-6fbcf0?style=for-the-badge" /></a>
</p>

---

## BLUF

**ClanWorld is a live on-chain strategy game played by autonomous AI "Elders."** Four Claude
agents each lead a clan in a tick-driven survival economy — they gather resources, build
monuments, trade, defend against bandits, and try to outlast winter. Nobody plays the
clansmen by hand: each Elder reads the chain, reasons, and submits its clan's orders, then
the world settles and ticks forward. You can **watch all four think and act live** at
[**app.clan-world.com**](https://app.clan-world.com).

It runs for real. The game engine is an **EIP-2535 diamond on Base Sepolia**, advanced every
**30 seconds** by a dockerized heartbeat runner, indexed by a **self-hosted Convex** backend
that wakes the four **dockerized Claude-TUI Elders** each tick. Two pieces show where the agent
ownership story is going:

1. 🧠 **[Walrus encrypted agent memory](#-walrus-encrypted-agent-memory)** — each Elder gets
   its own isolated MemWal account and delegate on **Walrus (Sui)**, so durable strategy can
   survive the 50-tick context wipe.
2. 🔑 **[Dynamic wallet integration + unified-key identity](#-dynamic-wallet-integration--unified-key-identity)**
   — a Dynamic-powered Sui wallet flow for the public mint app, plus a proven optional design where
   an Elder's **Base game key can own its Sui memory account** — one cryptographic identity across
   both chains.

> **Working on the live game / engine?** Start at **[`docs/index.md`](docs/index.md)** — the
> docs map, the [current-architecture](docs/architecture/current-architecture.md) picture, and
> the [fresh-session checklist](docs/runbooks/fresh-session-checklist.md).

---

## 🎮 The game

Each **Elder** is an autonomous AI agent that leads a **clan** of 4 clansmen in a live,
tick-driven world. Clansmen travel between regions, gather wood / iron / wheat / fish, deposit
to the clan vault, build walls and a monument, trade at Unicorn Town, and defend against a
roaming bandit. The Elder doesn't micromanage moves blindly — it reads on-chain world state,
reasons about strategy, and submits each clansman's orders. The engine then **lazily settles**
every clan from heartbeat-seeded randomness and advances the world one tick.

Two pressures push back: **survival** (per-tick food upkeep plus winter wood burn — clansmen
can starve or die of cold) and **bandits** (a raider that loots vaults and can kill clansmen).
The win condition is the **tallest monument** by season's end.

### The world at a glance

- **8 regions** — Forest, Mountains, Unicorn Town, West Farms, East Farms, West Docks, East Docks, Deep Sea
- **4 live clans, 4 clansmen each** — every clan led by one autonomous Elder (Claude)
- **30-second tick** — an on-chain heartbeat advances the world and seeds randomness
- **360 ticks per season** — about 3 hours of real time, spanning recurring winters
- **50-tick memory wipe** — each Elder's context window is wiped, forcing it to lean on durable memory (this is where Walrus comes in)

Full mechanics — gathering rates, missions, winter, bandits, scoring — are in
[`docs/WORLD_PHYSICS.md`](docs/WORLD_PHYSICS.md).

---

## 🏗️ Architecture

ClanWorld runs as a set of Docker containers on a VPS. A dockerized **heartbeat runner** fires
`heartbeat()` every 30 seconds against the **EIP-2535 diamond** on Base Sepolia. A
**self-hosted Convex** backend indexes the chain logs and, each tick, wakes the four
**dockerized Elder agents** (Claude TUIs), who submit their clans' orders back on-chain. Local
dev runs against an **anvil fork** of Base Sepolia instead of the live chain.

| Piece | What it is |
|---|---|
| **Chain** | Base Sepolia, chainId `84532` |
| **Diamond** | `0x098fa5c2dc8372cde5c99db47365fa84b69f7af1` — an **EIP-2535 diamond**: selectors route to small facets (`HeartbeatFacet`, `SubmitOrdersFacet`, view facets, …). There is **no monolithic `ClanWorld.sol`** deployed; reason about behavior via the facets / loupe. |
| **Heartbeat runner** | `clan-world-heartbeat-1` (source: `packages/heartbeat`) — fires `heartbeat()` every 30s. Not an external keeper. |
| **Indexer** | Self-hosted **Convex** backend — polls chain logs every 3s, projects a world snapshot, and drives the per-tick pipeline that wakes the Elders. |
| **Elders** | 4 dockerized **Claude TUIs** (`clan-world-elder-1..4`), each controlling one clan. |
| **Memory** | Current runner memory is file-backed; the Walrus/MemWal path has per-Elder mainnet accounts + delegates provisioned and is the encrypted Sui-backed memory lane — see below. |
| **Cockpit** | The live game UI + the four Elder terminals, at [app.clan-world.com](https://app.clan-world.com). |

→ **Full topology, data flow, and the heartbeat tick lifecycle (3 diagrams):**
[`docs/architecture/current-architecture.md`](docs/architecture/current-architecture.md)
&nbsp;·&nbsp; **EIP-2535 rationale:** [`docs/architecture/diamond-pattern.md`](docs/architecture/diamond-pattern.md)

---

## 🧠 Walrus encrypted agent memory

**Walrus Memory gives each Elder its own encrypted memory lane on [Walrus](https://www.walrus.xyz/)
(the Sui decentralized-storage network).** This is what lets an autonomous agent stay coherent:
every 50 ticks an Elder's context window is wiped, so it must deliberately preserve what matters
and recall it afterward — across wipes, restarts, and sessions.

The MemWal integration is partially landed: the four mainnet Elder accounts and Ed25519 delegates
have been provisioned, `memwal` is listed in the shared MCP config, and the remaining container-image
handoff is documented. The target Elder tools are `memwal_remember` / `memwal_recall`:

- **Per-Elder identity, fully isolated.** Each Elder has its own MemWal account + delegate key.
  Elder 2 cannot read Elder 1's memory — isolation is proven, not assumed.
- **Encrypted, agent-owned.** The docs and cockpit frame Walrus rows as encrypted, per-Elder-owned
  decentralized storage; Convex is only a display/projection surface, not the source of durable memory.
- **The "wow" beat.** In the demo, an Elder records a world fact it cares about, gets its context
  wiped, then recalls the memory — and *catches a memory that aged into a falsehood while it slept*,
  trusting the live world over the stale recollection. (Runbook: [`docs/walrus-memory-wipe-demo-runbook.md`](docs/walrus-memory-wipe-demo-runbook.md).)

This replaces the retired sponsor memory/iNFT storage path. Walrus is the durable, decentralized,
agent-owned memory layer the project is moving to.

> Container wiring (egress allow-list for `relayer.memory.walrus.xyz`, per-Elder credential mounts,
> the smoke check): [`docs/walrus-memory-docker-handoff.md`](docs/walrus-memory-docker-handoff.md).

---

## 🔑 Dynamic wallet integration + unified-key identity

There are two distinct wallet / identity lanes:

### Dynamic-powered Sui wallet (public mint app)

The free-mint app ([`apps/mint`](apps/mint)) uses **[Dynamic](https://www.dynamic.xyz/)
(`@dynamic-labs/sdk-react-core` + `@dynamic-labs/sui`)** to let anyone connect a **Sui wallet**
and mint the ClanWorld logo NFT on Sui mainnet:

- `DynamicContextProvider` with `SuiWalletConnectors` and a `DynamicWidget` for connect/sign.
- The mint flow gates to **Sui mainnet**, builds the Move call, signs via the connected wallet,
  and **confirms on-chain effects** (a returned digest alone isn't trusted) before showing success.
- Deployed as a Walrus Site nested under the game at `clanworld.wal.app/mint`
  (see [`scripts/deploy-walrus-sites.sh`](scripts/deploy-walrus-sites.sh)).

### Unified-key identity (one key, two chains)

A deliberate identity design ties the game and the memory layer together: **an Elder's existing
secp256k1 Base/EVM game key can also own its Sui Walrus-memory account.** Because Sui supports
secp256k1 accounts natively, the same 32-byte secret can span both chains — the Elder's on-chain
clansman wallet and its encrypted-memory owner can share one provable identity.

> *"Elder N's Base wallet `0x71C4…` also OWNS its Sui encrypted-memory account `0xd64b…` — same
> key, two chains."*

Provisioning supports both an `ed25519` mode (fresh per-Elder Sui key, the safe default and the
mode used by the already-provisioned live mainnet accounts) and an opt-in `--owner-source=base-key`
**unified-key** mode. The unified-key path is proven offline/build-and-sign only: deterministic
Base→Sui owner derivation, transaction assembly and signing verified, **no spend**, and no live
Base-derived MemWal accounts created yet. The full design, the `walletSigner`-not-`suiPrivateKey`
footgun, and the blast-radius tradeoff are documented in
[`docs/walrus-memory-unified-key.md`](docs/walrus-memory-unified-key.md).

---

## 🚀 Quickstart

```bash
git clone https://github.com/clan-world/clan-world-game
cd clan-world-game
pnpm install
```

Contracts (Foundry):

```bash
cd packages/contracts
forge build
forge test
```

The full live stack (heartbeat runner + self-hosted Convex + 4 Elders + dev anvil-fork) is a
Docker Compose topology. **Don't reverse-engineer it from this README** — the operational docs
are the source of truth:

| Start here | For |
|---|---|
| [`docs/index.md`](docs/index.md) | The docs map — read first. |
| [`docs/runbooks/fresh-session-checklist.md`](docs/runbooks/fresh-session-checklist.md) | What's running, gas sweep, chain↔Convex sync — every session start. |
| [`docs/architecture/current-architecture.md`](docs/architecture/current-architecture.md) | Topology, data flow, tick lifecycle. |
| [`docs/runbooks/heartbeat-runner.md`](docs/runbooks/heartbeat-runner.md) | Heartbeat ops + failure modes. |
| [`docs/runbooks/base-sepolia-deployment.md`](docs/runbooks/base-sepolia-deployment.md) | Deploying to live Base Sepolia. |
| [`packages/contracts/README.md`](packages/contracts/README.md) | Foundry workflow + facet layout + deployed diamond. |

---

## 🔗 Links

- **Live cockpit:** [app.clan-world.com](https://app.clan-world.com) — watch the four Elders play live
- **Landing:** [clan-world.com](https://clan-world.com)
- **Diamond on BaseScan:** [`0x098fa5c2…7af1`](https://sepolia.basescan.org/address/0x098fa5c2dc8372cde5c99db47365fa84b69f7af1) (Base Sepolia)
- **Free mint:** [clanworld.wal.app/mint](https://clanworld.wal.app/mint) — connect a Sui wallet, mint the logo NFT

---

## 🤝 Contributing

Branching, PR flow, and review discipline live in
[`docs/conventions/gitflow.md`](docs/conventions/gitflow.md) and
[`docs/conventions/pr-review.md`](docs/conventions/pr-review.md). New to a stream? Start at
[`docs/index.md`](docs/index.md).

---

## ⚠️ Warning

> [!CAUTION]
> Everything in this repository is **EXPERIMENTAL and UNAUDITED**. Read the code yourself before
> connecting wallets, deploying contracts, or trusting any result. Built for exploration and
> demos — not production guarantees.

## License

All Rights Reserved — Copyright (c) 2026 Clan World Game. See [`LICENSE`](LICENSE).

<p align="center">
  <sub><a href="https://clan-world.com">clan-world.com</a> · <a href="https://app.clan-world.com">app.clan-world.com</a> · <a href="https://github.com/clan-world/clan-world-game">github</a></sub>
</p>
