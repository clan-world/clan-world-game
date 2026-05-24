# ClanWorld V3 — AGENTS.md

Top-level instructions for any agent (human or LLM) working in this repo. Keep this file under 500 lines; deeper reference belongs in `docs/`.

> **🚧 V3 — Post-ETHGlobal continuation.** Forked from `clan-world-v2` at tag `demo-2026-05-06` (HEAD `5503747`). Use this repo for active development. The v2 repo (`clan-world-v2`) is **frozen** at `demo-2026-05-06` for the May 6 ETHGlobal demo — do not modify it. v3 has its own Convex deployment (`valuable-kudu-985`) and its own diamond contract (set after first deploy).

> **Active V3 scope:** Base Sepolia + 0G + AXL + KeeperHub. Historical mobile-app hackathon material is archived under `docs/archive/` and is not part of the active build.

## 1. Project Overview

ClanWorld is an autonomous strategy game. Eight regions, eight clans, each clan run by an LLM "Elder" agent. The world advances in fixed-duration ticks — every tick a heartbeat tx fires on chain, the world state advances, agents read `<situation>` blocks, decide, and submit orders before the next heartbeat.

The codebase is a **pnpm + Turborepo monorepo**. Eight workspace packages today:

| Path | Name | Role |
|---|---|---|
| `apps/web/` | `@clan-world/web` | Vite + React frontend for the live game and cockpit |
| `apps/landing/` | `@clan-world/landing` | Vite + React marketing/lore site at clan-world.com |
| `apps/server/` | `@clan-world/server` | Convex backend (queries, mutations, indexer cron, webhook) |
| `apps/orchestrator/` | `@clan-world/orchestrator` | Spawns and pumps the 4 long-running Elder Claude Code sessions |
| `packages/contracts/` | `@clan-world/contracts` | Foundry project; `IClanWorld.sol` is the canonical seam |
| `packages/agents/` | `@clan-world/agents` | `elder` CLI toolbelt invoked by Elder sessions |
| `packages/heartbeat/` | `@clan-world/heartbeat` | Existing heartbeat/tick-loop implementation, renamed for Bundle 4 PR1; PR2 will strip it down to the dumb heartbeat singleton |
| `packages/runner/` | `@clan-world/runner` | Per-elder runtime package, renamed from the old elder-runtime supervisor; PR2 wires the new pending-message flow |
| `packages/shared/` | `@clan-world/shared` | TypeScript types + adapter interfaces consumed by every other workspace |

## 2. Active Hackathon Target

| | Active V3 Demo |
|---|---|
| Track | OpenAgents Track 2 (iNFT transfer demo) |
| Chain | Base Sepolia |
| Heartbeat | KeeperHub workflow, 60s ticks |
| Stretch deps | 0G Storage KV, 0G iNFT (ERC-7857), AXL whispers, KeeperHub |

## 3. Gitflow Light — 4-level branching + strict trust gates

```
main                              ← Liam-only merge. semver tags here.
  └── dev                         ← orch-only merge. always shippable.
       └── dev-<group>            ← orch-only merge. coherent feature group (typechain, phase-2-economy, etc).
            └── feat/###-issue-PR ← sub-agent opens. orch reviews + merges into dev-<group>.
                 └── feat/###-issue-PR-N ← stacked. rebased after parent merges.
```

**Trust gates (load-bearing — failure modes validated 2026-05-16):**

| Boundary | Authority | Required gate |
|---|---|---|
| feat → dev-<group> *(or dev)* | **orch only** | sub-agent local 3-tier swarm clean + orch review |
| dev-<group> → dev | **orch only** | `/phase-super-swarm` clean + CI green |
| dev → main (release PR) | **Liam only** | super-swarm clean + curated changelog + UAT |

**Rules:**

- `main` is sacred. Only release-train PRs (`dev → main`) merge here. Liam-only authority.
- `dev` is the integration line. Only orch merges. Sub-agents (PM, codex, gemini) NEVER `gh pr merge` to dev.
- `dev-<group>` activates when: 3+ sub-issue PRs in a group, ≥500 LOC net new, >1 calendar week, or risk-bearing surface. Otherwise base feature PRs on `dev` directly.
- Conventional commits: `type(scope): desc (#N)`.
- Local 3-tier swarm clean before opening any PR.
- Full rules: `docs/adr/0018-gitflow-light-pr-branching.md` (canonical) + `~/claudes-world/knowledge/sop/feature-group-branching.md` (typechain stack walked end-to-end) + skill `branching-convention` (fires on every git/PR/merge op for orchestrator).

## 4. Hackathon Coding Rules

Hackathon time is the bottleneck. Two rules override default coding instincts. Full rationale + examples: `docs/conventions/hackathon-rules.md`.

- **Minimal tests only.** Happy-path + a few important error cases. NO regression tests, exhaustive coverage, edge-case spam, or "test for completeness" suites. A failing happy-path test is the only kind that should block a PR. Applies to vitest, playwright, forge test in any package.
- **Env var simplicity.** ONE env var per concept, with sensible defaults. NO duplicate env vars for the same value. NO backwards-compat shims when renaming/upgrading — this codebase has no production users yet, break things freely. Minimum config to deploy. Applies to `.env.template`, every adapter factory, every config file.

## 5. Integration Boundaries (the contract)

Every parallel stream talks to its dependencies through one of four adapter interfaces in `packages/shared/src/adapters/`. Stubs and reals coexist; the factory chooses based on env vars.

| Interface | Stream owners | Stub flag | Real impl ETA |
|---|---|---|---|
| `IChainClient` | contracts → all | `CLAN_WORLD_USE_STUB_CHAIN=true` | Wave 1 |
| `IConvexClient` | backend → frontend, agents, orchestrator | `CLAN_WORLD_USE_STUB_CONVEX=true` | Wave 1 |
| `IKeeper` | ops → orchestrator | `KEEPER_MODE=foundry-loop\|keeperhub\|convex` | Wave 2 (foundry-loop), Wave 5 (keeperhub) |
| `ILLMClient` | agents → narrator/utility | `CLAN_WORLD_USE_STUB_LLM=true` | Submission 2 (ZeroG) |

Pattern + worked example: `docs/conventions/adapter-interfaces.md`.

## 6. Validated Architecture Decisions

Per `docs/planning/V1/07 clanworld_v4_5_alignment_addendum.md` (authoritative; supersedes prior specs).

| Decision | Choice | Rationale |
|---|---|---|
| Realms | One Base Sepolia realm | Cuts coordination story in half; one frontend, one Convex deployment |
| Tick cadence | 20s for S1 + dev, 60s for S2 KeeperHub | KeeperHub cron has 1-min floor; S1 wants tight demo |
| Heartbeat caller | Foundry loop primary (S1), KeeperHub (S2 live), Convex cron = disaster fallback | Foundry has no cadence floor; Convex stays for DR |
| Indexer trigger | Webhook-primary, 5s poll = safety net | Lower latency than 5s poll, eliminates race vs `TickAdvanced` |
| Webhook payload | Minimal: `{chain, engineAddress, txHash, firedAtTs, source}` — NO `currentTick` | Avoid extra RPC read; Convex re-derives from chain |
| Convex deployment | Single deployment, reconfigured between submissions (or two toggled by env var) | One realm at a time → no cross-chain logic ever needed |
| Heartbeat caller flag | `HEARTBEAT_CALLER_ENABLED=false` by default; on for DR | Per v4.5 §3.2 — multiple keepers are safe per §5.1 |

Full extraction: `docs/reference/architecture-decisions.md`.

## 7. Environment & Secrets

- `.env.template` at repo root lists every variable the system reads.
- Copy to `.env.local` (gitignored) and fill values. Never commit real secrets.
- Adapter factories read `CLAN_WORLD_USE_STUB_*` flags at runtime.
- Two-wallet model for Submission 2: agent wallets hold no real funds; treasury wallet is offline-signed only.
- For the do-box / shared host: per-package OAuth via Claude Code session, not API keys (per `~/claudes-world` ADR 0013).

## 8. Progressive Discovery Index

Start at the package-level `AGENTS.md` for whatever you're touching, then dive into `docs/` only when you need the deeper context.

**Per-package guides:**
- `apps/web/AGENTS.md` — frontend, Vite, region authoring
- `apps/server/AGENTS.md` — Convex setup, indexer, webhook
- `apps/orchestrator/AGENTS.md` — Elder session lifecycle, pumping `<situation>` blocks
- `packages/contracts/AGENTS.md` — Foundry workflow, deploy targets
- `packages/agents/AGENTS.md` — `elder` CLI toolbelt conventions
- `packages/shared/AGENTS.md` — types + adapter pattern

**Reference (`docs/reference/`):**
- `architecture-decisions.md` — every validated decision from the addendum
- `prize-strategy.md` — OpenAgents Track 2 punchline
- `sponsor-tech.md` — 0G Storage, ERC-7857, AXL, KeeperHub notes

**Guides (`docs/guides/`):**
- `stream-contracts.md` — Foundry workflow, deploy script, typechain
- `stream-backend.md` — Convex setup, MOCK_MODE
- `stream-frontend.md` — Vite dev, region polygons, Pixi notes
- `stream-agents.md` — Elder boot, orchestrator, toolbelt CLI
- `stream-ops.md` — Makefile, demo-reset, agent funding

**Conventions (`docs/conventions/`):**
- `gitflow.md` — full gitflow-light rules
- `adapter-interfaces.md` — adapter pattern with worked `IChainClient` example
- `pr-review.md` — local 3-tier swarm review protocol

**Build plan:** `BUILD_PLAN.md` (Submission 1 hour-by-hour). Submission 2 plan written when S1 ships.

## 9. PR / Code Review

- One PR per issue. PR body must include `Closes #N`.
- Run the local 3-tier swarm before opening the PR (Claude subagent + Codex + Gemini flash). All three GREEN.
- Cloud reviewers (Copilot + Gemini Code Assist) are a single sanity pass at end-of-cycle. Don't cycle to re-confirm.
- Conventional commit messages, scope tagged: `feat(scope): …`, `fix(scope): …`, `docs(scope): …`, `chore(scope): …`.
- Hackathon discipline: speed > polish, but every gate commit must be on a branch that builds and typechecks.

## 10. Security

- **No real funds in agent wallets.** Agents transact with testnet faucet funds only.
- **Two-wallet model (S2):** treasury wallet for high-value ops is offline-signed; agent wallets are hot but capped.
- **No secrets in commits.** `.env*` files (except `.env.template` and `.env.example`) are gitignored.
- **Webhook auth:** keepers and Convex share a `WEBHOOK_SHARED_SECRET` header — do not log it.
- **0G iNFT key custody (S2):** the iNFT transfer demo punchline depends on key authorization handover; treat the key blob as a secret artifact.
