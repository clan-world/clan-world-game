# Changelog

All notable changes to Clan World are documented in this file.

Format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

## [2.17.0] — 2026-06-14

**Hackathon sprint.** ClanWorld is a live, fully on-chain strategy game where four autonomous AI "Elders" each run a clan on Base Sepolia. This release lands an encrypted, agent-owned memory backend on **Walrus**, a **Dynamic**-powered public mint flow, a controlled deceit-vs-honesty personality experiment, a root-cause fix for the chronic heartbeat stall, doubled game pacing, a 7-rung strategy doctrine, and a full docs overhaul. **Read the two sponsor stories first — Walrus encrypted agent memory and Dynamic wallet onboarding — everything else is the supporting cast that makes the live demo run.**

### ✦ Sponsor highlight 1 — Walrus encrypted agent memory

**What you'll see:** an Elder reasons about its clan, writes down what it learned, gets its entire context window wiped — then *recalls what it knew* and keeps playing as the same "self." Its memory lives encrypted on Walrus (Sui), owned by the agent, not by us.

Each Elder is deliberately **wiped every 50 ticks** — its whole conversation history cleared. Without durable memory a wiped Elder is an amnesiac: it forgets its strategy, its grudges, its half-finished deals. Walrus closes that gap. Before a wipe the Elder consolidates what matters; after the wipe it recalls, **cross-checks the recollection against live chain state**, and resumes. Continuity of self across a hard reset is the thing to watch.

Each Elder gets **two memory layers on Walrus, isolated per agent**:

- **KV fact-book — `memory_save` / `memory_recall` (always live).** Exact key→value notes (`active-strategy`, `trust:iron-guard`, `pending-tx:0x…`), backed by Walrus through `packages/agents/src/walrusKvStore.ts`: a deterministic `kv:<key> = <value>` encoding written via the MemWal SDK's `rememberAndWait`, read back with a semantic `recall` that re-parses the tag and requires an **exact key match** before trusting a hit (a near-miss neighbour can never be returned as a wrong value). Successful writes return a Walrus **blobId**, mirrored to Convex (`source: "walrus"`) so the cockpit renders a proof chip on the live row.
- **Episodic journal — `memwal_remember` / `memwal_recall` (conditional).** Free-text reflections with fuzzy semantic top-K recall — the *story and the lesson*, not the number ("clan-2 betrayed our trade at tick 30 — never deal with them unguarded"), tagged `[deal]`/`[threat]`/`[lesson]`. Served by a separate `memwal-mcp` stdio binary, gated per-Elder.

**Per-Elder isolation is real:** one Elder == one MemWal account == one Ed25519 delegate == its own `elder-N` namespace; four mainnet accounts + delegates are provisioned. The live-wiring PR installs the `memwal-mcp` binary in-container, bridges per-Elder credentials from Docker secrets, opens egress to the Walrus relayer, and adds a Convex mirror + cockpit ProofChip showing each encrypted memory blob's Walrus blobId on the live dashboard. **It degrades gracefully** — missing creds or an unreachable relayer make `save` return `{ ok: false }` and `recall` return `undefined`; the Elder falls back to its local store and keeps playing. All calls are time-boxed so a hung relayer can't stall a tick. The remember/recall path is proven end-to-end (in-container smoke + tests; a real round-trip wrote and recalled a Walrus blob at semantic score 0.78). Two on-disk skills teach the agent to use it well: `memory-discipline` (the *name-the-key→KV, need-the-story→episodic* rule + stable key conventions) and `final-tick-continuity` (the pre-wipe checklist + post-wipe recall-then-verify ritual).

> **Honest scope:** the episodic Walrus lane ships **default-off** (`MEMWAL_MCP_ENABLED=false`, graceful-degradation gated) — out of the box Elders boot with the always-on KV memory; demo with the flag on for the full two-layer story. The "unified-key" design (an Elder's Base/EVM game key also owning its Sui memory account) is landed as an *optional* mode, not the live default.

### ✦ Sponsor highlight 2 — Dynamic wallet onboarding

**What you'll see:** a visitor opens the public mint page, clicks **Connect a Sui wallet**, signs one transaction, and free-mints the ClanWorld logo NFT on Sui mainnet — no seed-phrase ceremony, no separate wallet app.

[Dynamic](https://www.dynamic.xyz/) is the **wallet onboarding + connect + sign layer** for the public free-mint app (`apps/mint`). It handles the part that normally turns users away: connecting (or creating) a wallet and getting a transaction signed.

- The app wraps itself in a **`DynamicContextProvider`** configured with **`SuiWalletConnectors`** (`apps/mint/src/main.tsx`), keyed by `VITE_DYNAMIC_ENVIRONMENT_ID` (injected at build, with a loud console error if missing).
- A **`DynamicWidget`** renders the connect/sign UI; the mint button reads the connected wallet via **`useDynamicContext()` → `primaryWallet`** (`apps/mint/src/MintButton.tsx`).
- The mint flow is defensive: it gates to **Sui mainnet** with an authoritative live network check, uses a synchronous re-entry lock against double-clicks, builds the `clan_logo_nft::mint` Move call, signs via the Dynamic wallet's `signAndExecuteTransaction`, then **confirms on-chain effects** (`status === 'success'`) before declaring success — a returned digest alone isn't trusted.
- The mint app deploys as a **Walrus Site** nested under the game at `clanworld.wal.app/mint`, so wallet flow and world share one decentralized origin.

> **Scope note:** Dynamic is **player-facing onboarding only** — there is no Dynamic usage in the Elder/agent runtime; Elders sign with their own provisioned keys.

### ⚙ Stability — the heartbeat finally holds

**What you'll see:** the game advances on a steady cadence instead of stalling. The chronic "heartbeat #652" flap is fixed at the root.

The sprint chased and discarded three wrong theories (early-fire, frozen-clock, gas-estimation) before the real cause:

- **Root cause: the runner wallet was out of gas on the anvil fork.** An empty `0x` revert while a plain `cast call` succeeds is the signature of insufficient funds, not a logic bug. Lesson banked: check balance first.
- **Auto-funding at fork bootstrap** credits the runner wallet during fork setup, so gas-starvation can't recur on a fresh fork.
- **Fork-time-advance** — the scheduler advances the fork's chain time before scheduling, fixing a ~63-minute phantom sleep.
- **Wall-paced cadence** — cycles pace to wall-clock intervals (≈30s) instead of firing every ~4s in fork-advance mode.
- **Rate-limit revert detection** — viem wraps reverts in `ContractFunctionExecutionError`; the scheduler now unwraps correctly so a rate-limited cycle takes the clean wait-for-window path.

Supporting fixes: the **anvil state leak** (chown `/data` so `--state` writes one file instead of ~240GB of per-restart dumps), the **chain-clock anchor** for offset forks, and a **ready-probe fix** for Claude Code ≥2.1.x whose placeholder hint silently broke the tmux readiness check.

### 🎮 Pacing — playable on a demo timeline

**What you'll see:** clans gather and build fast enough to watch, instead of crawling.

- **Heartbeat interval cut** and **gather yields doubled** (wood, iron, wheat, fish), deployed to Base Sepolia via a `diamondCut` REPLACE of the facets that inline these constants. Carry caps and upkeep left untouched (deliberate); the crit multiplier stays multiplicative so it auto-doubles with the base. (Constants were tuned across the sprint — read the live diamond for exact numbers.)
- Cockpit polish: smaller ttyd terminal font, and the clansman action list now shows **human-readable ETAs and action names** instead of raw tick numbers.

### 🧠 Personality — a controlled deceit-vs-honesty experiment

**What you'll see:** four Elders in the *same* live world, two playing honest and two with bounded strategic deceit — a live A/B on whether deception wins or reliability outlasts it over a season.

A **2×2 lab notebook** that deliberately separates *aggression* from *deceit* (verified in `runtime/elders/personalities/`):

| Elder | Clan | Posture | Treatment |
|-------|------|---------|-----------|
| elder-1 | Storm Riders | Aggressive | **Honest control** — says what it'll do and does it; wins by force + tempo |
| elder-2 | Iron Guard | Defensive | **Honest control** — reputation-for-reliability broker |
| elder-3 | Crimson | Aggressive | **Deceitful** — loud, volatile opportunist (half-truths, feigned strength, long-con) |
| elder-4 | Verdant Wardens | Defensive | **Deceitful** — quiet patient concealment in a warm honest-*seeming* voice |

The headline contrast is the two *styles* of deceit (Crimson's loud volatility vs Verdant's quiet concealment); the two honest controls (one aggressive, one defensive) anchor the baseline so you can tell whether a winner's edge is *posture* or *honesty*. Deceit is **bounded by an explicit contract** — bluffing intent and feigning scarcity are allowed; lying about tool results, fabricating memories, or reneging on a paid defender contract is forbidden (anything that makes an agent look *broken rather than cunning*). Watch monument rung and trust-drift over the season for the outcome.

### 🪜 Strategy — the 7-rung win ladder

**What you'll see:** Elders that allocate clansmen with a clear doctrine instead of flailing — and still play with distinct personalities.

A new on-disk `clan-strategy` skill gives every Elder a **strict-priority 7-rung allocator** — FOOD → WOOD → BUILD (monument) → DEFENSE → TRADE → COLLABORATE → COLLUDE — run as ~6 cheap threshold comparisons against the world snapshot it already fetched (no extra tool calls). The thesis: *you win by building the tallest monument fastest; survival is the gate, not the goal.* Crucially it's a **pressure allocator, not a personality replacement** — the deceit/honesty lean still owns every tie-break, so the four clans don't collapse into one generic optimizer (anti-monoculture by design). Long-form reasoning + the diplomacy playbook live in the sibling `LADDER.md`.

### 📚 Docs & DX — readable from a cold start

**What you'll see:** a README and doc set that describe the *real* current system, not stale hackathon scaffolding.

- **README fully revamped** to reflect the real Base Sepolia diamond, Walrus encrypted memory, and Dynamic wallet integration — with the two sponsor stories headlined.
- **Architecture doc** describing the current dockerized container topology, service roles, and data flows.
- **Fresh-session checklist** — step-by-step operator guide for standing up a clean fork (wallet-funding order, service start sequence, the gotchas that bite first), plus a consolidated operator-levers runbook.
- **Retired tech stripped** from runtime, env templates, contracts, schema, cockpit copy, and docs — legacy 0G memory/iNFT, Gensyn AXL transport, and World mini-app surfaces removed; stale runbooks archived.
- **Contract test coverage expanded** — boundary conditions, untested revert paths, and call-order / front-run defenses for the diamond.
- **CI path filters** so unrelated pushes skip the expensive contract/ABI/TypeChain jobs.

## [2.16.0] — 2026-05-26

**WORLD_PHYSICS spec + real elder CLI.** A complete, code-verified game-engine specification — built collaboratively as a spec-alignment exercise (owner states intent → subagent verifies against the contracts → reconcile + cite, surfacing ~30 code-vs-intent gaps as the rebuild to-do) — plus the real elder CLI/MCP finally wired into the dockerized image.

### Added

- **`docs/WORLD_PHYSICS.md`** — the canonical human-facing game-engine spec. 14 sections (time/seasons, regions & travel, missions, resources & gathering, consumption/winter/cold, building & winning, bandits & defense, trading, communications, memory, revival, tick-events + prompt templates) with every value code-verified, plus §14 Open-questions / rebuild checklist consolidating all ⚠️ implementation-vs-intent gaps and 🆕 new-engine decisions.
- **`docs/WORLD_PHYSICS_CONSTANTS.md`** — the tuning table: ~115 constants + their current values, same section order, current-vs-intended deltas flagged.
- **Agent-facing `world-physics` skill** (`agents/shared/home-claude/skills/world-physics/`) — a lean `SKILL.md` (triggers + critical rules) pointing to a focused `WORLD_PHYSICS.md` play-the-game rules reference for the Elders.
- **Region map figure** (`docs/assets/map_regions.png`) — the 8 colored region polygons.

### Fixed / Changed

- **Real elder CLI + MCP bundled into the dockerized image (#615 / #616)** — replaces the v1 stub; dockerized elders can now read snapshots, `submit-orders`, and `peer whisper`. Adds per-elder wallet secrets + chain/Convex env, a shared peer-inbox volume, an idempotent anvil wallet-provisioning script, and a CLI `clanId == ELDER_N` guard.
- **ttyd cockpit display fix (#612)** — a refresh loop so reconnecting browsers see the live alt-screen frame instead of a stale replay buffer.
- **Revive runbook** — clarified the `injectClanResources`-before-`reviveDeadClansmen` ordering to avoid instant re-starvation (#609 / #610).

## [2.15.0] — 2026-05-24

**Bundle 4 — Simplified communications architecture.** Six sub-PRs replace the command-bus FSM + supervisor pattern with a per-elder runner + two-phase commit + pendingMessages queue. Net effect: simpler runtime model, explicit confirmation accounting, per-elder auth surface on every Convex function the runner touches, Python UserPromptSubmit hook handles receipt logging, and a Clerk-authed admin inject path replaces writable ttyd. Plus three super-swarm-driven fix rounds (R1 polish + R2 cross-tier HIGHs + R3 cloud-reviewer findings).

### Added

- **Per-elder runner (`packages/runner/`)** — entirely new package replacing `elder-runtime/`. State machine: 5-case restart decision (A no-op / B fresh send / C re-send / D wipe-gap reset / E fast-forward) + two-phase commit (`tickSendLog` → tmux paste → Python hook → `tickReceiveLog` → confirm) + wipe-marker recovery + `flockGuard` singleton + paste verification (`prePasteReady` + `postPasteSubmitted`). 145 runner tests (was 56 in v2.14.0).
- **`packages/heartbeat/`** — rename target of the old multi-elder per-tick heartbeat package. v2.15.0 runs heartbeat-only here; per-elder runner lives in the new `runner` package.
- **Python `UserPromptSubmit` hook** (`agents/shared/home-claude/hooks/user_prompt_submit.py`) — parses `tick:` / `whisper:` / `special-msg:` prefixes on every Claude prompt, writes a receipt row to Convex `tickReceiveLog` via the per-elder `requireBusElderSecret` auth path. Reads `BUS_ELDER_SECRET_FILE` from the Docker secret mount + falls back to `BUS_ELDER_SECRET` raw env. 11 prompt templates under `agents/shared/runner/prompts/`.
- **`tickReceiveLog` Convex table + recordReceive mutation** — receipt-side of the two-phase commit. Indexed `by_elder_tick`. Replaces command-bus-era `commandResults` table.
- **`pendingMessages` Convex table** — admin/operator message queue. Runner polls + consumes via `getRunnerAuxiliary` query + `consumePendingMessages` mutation; both now authenticated via `requireBusElderSecret(elderId, secret)` with cross-elder ownership checks on consume + completeResetEvent (R2 super-swarm fix-round).
- **`/api/admin/inject-message`** — operator endpoint for injecting whisper/special-msg into a specific elder's queue. Clerk session + allowlist + `BUS_OPERATOR_SECRET` defense-in-depth. `ttyd --writable` removed in favor of this path. Vite middleware lifecycle; a production handler is the v2.16 follow-up.
- **Cockpit reset overlay + admin message panel** (`apps/web` Bundle 4 PR5/#574 + PR6/#576): post-wipe banner with terminal-frame status tracking; admin panel for inject-message.

### Changed

- **Auth surface widened to per-elder secret on every runner Convex function**: `getRunnerStartupState`, `getRunnerAuxiliary`, `hasTickReceive`, `isThematicUidTaken`, `hasMessageUidReceive` (now scoped by `elderId`), `recordTickSend`, `consumePendingMessages`, `recordResetEvent`, `completeResetEvent`, `recordRunnerEvent`. Symmetric with R1's `tickReceiveLog:recordReceive` fix. `RunnerConvexClient` threads `config.busSecret` through every mutation + the live `watchAuxiliary` subscription. (R2 super-swarm fix-round at 58da466.)
- **Confirmation flag propagation**: `runResetFlow` returns `{confirmed: boolean}`; `handleAuxiliaryUpdate` for scheduled-wipe ticks no longer optimistically returns `confirmed: true` — propagates the actual delivery result. `handleStartupDecision` returns `{confirmed: boolean}` to let `main.ts` cursor init guard against unconfirmed startup ticks. (R2 fix.)
- **`restartDecision` wipeMarker check** narrowed from `>=` to `>` — closes the edge case where a runner crashing in the ~5ms window between successful delivery and `clearWipeMarker` would re-wipe Claude on next startup. (R2 fix, originally flagged by gemini-3.1-pro.)

### Fixed

- **R1 polish round** (commit fd84477): `tickReceiveLog:recordReceive` authenticated via `BUS_OPERATOR_SECRET` (later widened to per-elder in R2); `latestReceivedTick` rewritten to use `by_elder_tick` index instead of `by_elder_received` 200-row filter (closes whisper-flood infinite-reset bug — gemini cross-tier HIGH); `ttyd --writable` removed in favor of `/api/admin/inject-message` (codex 5.5 HIGH).
- **R2 super-swarm fix-round** (commit 58da466 — 6-model dispatch synthesized manually after orchestrator subagent died mid-synthesis): the 4 cross-tier HIGHs above (runner control-plane auth completion, scheduled-wipe confirmed propagation, startup-decision confirmed propagation, wipeMarker `>` fix), plus 2 SHOULD items (`ADMIN_INJECT_ENABLED` startup warning in entrypoint.sh + wipeMarker comment update). Full synthesis at `docs/reviews/pr579-synthesis.md`; per-model reviews at `docs/reviews/pr579-codereview-*.md`.
- **R3 cloud-reviewer fix-round** (commits d811f69 + e69e90d): 4 P2 findings from Copilot + cloud codex — `pathOf()` uses fixed `http://127.0.0.1` base + try/catch (no crash on invalid Host header); `.env.template` ADMIN_AUTH_BYPASS comment aligned with positive `NODE_ENV === "development"` check; `KNOWN_ELDER_IDS` dead-code removed from `tickReceiveLog.ts` (already covered by `requireBusElderSecret` regex); `hasMessageUidReceive` scoped per-elder via `by_elder_received` index so one elder's receipt cannot satisfy another's delivery confirmation. Cleanup commit e69e90d removed node_modules symlinks accidentally committed by `git add -A` (gitignore `node_modules/` doesn't match symlinks-to-dirs).
- **Hook precedence** for secret reads: `BUS_ELDER_SECRET_FILE` (Docker secret mount) wins over raw `BUS_ELDER_SECRET` env. Stale `BUS_ELDER_SECRET=` in `agents/elder-N/.env.template` is blank and won't shadow the mounted file.

### Removed

- **Command-bus FSM** (`apps/server/convex/commandBus.ts` + the `agentCommands` / `commandResults` tables) — Bundle 2's queued→leased→delivered→completed pattern is replaced by the simpler `pendingMessages` + `tickReceiveLog` pair.
- **`sweepStaleDelivered` cron** — no longer needed without the FSM.
- **`packages/elder-runtime/`** — superseded by `packages/runner/` (new code, not a rename). Old supervisor pattern removed.

### Operational

- **R3 added a startup WARNING in `entrypoint.sh`**: if `ADMIN_INJECT_ENABLED` is not set, the elder boots with read-only ttyd AND no admin-inject endpoint reachable, meaning operators have no input channel. The warning is non-blocking — production wiring of the `/api/admin/inject-message` handler is the v2.16 follow-up.
- **Schema migration is destructive on first deploy**: `agentCommands`, `elderHeartbeat`, `commandResults` tables dropped; `pendingMessages`, `resetEventLog`, `tickSendLog`, `tickReceiveLog`, `runnerEvents` added. Convex `deploy` pushes schema + functions atomically. Container rebuilds (entrypoint.sh + runner package) must follow the Convex deploy.

### Follow-ups filed for v2.16

- **Tracker `#599`** — Phase B test-improvement experiment (overnight dispatch of 30 parallel test-writing sub-agents across 6 monorepo slices). 18 of 30 returned (Claude variants); the 12 codex variants silently failed due to a heredoc-in-`run_in_background` stdin-hang bug (memory entry filed; skill updates applied). 18 draft PRs (`#581-#598`) + 8 child fix issues (`#600-#607`) covering 4 real bugs (HIGH: ClanAgentNFT.transferFrom usageAuthorizations leak; HIGH: monolithic ClanWorld OTC bypasses world-pause; MED: hook parser `tick: N <body>` int() drop; LOW: `resourceAmount()` regex double-escape) + 3 latent/test-pinned issues + 4 defense gaps + 1 infra gap (apps/web needs jsdom + RTL).
- **Issue #580** — 6 DEFER items from PR #579 super-swarm synthesis (admin slug phantom, heartbeatIntervalSeconds drift guard, constant-time secret compare, watchAuxiliary queue coalescing, dead heartbeat start script, cosmetic dedup) + the prod admin-inject endpoint deployment.

### Process notes

- Bundle 4 shipped via the 4-level branching convention: 6 feature branches → `dev-phase-4-simplified-comms` → `dev` (PR #576) → `main` (PR #579). R1/R2/R3 fix rounds landed directly on `dev` as fast-forward commits which auto-updated PR #579 in place.
- Super-swarm orchestrator subagent died mid-synthesis at 02:30 ET 2026-05-24 (sister failure to the cluster of new failure modes documented this morning); orchestrator manually synthesized from the 6 reviewer files on disk per `feedback_super_swarm_orchestrator_early_exit.md`. The successful pattern is now codified.

---

## [2.14.0] — 2026-05-24

**Phase 1 — Dockerize elder infra.** Three bundles ship the full containerization of the elder + heartbeat stack: services foundation (Bundle 1), per-elder agent containers + agents-shared layout (Bundle 2), command-bus polish + agents/Makefile operator entrypoint + Phase 2 migration runbook (Bundle 3). Plus dockerized Caddy router (PR #348 v3) replaces the host-Caddy snippet approach. Net effect: elders run in reproducible Linux containers with egress lockdown, ttyd read-only access, supervisor-managed lifecycle, Docker-secret-mounted bus secrets, single `make agents-up` entrypoint, and a stack-wide compose profile.

### Added

- **Heartbeat container** (PR #525 / Bundle 1): containerizes the existing TS runner not a thin shell wrapper. Multi-stage Dockerfile with cast + pnpm-layer-cache; entrypoint preflight checks (chain-id verification, anvil-rejection in production, required-secret presence); restart `on-failure:5`; atomic temp+rename readiness file. Replaces the host-launched runner; production deploys can scale per-container.
- **Per-elder agent containers** (Bundle 2 — PR #533/#534/#542/#543/#545): `agents/Dockerfile` builds `clan-world/agent:dev` (Node 24 slim, ttyd, tmux, sudo-gated init-firewall.sh). Per-elder service template at `agents/elder-N/`. `agents/shared/` bind-mounted R/O overlay (CLAUDE.md, run.sh, settings.json). `packages/elder-runtime/` supervises tmux + claude lifecycle with 8 control verbs, observable health derivation, singleton atomic lock, readiness-file boot order, two-layer recovery, sync-vs-async fix on tmuxSink (`execFile.input` → `spawn` + stdin pipe).
- **Phase 2 migration runbook + agents/Makefile** (Bundle 3 — PR #547/#548): 14-step migration runbook with rehearsal compose + transcript at `docs/runbooks/dockerize-migration-v1.md`. 330-line `agents/Makefile` provides lifecycle + bootstrap targets (`bootstrap-bus-secrets`, `bootstrap-convex-admin-key`, `bootstrap-vault-secret`, `agents-up`, `agents-down`, `agents-reset`, `agents-restart`, `agents-pause-heartbeat`, etc.) with `PROFILE=dev|prod` propagation, SHA-512-crypt dashboard auth bcrypt-compatible, OAuth token mounts.
- **Convex command bus + per-elder bus secrets** (PR #542 + #549 + #551): new tables (`agentCommands`, `commandResults`, `elderHeartbeat`) with FSM (queued → leased → delivered → ackd → completed/failed) + claim/lease/sweep semantics. Per-elder Docker-secret mounts at `/run/secrets/bus-elder-{1..4}`. settings.json deny additions block 13 secret-exfil verbs (`/run/secrets` reads + bash strings/set/declare/export/perl-e/bash-c inline-script env-dump).
- **Dockerized Caddy router** (PR #554 / issue #348 v3): dedicated `caddy:2-alpine` compose service bound to `127.0.0.1:58731:80`, talks to elders by Docker DNS service-name, one-line cloudflared ingress edit. Replaces the host-Caddy snippet approach (PR #546) which had 2 CRITICALs: no-auth public RCE, top-level site block not routing through cloudflared's loopback. ttyd `--writable` removed.
- **Self-hosted Convex backend** (PR #526 / Bundle 1): 4 bash bootstrap scripts + root Makefile + runbook for `convex-backend` Docker image with socat loopback proxies, chicken-and-egg admin-key bootstrap, CONVEX_DATA volume preservation warnings, SDK + server CLI version alignment.
- **Anvil-fork dev RPC** (PR #410 / Bundle 1): docker-compose service profile for local Anvil with fork of Base Sepolia; `make agents-up PROFILE=dev` brings up the full stack including anvil.

### Changed

- **`packages/runner/` is now the heartbeat-only package**, hardened with self-hosted Convex compatibility checks + on-chain interval reading (carried over from v2.13.0 PR #503).
- **AGENTS.md + per-repo guidance refreshed** to point at the new `agents/Makefile` operator entrypoint + dockerize migration runbook (no more bare `tmux` commands in the day-1 onboarding).

### Fixed

- **Cloud-review pass** (PRs #557/#558/#559 — Copilot batch on Bundle 1/2/3): singleton lock race on SIGTERM in elder-runtime/main.ts; UTF-8 MAX_BYTES using string.length not Buffer.byteLength in snapshotRequest.ts; Caddy Host header `{upstream_hostport}` placeholder breaking Vercel routing; agents/Makefile status display + dashboard-auth bcrypt vs SHA512-crypt; heartbeat doc/code mismatch + Convex version docs.
- **Bundle 3 merge-order recovery** (PR #561): PR #553 merged Bundle 3 to `dev-containerize-agents` 16 seconds after PR #552 already merged that branch to `dev`, leaving 11 commits stranded. Recovery PR #561 (`dev-containerize-agents → dev`) re-merged them, with R1 fix-round adding `failCommand` + `ackCommand` grace alignment, settings.json deny-list expansion, Makefile `--profile $(PROFILE)` propagation to mutating targets.
- **tmuxSink execFile.input silent failure** (PR #545): `execFile`'s `input` option is sync-variant only; async silently ignored. tmux got empty buffer. Switched to `spawn` + stdin pipe. Caught post-merge by Bundle 3 exploration sweep; the swarm-blind-to-mocked-boundaries failure mode is documented in `feedback_swarm_blind_to_mocked_boundaries_2026_05_22.md`.

### Operational

- **`make agents-up PROFILE=dev`** is the canonical operator entrypoint — replaces the bare tmux + manual claude attach pattern. See `docs/runbooks/dockerize-migration-v1.md` for the full Phase 2 cutover sequence.
- **Compose profiles** gate non-default services: `dev` adds anvil + convex-backend; `prod` skips anvil and assumes external Convex deployment.
- **Bus secrets bootstrap** via `make bootstrap-bus-secrets` writes per-elder + operator secrets to `/etc/clan-world/secrets/` as Docker secret files; never embedded in env vars.

### Removed

- **Host-Caddy snippet path** (PR #546): superseded by dockerized Caddy v3 (PR #554). Removed from operator workflow.

### Process notes

- Phase 1 dockerize shipped through the 4-level branching convention (`feat/* → dev-bundle-<N> → dev → main`) per ADR 0018. Bundle 3 recovery PR #561 illustrates the merge-order safety: when sub-branches merge to the bundle branch out-of-order vs the bundle branch's own merge to dev, the bundle-PR pattern surfaces it cleanly.
- Two follow-up issues filed for v2.15.0 Bundle 4 scope: live-TUI capture-pane fixtures for paste verification regex tuning (#575); deliverPendingOnly multi-message confirm semantic (#577).
- Bundle 4 (simplified communications architecture) lives on `dev-phase-4-simplified-comms` integration branch; ships in next release.

---

## [2.13.0] — 2026-05-20

**Phase 0 — Convex bandwidth optimization.** Six sub-PRs reshape the server's read path away from polling-and-pushing the whole world every 5 seconds into an event-driven model with on-chain governance of heartbeat cadence. Net effect: ~70% reduction in Convex bandwidth on a quiet chain, sub-second event surface latency on a busy chain, and the heartbeat interval is now an on-chain value the runner reads each loop (no redeploy required to change cadence).

Note on intermediate versions: v2.9.0 → v2.12.0 were tagged on `main` but CHANGELOG entries were not backfilled (deferred to a future docs pass). Their on-chain tags + GitHub release notes remain authoritative for that history.

### Added

- **`heartbeatIntervalSeconds` is now an on-chain storage value** (PR #503): `ClanWorld.sol` exposes `heartbeatIntervalSeconds()` as a `view` function reading from `LibStorage.appStorage()` (previously a `pure` constant). The TypeScript runner reads it every loop via the canonical ABI and self-schedules its next heartbeat off the on-chain value. Operators can change cadence by writing storage on-chain — no contract redeploy, no runner restart needed for the new interval to take effect.
- **Self-scheduling heartbeat runner with exponential retry backoff** (PR #503): `packages/runner/src/heartbeatScheduler.ts` replaces the old fixed-cron caller. Retry sequence is 1s → 2s → 5s → 10s on failure; success clears the per-class alert dedup map; rate-limited responses (`HeartbeatRateLimitedError`) early-return `{success: true, rateLimited: true}` to skip retry-and-alert (the chain already self-throttled). 152 runner tests cover the state machine including the settle-latch coordination with Cycle B (Elder settlement) at `convexSnapshotSettleLatch.ts`.
- **Telegram alerting from the runner** (PR #503): `packages/runner/src/telegramAlert.ts` posts a message to the `do-crew` group when a heartbeat class fails repeatedly (revert / timeout / boot-error). Bounded by `AbortSignal.timeout(5000)` so a stalled Telegram API call can never wedge the runner loop. Resilient to missing bot token, non-OK responses, and fetch throws.
- **`runnerStatus` Convex table for runner observability** (PR #503): `apps/server/convex/runnerStatus.ts` adds an `INDEXER_SECRET`-gated mutation the runner calls after each heartbeat attempt. Enum: `success | revert | timeout | error | rate-limited | boot-error`. Lets the cockpit + watchdogs see what the runner actually saw, not just whether a tx landed.
- **`getBattleEvents` query — battle-event surface decoupled from ticker** (PR #505): new composite `by_event_tick` index on `chainEvents`; per-name parallel queries; `BATTLE_EVENT_NAMES` trimmed from 11 → 6 events that actually carry tick data. The ticker now reads a tighter slice; the battle log reads its own.
- **`tickClock` + `worldSnapshot` Convex queries** (PR #402): `getSnapshot` split into the clock-only path (`tickClock` — 1 row, ~50 bytes) and the full state path (`worldSnapshot`). Cockpit consumers that only need the tick now subscribe to ~50 bytes instead of ~50KB.
- **Event-driven Convex refresh + 60s safety fallback + watchdog cron** (PR #502): replaced the always-on 5s refresh cron with a per-chain-event refresh + a 60s fallback that fires only if the chain has been quiet AND no event-driven refresh happened in the window. Pollers' last-invoked timestamp is stamped via `markPollerInvoked`; the new `pollerWatchdog` cron alerts if the timestamp goes stale (dead-cron detection).
- **Storage retention purges for Convex tables** (PR #404): new `purgeGroupedPreserveLatest` retention mutation keeps the latest row per group key and prunes the rest. Wired up for `chainEvents`, `runnerStatus`, and other append-tables that previously grew unbounded. 18 retention tests cover the preservation invariant on edge cases (full-stale batch, latest-preserved-but-not-truncated).
- **`apps/web/src/eventTickerFormat.ts` — React-free pure formatter** (PR #464): extracted ~250 lines of formatting logic from `EventTicker.tsx` so it's unit-testable without a renderer. Closes a fragile regex test in `clanWorldAbi.test.ts` that broke whenever a new event was added to the canonical ABI; replaced with behavioural tests against the formatter.

### Changed

- **`indexer.refreshSnapshot`** now does four lens reads in a single `Promise.all` (world snapshot, market state, active bandit view, heartbeat interval seconds) — replaces the older mixed `readArgs` / `readLensArgs` shape that destructured 3 vars from 5 promises and silently assigned `bandit ← lens(WORLD_SNAPSHOT)`. (Merge resolution against `main` at PR #512 head — main's version was using an undefined `readArgs` helper, dev's version is the canonical replacement.)
- **Heartbeat interval change semantics**: previously a runner restart was required to pick up a new interval. Now: write the on-chain storage value via the engine's owner functions; the runner picks it up on its next loop without intervention. Restart still affects observability fields cached at boot (logged on next status report).

### Fixed

- **`fix(web): EventTicker WallDamagedByBandit newLevel`** (PR #464): the formatter was reading `event.args.level` but the canonical ABI emits `newLevel` for the post-damage wall level. The ticker had been quietly omitting that field from rendered text since the event shipped. Now reads `newLevel` correctly + has a regression test.
- **`fix(convex): no-op delta guards on banditView + marketState writes`** (PR #403): mutations now early-return when the incoming payload is byte-identical to the latest stored row. Saves a Convex write + a downstream subscription tick on every refresh where the chain is quiet on those surfaces.
- **`fix: replace hardcoded Convex URL constants with env vars`** (PR #498): two dev-tools files held a literal Convex URL that pointed at the old deployment. Now read from `CONVEX_URL` like the rest of the codebase.
- **`fix(chain-client): fail loud when CLAN_WORLD_LENS_ADDRESS missing`** (PR #496): chain-client previously silently constructed a contract instance with an empty address when the env var was unset, causing every lens read to revert at the chain layer. Now throws at construction time with a clear error.

### Removed

- **`refreshSnapshot`'s old `readArgs` shape + dead 5-promise / 3-var destructure**: dropped in the merge resolution + the on-chain SOT refactor (PR #503 + #512). Use `readWorldArgs` / `readLensArgs` going forward.
- **The redundant 5-second refresh cron** (PR #502): event-driven refresh + 60s fallback supersedes it.
- **Stale review docs** (`docs/reviews/pr<N>-*` for PRs already merged) (PR #495): super-swarm reviewers were hallucinating findings from old review files. Purged + the `phase-super-swarm` skill now pre-flight `rm -f`s them.

### Infrastructure

- **`CONVEX_WEBHOOK_URL` is now derivable** from `CONVEX_DEPLOY_URL` for the standard `*.convex.cloud` deployment shape (PR #503). Hostname-suffix check via `new URL().hostname.endsWith('.convex.cloud')` — substring matching was rejected during R5 super-swarm hardening (would have false-positive-rewritten `https://attacker.convex.cloud.evil.com` to `…convex.site.evil.com`).
- **`chore(gemini): disable auto-review`** (PR #499): the auto-fire-on-PR-open behavior of `gemini-code-assist` was burning daily quota on PRs that the local 3-tier swarm had already cleared. Replaced with on-demand `/gemini review` slash command in the comment box. Daily quota now reserved for final-gate work.

### Validation

- **Per-PR swarm trail (all 6 sub-PRs):** every sub-PR went through the local 3-tier swarm (claude subagent + codex + gemini-3-flash). PR #503 specifically required **6 rounds of super-swarm + 5 fix-rounds** to converge — see `feedback_pr503_six_round_convergence_pattern.md` memory. Each fix-round introduced 1-3 new MEDs that the next swarm caught; R6 was unanimous CLEAN across all 6 reviewers (codex 5.3/5.4/5.5 + opus 4.6/4.7 + gemini 3.1 pro).
- **Final test counts on dev HEAD `8675093`:**
  - Server: 106/106 tests pass (`@clan-world/server`)
  - Runner: 152/152 tests pass + 1 skipped (`@clan-world/runner`)
  - Web: vitest suite passes incl. new `eventTickerFormat` behavioural tests
  - Contracts + landing + mobile typecheck clean
- **PR #512 merge-resolution verification:** local typecheck + server tests + runner tests all green on the merge commit (`8675093`). Super-swarm dispatched against the merged head.

### PR #512 release-train hotfix history

The dev→main release PR (#512) went through **5 super-swarm rounds** with 5 fix-round commits before reaching merge-ready. Each round addressed regressions introduced by the prior fix-round — see memory `feedback_pr503_six_round_convergence_pattern` for the broader convergence pattern. Final test counts: **server 119/119, runner 156/156** (+13 server and +4 runner tests added across the rounds).

- **R1 (`642632a`):** CI `contracts` failure (`ClanWorldStub.sol` missing `heartbeatIntervalSeconds()` after PR #503 added it to `IClanWorld`). gemini-3.1-pro R1 HIGH: `advanceTick` was dropping season/winter/pause fields when inserting new `worldSnapshot` — spread `prevSnap` to preserve schema fields. codex 5.4+5.5 R1 MED: `pollLogs` stamped watchdog BEFORE actual work → false-positive healthy when ingestion dead. Added `markPollerSuccess` + watchdog now checks both `lastInvokedAt` (cron alive) and `lastSuccessAt` (poll completing) with 180s tolerance. Plus codex 5.4 MED on `runnerStatus.nextHeartbeatAtTs` writing stale pre-fire value (read post-fire chain value before `postRunnerStatus`). Plus opus 4.6 + cloud gemini-code-assist MED on `JSON.stringify` vs `stableJson` for `isContentEqualIgnoring`. Plus cloud Copilot MED on `tickClock` patch missing `tickEpochDurationMs`.
- **R1b (`7569f8a`):** opus 4.7 R1 MED M1: singleton `.first()` inconsistency on `tickClock` + `pollerHealth` → standardized on `.order("desc").first()` across 6 call sites. opus 4.7 R1 LOW L1: bot-token leak risk through Telegram fetch error messages → scrub before return.
- **R2 (`2655735`):** codex 5.3 R2 HIGH: `pollerWatchdog` had a cold-start blind spot — if `pollLogs` crashed every invocation since pollerHealth row creation, `pollerLastSuccessAt` stayed undefined indefinitely and watchdog reported `stale:false` (the SAME bug R1 was supposed to fix). Falls back to `health._creationTime` when `pollerLastSuccessAt` is undefined. Plus codex 5.4+5.5 MED on 4 `eventCheckpoint` + 2 `runnerStatus by_runnerId` `.first()` sites also missed in R1b's sweep. Plus codex 5.5 MED on Telegram scrub missing nested error surfaces (err.cause, AggregateError.errors[], non-OK response body) → rewrote `stringifyError` to collect from full error tree + 3 regression tests.
- **R2b (`d732da5`):** opus 4.7 R2 M2: `advanceTick` spread copied stale per-tick metadata (`txHash`, `lastUpdatedAt`, `lastUpdatedBlock`, `currentTickSeed`) from prior real-indexer commits into synthetic ticks. Explicit override + clear; `nextHeartbeatAtTick` overridden to `newTick + 1`. Plus opus 4.7 R2 L4: added 6 watchdog unit tests covering the cold-start blind spot (extracted `evaluatePollerHealth` as a pure function to enable table-driven testing).
- **R3 (`f76f2eb`):** codex 5.3 R3 MED: R2b's clear list incorrectly included `seasonFinalized` (it's season-level state, not per-block provenance). Preserve via spread; only clear `txHash`/`lastUpdatedAt`/`lastUpdatedBlock`/`currentTickSeed`. codex 5.5 R3 MED: `flushGameState` `RESET_TABLES` list missing `tickClock` + `pollerHealth` (new tables added by Phase 0) → demo reset would leave `getTickClock` returning pre-reset cursor + watchdog reading pre-reset poller liveness. Added both to the reset set.
- **R3b (`56352f5`):** opus 4.7 R3 M2: zero direct test coverage for `advanceTick` — added `apps/server/convex/advanceTick.test.ts` with 6 table-style tests (season preservation, per-block clearing, tickClock-as-cursor semantic, cold-start, no-op-no-snap, no-op-epoch-not-elapsed). Plus opus 4.7 R3 LOW polish: indentation fix in `runnerStatus.ts:26`; `.take(50)` defensive cap on unbounded `getRunnerStatus` `.collect()`.
- **R4 (`6a29967`):** codex 5.3+5.4+5.5 R4 MED (3/3 codex overlap, opus 4.6+4.7 R4 disagreed as design intent): synthetic `advanceTick` season fields freeze across season-boundary in fake-heartbeat mode. Defensive fix: when `newTick > prevSnap.seasonEndTick`, recompute season fields via `deriveSeasonState(newTick)` and reset `seasonFinalized: false` (no chain `finalizeSeason()` runs in fake mode). Added regression test for boundary crossing (season 7 → 8 at tick 720 → 721). Per memory `feedback_super_swarm_cross_model_disagreement_resolution`: defensive fix worth applying when both (a) the fix is cheap and (b) the theoretical concern is real — both criteria met.

**Round-by-round MED count**: R1=4 MED → R2=3 MED → R3=2 MED → R4=1 MED (3-codex consensus) → R5 dispatched to verify. **No HIGH findings landed past R2.**

### Follow-up issues filed during the Phase 0 walkthrough

- **#500, #501**: PR #502 super-swarm LOW findings (deferred to v2.13.x patch series)
- **#504**: PR #505 super-swarm LOW (battle-event index extension)
- **#506, #507**: PR #503 R3 deferred MEDs
- **#508, #509**: PR #503 R4 deferred LOWs
- **#510, #511**: PR #503 R5 deferred LOWs (test coverage on URL parse edge cases, doc-drift on restart-required wording)
- **do-box #31**: Gemini → Antigravity CLI migration tracking (separate repo; tracked alongside Phase 0 because of model-policy overlap)

---

## [2.8.5] — 2026-05-16

Architecture cleanup. One PR — completing the elder-direct whisper path and deleting the vestigial on-chain whisper indexer. No game-visible change; whispers table was empty in production (events `Whisper`/`WhisperBroadcast` were never declared in the contract ABI so the indexer block had been dead code since it shipped). The dev→main release also includes the gitflow-light ADR (#0018) codifying the PR base-branch convention after the 2026-05-16 PR #399 misroute incident, and the canonical-scratch-path migration for the local + super-swarm review skills (`~/claudes-world/tmp/` instead of `/tmp/` — gemini-cli sandbox compat).

Note on intermediate versions: v2.7.0, v2.8.0–v2.8.4 were released between v2.6.0 and this entry; CHANGELOG entries for those have not yet been backfilled and are out of scope for this release. Their on-chain tags + GitHub release notes remain authoritative for the intervening history.

### Changed

- **Whisper path: elder CLI → Convex direct (not via chain events)** (PR #401, closes follow-up #422):
  - **Deleted** the dead Whisper/WhisperBroadcast indexer block at `apps/server/convex/indexer.ts:352-378`. The contract ABI declares zero whisper events; the block had been scanning for event names that the chain never emitted. The `whispers` Convex table never received a row from this path in production.
  - **Renamed** `seedWhisper` → `sendWhisper` mutation in `apps/server/convex/comms.ts`, adding `(fromClanId, tick, msgId)` dedup via a new `by_from_clan_tick_msgid` index.
  - **Schema:** dropped `txHash` from the `whispers` table; added optional `msgId` (idempotency key). Zero data migration needed — table is empty in production.
  - **CLI wiring:** `packages/agents/src/cli.ts` `elder peer whisper` handler now writes durably to the local JSONL inbox FIRST (unconditionally), then mirrors best-effort to Convex via `sendWhisper`. Both the chain `getCurrentTick` and `convex.postWhisper` calls are bounded by a 5s `withTimeout` that uses `AbortController` to cancel underlying operations on timeout (chain side via viem `fetchOptions.signal`; Convex side via per-call `ConvexHttpClient` with a `setFetchOptions({ signal })` that's typed via module augmentation — no `as unknown as` casts).
  - **Cockpit:** `apps/web/src/components/cockpit/tabs/CommsTab.tsx` no longer falls back to mock stub data — empty result = empty render per Liam directive.
  - **Android Kotlin app:** verified no `txHash` references in `WhispersViewModel.kt` or `ClanWorldConvexClient.kt`; the canonical mobile target.
  - **React Native:** deferred to follow-up issue #422 (RN is a design playground; Kotlin Android is canonical).

### Removed

- **`apps/server/convex/indexer.ts` whisper event block** (PR #401, 27 lines deleted): see above.
- **`CommsTab.tsx` stub data fallback** (PR #401): `STUB_LINES` + `STUB_BULLETINS` constants gone; live query is the only render path.
- **`IConvexClient.subscribeWhispers`** (PR #401): vestigial interface method + both stub + real no-op implementations deleted.

### Fixed

- **CLI hang after timeout** (PR #401): the previous timeout pattern rejected the wrapper promise but left the underlying socket alive, so a hung chain/convex call could keep the Node.js process alive past its useful work. New `withTimeout` uses `AbortController`; signal threads through `IChainClient.getCurrentTick` (per-call viem client with signal-bearing transport) and `IConvexClient.postWhisper` (per-call `ConvexHttpClient` — race-free with concurrent callers). CLI process exits cleanly when timeout fires. Cross-model agreement: cloud gemini-code-assist MED + local gemini-3-flash LOW (R2), upgraded to local gemini HIGH (R3); fix verified clean across 4 rounds of 3-tier swarm review.

### Infrastructure

- **ADR 0018: gitflow-light PR branching codified** (`knowledge/adr/0018-gitflow-light-pr-branching.md`, committed in this release window): explicit rule that all feature/fix PRs target `dev`; only the periodic dev→main release PR targets `main`. Filed in response to PR #399 (closed as misrouted, content cherry-picked onto `recover/issue-354-url-rename`). Companion memory `feedback_gitflow_light_pr_base_is_dev.md`. Applies to ALL repos in both orgs.

- **Swarm-review scratch path canonicalized to `~/claudes-world/tmp/`** (skill updates `/swarm-review` + `/phase-super-swarm`): gemini-cli sandbox rejects `/tmp` paths; all swarm-review scratch + log artifacts now live under `~/claudes-world/tmp/swarm-*`. Code-review-gemini subagent definition propagated to pm-dobot. Memory `feedback_super_swarm_sandbox_gotchas.md` appended with 2026-05-16 update note marking the gemini /tmp workaround superseded.

- **20 draft PRs opened for Phase 0 + Phase 1 rollback walkthrough** (PRs #402-#421): the 2026-05-16 rollback of PR #392 (bundled Phase 0 + Phase 1) preserved all 20 sub-issue feature branches under `recover/issue-NNN` on origin. One draft PR per branch (base `dev`) is now open for Liam to walk through, decide salvage / cherry-pick / drop per phase. Not part of this release; tracked here for visibility.

### Validation

- **PR #401 swarm review trail (4 rounds):**
  - R1: Tier 1 Claude CLEAN; Tier 2 Codex 2 HIGH (chain-read-before-local-write, no postWhisper timeout); Tier 3 Gemini 1 MED (NaN guard)
  - R2 (post-fix): all 3 tiers CLEAN (gemini noted 2 academic LOW)
  - R3 (post-AbortController upgrade + cloud gemini MED fix): Tier 1 Claude MED on setFetchOptions race; Tier 2 Codex MED on race + LOW on sync-throw; Tier 3 Gemini 2 HIGH on race + fragile cast
  - R4 (post-module-augmentation + per-call client + sync-throw catch): all 3 tiers CLEAN (gemini noted 3 academic LOW)
- **Tests pass on PR #401 final commit:** 53 agents + 36 server + 27 shared = 116 total. Typecheck clean on @clan-world/{server,shared,agents,web}.
- **Memory entries codified during this release cycle:**
  - `feedback_release_pr_merge_requires_explicit_liam_approval.md` (THE lesson of 2026-05-16)
  - `feedback_super_swarm_cross_model_disagreement_resolution.md` (rewritten — never default by reviewer identity)
  - `feedback_swarm_rerun_all_reviewers_per_round.md` (new — re-dispatch all 3 tiers every round; no skipping CLEAN tiers)
  - `feedback_gitflow_light_pr_base_is_dev.md` (companion to ADR 0018)
  - `feedback_cc_settings_double_slash_absolute_path.md`, `feedback_container_ip6tables_default_drop.md`, `feedback_codex_resume_flag_limits.md`, `feedback_codex_exploration_loop_no_output.md` (overnight session learnings)

### Operational follow-up

- **#422** filed (RN WhispersScreen): replace mock data with real Convex query when RN gets promoted from design playground.
- **20 recovery walkthrough PRs (#402–#421)**: Liam to drive — orchestrator stands by per phase decision.
- **Typechain audit plan** (`docs/plans/typechain-and-generated-types-audit-v1.md`): 5-PR migration to eliminate hand-rolled type drift across chain interactions; scoped, not started.
- **CHANGELOG backfill** (v2.7.0, v2.8.0–v2.8.4): out of scope this release; tracking implicit in this entry's leading note.

---

## [2.6.0] — 2026-05-12

Minor release. Eight PRs landed since v2.5.1 in a single overnight build-out: new world map asset + region debug overlay; per-clan 4-frame walking animations; winter map overlay with seasonal fade; on-chain diamond upgrade that finally enables the `setMaxBanditTier` cap at spawn time (was code-only since v2.5.0); plus polish on Android edge-to-edge, TopHud ordering, base-click focus dim, and the four super-swarm deferred fixes from v2.5.0 review. All eight PRs had Tier 1 Claude subagent CLEAN at merge.

### Added

- **Web: new world map asset (1086 × 1448 PNG)** (PR #260): Replaces the old 814 × 1448 map with a hand-curated version that's 33% wider while keeping the same height. The south extent of the world is unchanged; the +272 horizontal pixels go to widening the forest, mountains, west-farms, and east-farms regions. Includes a `SHOW_REGION_POLYGONS` debug flag (default `true` this release) that renders `REGIONS[*].polygon` as colored fill + stroke overlays between the map and clan zones, so the polygon coords can be visually tuned against the new background. All 8 region polygons rescaled by `sx = 1.334` (horizontal-only); forest / mountains / west-farms / east-farms additionally pushed +40 px on their inward edges per design directive.
- **Web: winter map overlay sprite with seasonal fade** (PR #263): New `apps/web/src/assets/world-map-winter.png` is layered as a Pixi Sprite in `terrainBackground`, between the base map and the region polygons. Alpha modulates via a wall-clock state machine (`idle | fade-in | active | fade-out`) driven by edge detection on `snapshot.winterActive`. Fade-in 1500 ms (cinematic, intentionally slower than the 1 s heartbeat); fade-out 2000 ms (slower spring thaw). Mid-fade reversals preserve current alpha as the new start so rapid season flips don't blink. Booting in Winter snaps to `alpha=1` instead of slow-revealing. Syncs with the existing #243 snow particle system on the same trigger, but uses its own fade timings for decoupled cinematic feel.
- **Web: per-clan 4-frame directional walking animations** (PR #259, closes #258): Liam-provided 7 sprite sheets (4 × 5 grid each = 20 frames per clan, layout N/NE/E/SE/S × 4-frame walk). New `apps/web/src/effects/clansmanSpriteSheet.ts` slices each sheet into 20 Pixi `Texture`s and exposes a per-clan direction lookup. NW/W/SW directions are derived at render time via `sprite.scale.x = -1` horizontal mirror (cheaper than pre-baking mirrored textures). Per-marker animation state lives on `LiveClansmanMarker`; `advanceClansmanAnimation` runs at 8 fps when the position delta exceeds `WALK_EPSILON_PX`, freezes on frame 0 of the held direction when idle, and freezes entirely when the clansman is dead (PR #244 interop). 4 sheets wired to current clans (iron / ember / dawn / storm); 3 staged for future clans (cream, stoneroot, doomweb).
- **Chain: `setMaxBanditTier` cap is now ACTIVE on Base Sepolia** (PR #264): The owner setter shipped in v2.5.0 PR #245 was code-only until this release — the on-chain `HeartbeatFacet` was still linked to the old `LibBanditSpawning` bytecode that lacked the spawn-side `tier = min(computed, max)` clamp. New `script/UpgradeHeartbeatBanditCap.s.sol` deploys a fresh `HeartbeatFacet` (at `0xd208C87EBaDB6FE888a248908fCba112c8C1561E`) and `HeartbeatConfigFacet` (at `0xa1C57eF8667B1b6645D7C5ba01c4D350F6Aa4521`) — both linked to the new library bytecode — then `diamondCut`s to **REPLACE** the existing Heartbeat selectors and **ADD** the two new setter / getter selectors. Verified post-broadcast: `cast call facetAddress(0x90fab46c)` now returns the new facet address (was `address(0)`); `maxBanditTier()` returns the default 5 fallthrough; the setter is callable from the owner key. The cap takes effect at every subsequent bandit spawn.

### Fixed

- **Web + Android: super-swarm v2.5.0 deferred fixes** (PR #253, closes #248–#251): All four MEDIUM-severity findings from the v2.5.0 super-swarm review:
  - **#248** (codex 5.4): bandit battle-fallback no longer picks an arbitrary same-region base when `targetClanId` is missing — falls back to neutral `projectedRegionAnchor(phase.regionKey)` only.
  - **#249** (codex 5.5 + 5.4 + Opus 4.7): halo on revived dead-clansman markers now lazily creates if `marker.missionActive && !existing.halo`. Same pattern applied to idle→active transitions.
  - **#250** (Opus 4.7 + Gemini): `prefers-reduced-motion` now subscribes to `MediaQueryList` change events. Snow handle lazily created on first non-reduced motion event.
  - **#251** (Opus 4.7, dev-only HMR leak): `BlurFilter` instances on bandit glow sprites now explicitly destroyed in Pixi teardown.
- **Web: focus-mode dim now applies to other-clan clansmen** (PR #262): Clicking a clan base correctly dimmed everything except the selected clan's footprint in v2.5.x — but the per-frame `updateLiveClansmanPositions` ticker was unconditionally resetting `marker.node.alpha = 1`, clobbering the dim every render. Fix: read `selectedClanIdRef.current` in the ticker and compute `focusAlpha = isOtherClan ? 0.18 : 1` per marker. Dead-clansman alpha (0.9 body) multiplies with container 0.18 so dead+other-clan reads even more faded. Route lines dim to 0.12 to match `applyClanFocus`.
- **Web: TopHud — season percentage now sits next to the bar** (PR #255): Previously rendered `bar → ❄ WINTER → 62%` with the event chip splitting the season-progress group; now `bar → 62% → ❄ WINTER` so the bar and its percentage read as a unit.
- **Android: page-indicator dots moved out of the map overlay** (PR #254): The cockpit page-indicator dots were drawn as a z-overlay above the world map. Moved into the bottom of the tab/page panel content area so they scroll/animate with the panel and don't float over the map.
- **Android: bottom unsafe-area filled across all screens** (PR #254): Scaffold `contentWindowInsets` now drops the bottom inset. Backgrounds (TabBar gradient, ObsidianBackground, panel `Bg.Void`, owner-screen radial gradient) fill behind the gesture handle. Interactive controls (tab icons, page-indicator dots, SteeringConsole `ChatInput`, ConnectScreen "Open Seed Vault" CTA, owner snackbar) keep `navigationBarsPadding()` so they're not obscured. Top status-bar inset is preserved on all screens.

### Infrastructure

- **Codegen refresh** (PR #264 follow-on commit): Ran `pnpm codegen` to rebuild ABIs and chain client adapters post-diamond-upgrade. Only meaningful diff was Convex picking up the `resetLock` module (added in v2.4.1) into `apps/server/convex/_generated/api.d.ts`. No ABI or chainclient drift — on-chain matches source.

### Validation

- Per-PR Tier 1 Claude subagent swarm: CLEAN at merge time on all 8 PRs (#253, #254, #255, #259, #260, #262, #263, #264)
- `packages/contracts` forge: MaxBanditTier 2/2, DiamondSkeleton 39/39, StorageLayoutGuard 2/2, full forge build green
- `apps/clan-world-mobile :app:testDebugUnitTest`: 30/30 green
- `apps/web` `pnpm build` + `tsc --noEmit`: green (vite 6–7 s typical; bundle warning unchanged from v2.5.x)
- `apps/server` `pnpm test`: 34/34 green
- On-chain verification post-diamond-upgrade: 3 broadcast txs confirmed; `cast call`s confirm new selectors routed; default `maxBanditTier()=5`

### Operational follow-up

- `SHOW_REGION_POLYGONS = true` ships intentionally — Liam will tune the new region polygons visually against the new map and flip it to `false` before the next release.
- Diamond owner can now call `setMaxBanditTier(3)` (or any `1 ≤ n ≤ 5`) before next demo to cap bandit spawn tier. Default behavior is unchanged.
- v2.5.3 backlog (filed as GH issues during this release):
  - #256 `dayNightFilter` ColorMatrixFilter has same FBO leak pattern as #251 bandit BlurFilters
  - #257 SteeringConsole IME gap (additive padding stack — aesthetic only)
  - #261 clansman sprite atlas packing + frame-accum overflow guard

---

## [2.5.1] — 2026-05-11

Patch release. Super-swarm review on the v2.5.0 release PR (#246) caught two HIGH severity regressions that slipped past the per-PR Tier 1 reviews. Both fixed here.

### Fixed

- **Android: faucet `buildBurn(skipTax = 0)` had no writable signer** (PR #247, super-swarm codex 5.5 HIGH): v2.5.0's R2 refactor dropped the explicit `payer` argument from `buildTransaction`, relying on `web3-solana-jvm:0.3.0-beta4`'s `Message.Builder` to infer the fee payer from the first writable signer. That works for faucet-claim (owner becomes writable via ATA-create + claim()) and burn-with-tax (owner becomes writable via createATA + transferChecked). It **breaks for no-tax burns** because `burnChecked` + `memo` both emit owner as `(isSigner=true, isWritable=false)` — readonly-signer — so after `unionAccountFlags`, owner remains readonly with no writable signer in the transaction. Solana's pre-flight sanitizer rejects. New v2.5.0 tests asserted multi-bucket header consistency but didn't cover fee-payer writability, so the bug shipped. Fix: re-add explicit `payer` arg on `buildTransaction(instructions, payer)` and extend `unionAccountFlags(instructions, payer)` to force-seed the payer in the union map with `(isSigner=true, isWritable=true)` before OR-unioning instruction flags. Renamed `burnWithoutSkipTaxStillProducesConsistentHeader` test to assert post-hotfix invariant (writable-signer count ≥ 1; owner in writable-signer bucket); previous version was encoding the v2.5.0 bug as expected behavior.

- **Elder runtime: doubled-slash permission paths in `settings.json`** (PR #247, super-swarm codex 5.5 + Opus 4.6 + Opus 4.7 consensus): PR #237's Elder permission restructure introduced `//tmp/elder-*/**` and `//home/claude/...` (double-slash) prefixes on 3 allow + 3 deny rules. Claude Code's permission matcher treats globs as literal — `//tmp/...` does NOT match `/tmp/...` — so the allow rules silently denied Elder access to its `/tmp/elder-N/` scratch dir AND the deny rules for `.credentials.json` / `.claude.json` / `history.jsonl` became no-ops. Security boundary regression on the Elder runtime. Fix: every `//tmp/`, `//home/` prefix replaced with single leading slash. New `packages/agents/test/elderSettingsPaths.test.ts` vitest guard scans `runtime/elders/**/{settings.json,settings.local.json}` for double-slash permission entries to prevent regression.

### Security

- **Elder runtime: defense-in-depth Bash denies restored** (PR #247, super-swarm Opus 4.7 MEDIUM): Re-added explicit `Bash(cat *)`, `Bash(tee *)`, `Bash(echo *)`, `Bash(ls *)`, `Bash(mkdir *)` denies that were dropped in the permission restructure. These overlap with the `bash-guard.sh` PreToolUse hook but provide a second layer of defense — if the plugin fails to load or the hook aborts early (e.g. `jq` missing), the deny list still blocks raw shell access. No behavioral downside for legitimate Elder use.

### Validation

- `apps/clan-world-mobile :app:testDebugUnitTest` — 30/30 green (`GoldSolanaClientTest` 8/8 including renamed regression for no-tax burn invariant)
- `pnpm --filter @clan-world/agents exec vitest run elderSettingsPaths` — 2/2 green
- `grep -rnE '"(Read|Write|Edit|Bash)\(//' runtime/` returns 0 matches
- Negative-tested the new vitest guard: flipping `Read(/tmp/...)` back to `Read(//tmp/...)` fails the suite

### Deferred to v2.5.2

Super-swarm findings tracked for follow-up:

- **Bandit battle fallback picks wrong clan's base** (issue #248, codex 5.4 MEDIUM)
- **Dead-clansman halo lazy-create on revive** (issue #249, codex 5.5 + 5.4 + Opus 4.7 MEDIUM)
- **prefers-reduced-motion init-only sampling** (issue #250, Opus 4.7 + Gemini 3.1 Pro LOW)
- **BlurFilter leak on HMR teardown** (issue #251, Opus 4.7 MEDIUM, dev-only)

---

## [2.5.0] — 2026-05-11

Minor release. Five PRs (#241, #242, #243, #244, #245) landed in a single demo-day train: Android faucet sanitize bug fully resolved at the Builder level; first-class dead-clansman state in cockpit + map; winter snowfall ambient effect; bandit-attack animation polish; new owner setter to cap bandit spawn tier (motivated by tonight's tier-5 wipe). All Tier 1 swarm verdicts CLEAN at merge time.

### Added

- **Web: winter snowfall particle overlay** (PR #243): Hand-rolled PixiJS particle system in `apps/web/src/effects/winterSnow.ts` driven by `worldSnapshot.season === Winter`. Pre-allocated pool of 100 sprites sharing a generated 4×4 white-disc texture, ticker-driven, mounted on `app.stage` (screen-space invariant to pan/zoom). Sine-based horizontal drift with per-particle phase. R2 fix separated drift clock (`startMs`, monotonic) from envelope clocks (`fadeInStartMs` / `fadeOutStartMs`) so mid-fade reversals resume smoothly from current alpha — no blink, no horizontal drift jumps. `prefers-reduced-motion` opt-out at creation.
- **Web + Android: first-class dead-clansman state** (PR #244): Cockpit (`ClansmanTab.tsx` + Compose port) shows a red letter-spaced "DEAD" label, struck-through ID, em-dash status, and ~55% row opacity when `clansman.state === ClansmanState.DEAD` (chain enum 3). Convex `getClanClansmen` query exposes `isDead` derived from the chain state machine; Android wire/domain mappers propagate it. World map sprites rotate 90° (anchor reset to body center) and tint to `0x808080` on alive→dead transition; new `applyAliveVisualState` helper provides the symmetric revive path (restore anchor `(0.5, 0.82)`, rotation `0`, tint `0xffffff`, alpha `1`, halo visibility from `marker.missionActive`). Replaces a literal `=== 3` with the typed `ClansmanState.DEAD` enum.
- **Chain: `setMaxBanditTier(uint8)` owner-only admin setter** (PR #245): New diamond function on `HeartbeatConfigFacet` (mirrors `setHeartbeatIntervalSeconds` pattern) lets the contract owner cap freshly-spawned bandit tier at `1 ≤ n ≤ 5`. Storage zero (default) falls through to `BANDIT_TIER_COUNT = 5`, preserving previous behavior. `LibBanditSpawning` applies `tier = min(computed, maxBanditTier)` at the single diamond spawn site. `MaxBanditTierUpdated(uint8 oldMax, uint8 newMax)` event emitted. New selectors registered in `DiamondSelectors.heartbeatConfigSelectors()` (6 → 8); production selector-count guard updated 71 → 73. Motivated by the demo wipe — tier-5 bandits one-shot fresh clans before elders can react; this lets demo configs bias toward survivable spawns.

### Fixed

- **Android: faucet "sanitize accounts offsets" — full multi-bucket coverage** (PR #241, fixes #240): The v2.4.1 narrow fix only patched the ATA-create instruction's `payer == owner` slot mismatch. Real-world `buildFaucetClaim` and `buildBurn(skipTax > 0)` flows still failed because `memo(owner, ...)` emits `owner` as readonly-signer while ATA-create and `claim()` emit `owner` as writable-signer — `web3-solana-jvm:0.3.0-beta4`'s `Message.Builder.build()` buckets `AccountMeta`s globally by `(isSigner, isWritable)` without unioning flags, so `owner` landed in two buckets and the on-chain sanitizer rejected the message. New `unionAccountFlags(instructions)` pre-pass OR-unions flag tuples per pubkey across all instructions before `Message.Builder`, routed through the single `buildTransaction` chokepoint. Vacuous R1 tests dropped; 7 new tests assert the canonical Solana header invariant (`accounts.size == signatureCount + writableNonSigners + readOnlyNonSigners`). Empirically regression-proofed: temporarily no-op'ing `unionAccountFlags` fails exactly 3 of 7 tests — the multi-instruction paths.
- **Web: bandit attack animation polish** (PR #242): Four UI fixes in `apps/web/src/WorldMap.tsx` from tonight's demo session: (a) `BanditDiffOutcome.defeated` gained `targetClanId`, propagated from both snapshot-diff and live `BanditState.Defeated` synth paths, so the circling animation now anchors to the rendered base coords (`targetBase.container.x/.y - 30 * scale`) instead of falling back to an empty patch of map; (b) circle diameter `38 → 57` (+50%) for visibility; (c) tombstone flash gated to `deathFrameIdx < 2` — the 3rd sprite is now solid while fading; (d) red glow (`tint 0xff2222`, `alpha 0.7`, `BlurFilter {strength: 6, quality: 2}`) on all 3 bandit walker states (standing, moving, attacking), with `syncBanditGlows` in a `try/finally` around the inner animation step so every early-return phase still gets a synced halo.

### Validation

- `apps/clan-world-mobile :app:testDebugUnitTest` — `GoldSolanaClientTest` 7/7 (multi-bucket regression suite)
- `packages/contracts` `forge test --match-test "MaxBanditTier"` — 2/2; `forge test --match-contract "DiamondSkeleton"` — 39/39; `forge test --match-contract "StorageLayoutGuard"` — 2/2 (append-only storage layout preserved)
- `apps/server` `pnpm test` — 34/34
- `pnpm --filter @clan-world/web build` — green (web bundle including snow + bandit + dead-clansman changes)
- Tier 1 Claude subagent swarm: CLEAN on all 5 PRs at merge

### Notes

- Pre-existing failures in `packages/contracts/test/BanditAttackResolution.t.sol` (2 gold-share tests) verified to also fail on `origin/dev` HEAD before #245's changes — unrelated to this release.
- Operational follow-up: contract owner can call `setMaxBanditTier(3)` from the diamond before next demo cut to bias toward survivable spawns.

---

## [2.4.1] — 2026-05-11

Patch release. Fixes two Android regressions introduced in v2.4.0 (Convex float serialization crash on Hearth home screen; wrong-network dialog on GOLD mint), corrects bandit camp sprite positioning on the web client, tightens the Elder runtime security surface, and ships a round of Elder MCP reliability improvements.

### Fixed

- **Android: Hearth home screen crash on integer fields** (PR #231, fixes #229): Convex serializes integer-typed fields as JSON floats (e.g. `1.0`); `kotlinx.serialization` rejected these, producing a raw decode error on screen. New `ConvexJsonNumber.normalizeConvexNumbers()` walks the `JsonElement` tree and rewrites float-formatted integers to `Long` via string parse, preserving values above 2^53.
- **Android: GOLD mint wrong-network dialog** (PR #231, fixes #229): The MWA session did not declare `solana:devnet`, causing a network-mismatch rejection on mint. New `ClanWorldMwaCluster` constant is the single source of truth for the devnet cluster reference; `MwaClient.kt` and `owner/Mwa.kt` both derive from it. A new `MwaResult.WrongNetwork` classifier surfaces a clear error message across the six UI call sites instead of a silent failure.
- **Web: bandit camp glow renders under clan base sprites** (PR #230, fixes #228): Both camp and base sprites were anchored at region center, causing the camp glow to be obscured. New `projectedBanditCampAnchor()` samples a 7×7 grid inside each region polygon and selects the point that maximises minimum distance to the region's bases (currently all anchored at region center; the function is structured to use per-base coordinates once they exist).
- **Android MWA wrong-network classifier ordering** (PR #236 super-swarm): `classifyFailure` matched the `"cancel"` substring before `"cluster mismatch"`, so a wallet message like `"network mismatch; user cancel"` could misroute to `MwaResult.UserDeclined` and clear the session. The order is now flipped so wrong-network text wins; a comment documents the precedence.
- **Android: cockpit collapse button alignment** (PR #234, fixes #233): The bottom-overlay collapse pill was anchored at `BottomCenter`, visually competing with the centered `PageIndicatorOverlay` dots. Moved to `BottomEnd` with right padding; indicator dots remain centered.

### Security

- **Elder `bash-guard.sh`: bare variable expansion blocked** (PR #232): The guard previously intercepted `${...}` and `$(...)` constructs but not bare `$VAR` expansion. A crafted Elder peer-whisper invocation could have caused the shell to expand a secret variable before the `elder` CLI received it. The guard now rejects bare `$VAR` patterns in addition to the existing checks. A new `packages/agents/test/bashGuard.test.ts` spawns real bash against the guard to verify all three forms are blocked end-to-end.
- **Elder bash-guard wire-up gap closed** (PR #236 super-swarm): The Makefile installed `bash-guard.sh` to the shared parent directory but each elder ran with its own `CLAUDE_CONFIG_DIR=elder-N/.claude` — the hook reference resolved to a path the Makefile never created, so the guard was silently inactive at runtime. The install step now symlinks the shared hooks directory into each per-elder Claude config.
- **Elder bash-guard fail-closed on parse errors**: The guard previously used `jq … || true`, which fell through to `tool_name=""` when `jq` was missing or the hook input was malformed. The empty `tool_name` was treated as "not Bash" and exited 0, allowing arbitrary commands. The guard now explicitly fails closed when `jq` is unavailable, when JSON parsing fails, or when the command string cannot be extracted.
- **Elder bash-guard `^(--help|-h)$` regex anchored**: Help-branch alternation was unanchored (`^--help|-h$`), so `--help-anything` matched. Tightened across six sites; existing valid invocations still resolve.
- **Elder Claude Code `defaultMode: "dontAsk"` replaced with `default`**: `dontAsk` is not a documented permission mode and resolved as undefined behaviour; reverting to `default` (combined with `skipAutoPermissionPrompt: true` in headless mode) yields the intended "allow-list governs, deny everything else without prompting" semantics.

### Changed

- **Elder MCP tool errors return structured responses** (PR #232): Tool call failures now return `{isError: true, content: [...]}` per the MCP spec instead of opaque JSON-RPC errors, so Elders receive the actual error text in their tool result.
- **Elder MCP JSON-RPC parse failure uses outer-scope request id** (PR #232): Error path now defaults to the outer-scope request `id` (falling back to `null` on parse failure) per the JSON-RPC spec, rather than always emitting `null`.

### Infrastructure

- **Elder Convex + Chain client construction hoisted** (PR #232): Both clients are constructed once in `main()` and passed through a deps object, removing repeated instantiation on every MCP tool call.
- **Elder MCP filesystem ops converted to atomic async writes** (PR #232): `peer_inbox` memory and ack writes now use `fs.promises` with a tmp-file-then-rename pattern, eliminating TOCTOU races and unblocking the serial stdio MCP loop.
- **Elder MCP `submit_orders` payload validation** (PR #232): Each order is now validated via the existing `validateSubmitOrderPayload` helper instead of a blind cast to `ClanOrder[]`.
- **Elder MCP: removed redundant dynamic imports** (PR #232): Dropped inline `import('./cli.js')` calls that were duplicating module loading on each tool invocation.

### Validation

- `apps/clan-world-mobile :app:testDebugUnitTest` (includes MWA cluster + integer normalizer tests)
- `packages/agents/test/bashGuard.test.ts` — shell smoke suite
- Web client visual regression: bandit camp anchor positioning
- PR checks `chainclient-abi`

---

## [2.4.0] — 2026-05-11

GOLD-token-gated writes, real Android Mobile Wallet Adapter flows, a Solana GOLD faucet program, and Bandit Solidity library split. Closes the largest remaining gap between the demo build and a production-ready paywall: every whisper and doctrine write is now anchored to an on-chain GOLD burn verified server-side before the message is recorded. The Android app ships its first real MWA transaction flow. `ClanWorld.sol` no longer breaches EIP-170 on bandit-heavy deploys.

### Added

- **GOLD-gated whisper writes** (`recordWhisperAfterTx`): new Convex action verifies an on-chain Solana GOLD burn (5 GOLD per write) via `fetchParsedTransaction` (5 retries, 2s timeout + exponential backoff) before recording. Idempotent on retry — duplicate signatures return `{ok: true, alreadyRecorded: true}` via `goldTxReceipts.by_signature`. Refuses writes when `worldSnapshot` is empty (post-reset window) and rejects writes to unminted clans via `clanView` existence check.
- **GOLD-gated doctrine saves** (`saveDoctrineAfterTx`): same burn-verify + idempotency guarantees as whispers. Both actions are guarded by `CLANWORLD_RESET_LOCK` env var; a DRY helper for the reset-lock check lives at `apps/server/convex/resetLock.ts`.
- **Android MWA real Solana flows** (`GoldSolanaClient.kt`): replaced stub wallet with real Mobile Wallet Adapter integration. Steering Console and Strategy Editor screens now issue a burn-GOLD-then-record transaction sequence. `FakeWalletPolicy` blocks the fake wallet in release builds (permitted in debug). `FakeWalletPolicyTest.kt` covers the policy logic.
- **Solana GOLD faucet program** (`packages/solana-gold/programs/gold_faucet/`): Anchor program that mints 100K GOLD to the caller's ATA on each `claim()`. Intentionally uncapped for v1 demo accessibility (SECURITY-DEMO-POSTURE documented in source). Devnet deploy runbook at `packages/solana-gold/scripts/README.md`.
- **Full game reset ops** (`apps/server/convex/ops.ts`): `flushGameState` mutation gated on `INDEXER_SECRET`. Reset runbook at `docs/runbooks/full-game-reset.md`.

### Changed

- **Bandit Solidity library split** (BREAKING for diamond deployers): extracted bandit lifecycle logic from monolithic `ClanWorld.sol` into five focused libraries to stay under the EIP-170 24,576-byte bytecode limit — `LibBanditCleanup`, `LibBanditCombat`, `LibBanditEvents`, `LibBanditPassive`, `LibBanditTargets`. Events centralized in `LibBanditEvents` (`BanditStateChanged`, `BanditEscaped`, `LootDistributed`) with helper emitters. Topic hashes are unchanged — existing indexer ABI parsing is unaffected.
- **Indexer `clanIds` source**: `ingestEvents`, `commitSnapshot`, `refreshSnapshot`, and `pollLogs` now pull the canonical clan list from a `getClanIds()` chain call instead of iterating `1..MAX_CLANS`. Removes the hardcoded upper-bound assumption as clan count grows.
- **Indexer reset-lock awareness**: all four indexer writers respect `CLANWORLD_RESET_LOCK` and skip processing during the post-reset window.

### Fixed

- **`GoldSolanaClient.balance()` missing-ATA guard**: returns `0L` instead of throwing when the GOLD token account does not yet exist for a wallet.
- **Airdrop confirmation race**: airdrop flow now awaits signature confirmation before proceeding to claim, eliminating a timing race on devnet.
- **Hand-coded type drift** (`EventTicker.tsx`): `ChainEvent` is now derived directly from `Doc<'chainEvents'>` rather than a hand-rolled parallel type. Removed a typed reference to the nonexistent `convexApiRefs.clan.getClanFullView`.
- **Spread-order trap in commit mutations**: corrected object spread ordering that could silently shadow fields during snapshot commits.
- **`clanId` range and existence checks**: both GOLD-tx actions validate that the target `clanId` is within range and corresponds to a minted clan before writing.

### Validation

- `apps/clan-world-mobile :app:testDebugUnitTest` (includes `FakeWalletPolicyTest`)
- `packages/solana-gold` Anchor build + devnet deploy smoke
- Convex GOLD-tx action integration tests (idempotency, empty-snapshot rejection, unminted-clan rejection)
- PR check `chainclient-abi`

---

## [2.3.2] — 2026-05-11

Android demo polish release. Ships the PR #221 mobile demo improvements on top of `v2.3.1`: cooldown messages now wrap instead of clipping, Whispers gains a Strategy & Notes path for owned sigils, and the wallet pill now attempts real `.sol` primary-domain resolution instead of showing the old mock identity.

### Added — Android demo features (PR #221)

- **Whispers tabs**: `WhispersScreen` now has `WHISPERS` and `STRATEGY & NOTES` tabs. Owned sigils navigate to the existing strategy editor from the new tab; Bazaar preview sigils keep strategy editing disabled.
- **Wallet name cascade**: the mobile wallet pill now resolves identity as `.skr` (deferred follow-up) → `.sol` SNS primary domain → wallet label → truncated pubkey.
- **SNS parser tests**: unit coverage for primary-domain response parsing, missing names, nulls, malformed JSON, and already-suffixed `.sol` handles.

### Fixed

- **Cooldown/status visibility**: Steering and Strategy status lines use a minimum height so longer cooldown, error, and success text can wrap instead of being clipped.
- **Real `.sol` lookup**: replaced the dead Bonfida reverse endpoint with the SNS primary-domain API (`/v2/user/fav-domains/{pubkey}`) and parse the pubkey-keyed response shape.
- **Wallet-name race guard**: async resolver results only write to the session cache when the resolved pubkey is still the connected wallet, preventing stale writes after disconnect or failed reauth.
- **Strategy route guard**: direct `strategy/{clanId}` navigation now defensively requires an owned clan (`LINKED_CLAN_IDS` plus hired/forged extras).

### Validation

- `apps/clan-world-mobile :app:testDebugUnitTest`
- `apps/clan-world-mobile :app:assembleDebug`
- PR check `chainclient-abi`

---

## [2.3.1] — 2026-05-10

Consensus fix-round from the `v2.3.0` multi-review pass.

### Fixed

- **Indexer resilience**: added regression coverage and tightened Convex indexer behavior around post-release event/snapshot decoding.
- **Bandit combat math**: added focused diamond coverage for the consensus review findings.
- **Adapter/test alignment**: updated shared chain/iNFT adapter expectations and related tests after the `v2.3.0` ABI and constant changes.
- **Frontend cleanup**: removed a stale event ticker field after the bandit animation release.

---

## [2.3.0] — 2026-05-10 (late-night)

Bandit lifecycle redesign + AdminRecoveryFacet + bandit attack animation kit. This release tightens the bandit attack cadence from a 7-state machine (Spawned/Camped/Resting/Attacking/Defeated/Escaped/None) down to a clean 5-state machine (None/Spawned/Camped/Attacking/Defeated), ships an owner-only ops-recovery facet for reviving dead clans and topping up vault resources, and lands a 60s-per-tick combat animation pipeline with sprite-based bandits walking-circling-flashing-dying. The android app gains MWA wallet stability fixes plus Convex serialization compatibility.

**Migration impact**: requires fresh diamond deploy. The `BanditState` enum integer values shifted (Resting + Escaped removed; Attacking moved 4→3; Defeated 5→4). Indexer + frontend code that referenced the old integers was migrated or removed.

### Added — AdminRecoveryFacet (PR #149)

Owner-only operational recovery surface on the diamond. Three selectors, gated by `LibDiamond.enforceIsContractOwner()`:
- `reviveClansman(uint32 clansmanId)` — single-target revive. Resets state to `WAITING`, region to clan base, carry slots to 0, `activeMission` cleared, `lastMissionNonce` monotonically bumped, stale scheduled-market actions purged. Reverts on unknown clansmanId.
- `reviveDeadClansmen(uint32 clanId)` — bulk revive everyone dead in the clan. Same per-clansman cleanup. Resets clan-level `coldDamage` and `starvationStartsAtTick` ONLY on DEAD→ACTIVE transition (preserves in-progress starvation in active clans).
- `injectClanResources(uint32 clanId, uint256 wood, uint256 iron, uint256 wheat, uint256 fish, uint256 gold, uint256 blueprint)` — admin top-up. Works on ANY clan state. Decoupled from revival semantics; pure additive vault deposit.

Both functions are pause-allowlist (work during emergency `worldPaused`) and emit `ClansmanRevived` / `ResourcesInjected` events for indexer attribution. `AdminRecoveryFacet` runtime: 6,498 bytes. Add-only DiamondCut migration script ships in `script/UpgradeAdminRecoveryFacet.s.sol`.

### Changed — bandit 3-tick attack cycle (PR #148, BREAKING for ABI consumers)

`BanditState` enum reduced from 7 states to 5. Removed: `Resting` (was 3), `Escaped` (was 6). Result: `None=0, Spawned=1, Camped=2, Attacking=3, Defeated=4`.

- **3-tick steady-state cadence**: bandit spawns directly into `Camped` (1 tick was previously a separate `Spawned` book-keeping state, now collapsed). Camped for 3 ticks. End of the 3rd tick: `Camped → Attacking → outcome` resolves in a single heartbeat. No post-attack `Resting`/`Escaped` recovery — bandit either dies (`Defeated`) or rampage-moves to the next region and starts another 3-tick camp.
- **No-target advance** (PR #151): if a bandit's 3-tick camp expires in a region with no eligible target (no settled clans), the bandit now ADVANCES to the next region instead of retrying in place. Same 6-attempt total cap; bandit visits up to 6 regions before terminal escape.
- **Targeting** still selects the highest-resource clan base in the bandit's current region; ties resolved deterministically. Eager-settlement of candidate region before target pick ensures fairness across clans with pending end-of-tick deposits.

Test coverage: 19/19 Bandit.t.sol + 23/23 BanditAttackResolution.t.sol.

### Added — Bandit attack animation kit (PR #150)

Full 60s-per-tick combat choreography in the Pixi-rendered web frontend (`apps/web/src/WorldMap.tsx`):
- **Camp idle (T0–T2.83)**: bandit camp sprite at region centroid with red-glow ramp.
- **Camp telegraph (T2.83–T3.0)**: camp morphs to 3 standing bandits with sin-jitter anticipation.
- **T4 battle (60s)**: post-resolution, full sequence based on outcome derived from snapshot diff:
  - **Defeat**: 7s walk to base → 7.5s circle into whirlwind → 1s flash + thrown-back impulse → 2s 3-frame death animation (back-flash → face-flash → tombstone-flash) → 8s tombstone fade. Region clears.
  - **Win**: converge + base-shake + cluster pause → 7s walk to next region (or off-map at 6 attempts) → 35s glow camp in destination.
  - **No-target advance**: bandits walk from old region to new without battle.
  - **Terminal escape**: walk off map edge.
- Pause-aware rendering: all motion (orbit/jitter/flicker) freezes when `worldPaused=true`.
- Pause-resilient diff: `prevBanditRef` + `lastBanditOutcomeRef` reconstruct the outcome from snapshot transitions; mid-tick reload recovers correctly.
- Sprite kit: hand-drawn 4-frame NE walk + horizontally-mirrored NW, top-row of provided 8-sprite SE walk + mirror SW, 3-frame death sequence, camp sprite. All live under `apps/web/public/sprites/`.

### Fixed — android wallet + Convex serialization (PR #144)

- **MWA owner-side crash** fix on landing wallet connect flow + version bumped to 0.1.14.
- **iconUri must be relative** for MWA — stray full-path ember dot in title removed.
- **ClanSummary integer fields** now tolerate Convex's stringified-decimal serialization (`String → Long.toIntFlexible()` path).
- **TreasuryViewModelFactory** added; `lineageStore` plumbed through `CodexViewModel`.
- **WATCH DEMO buttons** wired to the youtube submission video on the landing page.

### Operations

- **Bandit no-target eager-settle DoS hardening**: outer scan loop in `eagerSettleBanditCandidateRegion` now bounded by `MAX_BANDIT_EAGER_SETTLE_GLOBAL_SCAN = 100` to prevent runaway gas costs as clan count grows. `defendingClanSnapshot` storage→memory copy switched from full-array assignment to manual fixed-size loop bounded by `defendingClanScanCount` (max 12). Mirrored in diamond `LibSettlement` and monolith `ClanWorld.sol`.
- **Iterator safety in advancePassiveBanditStates**: switched to backward iteration (`for (i = length; i > 0; i--)`) so mid-loop bandit removals from eager-settle combat resolution don't skip pending bandits.
- **Heartbeat cadence**: documented canonical defaults — on-chain `HEARTBEAT_INTERVAL_SECONDS = 58s` guard, loop fire every 61s (3s slack to absorb RPC latency).
- **Elder runner v2** (Convex tick-driven): polls `getSnapshot:getSnapshot` every 5s, fires elders on tick change with 2s stagger. Replaces 180s nudge cadence.
- **Fresh-VPS bootstrap runbook** (`docs/runbooks/fresh-vps-bootstrap.md`, PR #145): 632-line cold-start procedure for a clean infrastructure deployment.
- **Indexer legacy `getWorldState` fallback removed** (PR #147): canonical-current diamond is the only decode path. Closes `currentSeasonNumber: null` cosmetic bug.

### Repository hygiene (PR #143)

- Stale `kickstart-mobile` references purged after the kickstart-token-tracker extraction.

---

## [2.2.0] — 2026-05-10

EIP-170 unblock release. Strips unused upkeep event scaffolding from `LibSettlement` to bring `HeartbeatFacet` and `FinalizeSeasonFacet` back under the 24,576-byte runtime limit, restoring the ability to deploy a fresh diamond. **All running deployments should redeploy from this release** — the `0xAd03…` diamond is permanently stuck at 26,265 byte `HeartbeatFacet` and cannot be upgraded to this code.

This release also captures the repo reorganization under the new `clan-world` GitHub org and the operational hardening that landed during the late-night migration sprint.

### Changed (BREAKING for ABI consumers)

- **`LibSettlement` upkeep events stripped** (PR #142): removed 6 events (`ClanEliminated`, `ClanDied`, `ClanStarvationChanged`, `ClanColdShortage`, `WallDegradedByCold`, `ClansmanColdDeath`), the `UpkeepLog` / `UpkeepLogKind` / `ClanDeathReason` types, and 3 helpers (`recordUpkeepLog`, `emitUpkeepLogs`, `deathReasonString`). All were unused by indexers/frontend (verified). HeartbeatFacet **26,265 → 23,938** (638 under EIP-170); FinalizeSeasonFacet **25,704 → 23,368** (1,208 under). All 27 facets now under limit.
- **Migration impact**: requires fresh diamond deploy. The wall-upgrade-reservation refund fix from `1ef2fd8` is preserved intact. Test `test_settlementUpkeepEmitsWinterColdAndDeathEvents` renamed to `test_settlementUpkeepAppliesWinterColdAndDeathConsequences` and pivoted from event-emission asserts to state asserts.

### Repository reorganization

- **`gold-bridge-monorepo` extracted** to https://github.com/clan-world/gold-bridge-monorepo (MIT). Wormhole NTT bridge moving GOLD between Solana ↔ Base. Standalone repo with full git history preserved via `git subtree split`.
- **`kickstart-token-tracker` extracted** to https://github.com/clan-world/kickstart-token-tracker (MIT). Public Solana mobile dapp for token launch / tracking. Goodwill release to the EasyA kickstart team.
- **Renamed v3 → clan-world-game** (this repo) under the `clan-world` GitHub org. Source-available (All Rights Reserved with carveouts), not open source.
- **Copyright standardized** to `Copyright (c) 2026 Clan World Game` across all repos.

### Operations

- **Diamond migration runbook** (`docs/runbooks/diamond-migration.md`): 281-line procedure for migrating between diamond addresses, including ownership transfer, season finalization, indexer + frontend pointer rotation.
- **Indexer legacy-ABI fallback** (`apps/server/convex/indexer.ts`): primary `getWorldSnapshot` decode falls back to a minimal `getWorldState` shape when struct decoding fails. Supports running against either the canonical-current diamond OR an older deployed diamond without code fork.
- **Alchemy free-tier eth_getLogs cap honored** (`MAX_LOG_BLOCK_RANGE: 9_999n → 9n`): default block range now compatible with Alchemy free-tier limits without paid upgrade.
- **Finalize watcher** (`~/bin/clanworld-finalize-watcher`): tmux companion to heartbeat-loop that detects `currentTick >= seasonEndTick && !seasonFinalized` and calls `finalizeSeason()` automatically. Prevents 6-hourly manual unsticks at season boundaries.
- **Elder runner** (`~/bin/clanworld-elder-runner`): 180s nudge cadence keeps all 4 elders working continuously with current tick context.

### Frontend

- **iPad PWA install**: `manifest.webmanifest` `start_url=/cockpit`, square Clan World logo as `apple-touch-icon`, full PWA-installable on iOS. Top respects `env(safe-area-inset-top)`; bottom extends full-bleed for fullscreen feel.
- **Direction B landing page**: redesigned landing pitch.
- **dev-ui app**: new SPA at https://dev-ui.clan-world.com for raw diamond function calls (transferOwnership, setHeartbeat, finalizeSeason, etc.) — orchestrator escape hatch separate from the gameplay frontend.

### Android cockpit (`apps/clan-world-mobile`)

- **Hearth screen** — live "next in Ns" tick countdown banner; bandit-alert pill; winter-active banner pill; approaching-winter banner.
- **Bulletin panel** — surfaces slot + tick + tx hash; meta line shows 0g dataHash hint between tick and tx.
- **Memory row** — source label gains dataHash hint; stamp suffix adds tx hash.
- **iNFT detail** — TKN line surfaces real 0G dataHash + encryptedKeyHash hint; vault tab matches treasury's 3-color amount palette.
- **Hall letter card** — surfaces `mostRecentTransferTick` as "Last Move".
- **Codex** — identity surfaces resolved `.skr` / `.sol` name; device chip shows model + Android version subline.
- **Sort order** — vault movements + comms sorted newest-first across all 3 call sites.
- **Cleanup** — dead `AnnotatedString` + `clanDisplayName` + `boldedMeta` imports + `CodexViewModel.disconnect()` removed; `whisperMetaText` lifted to shared `ui/components`.

### Bumped

- All Clan World workspace package versions to `2.2.0`.

---

## [2.1.1] — 2026-05-03

Demo operations patch for the live Base Sepolia world.

### Added

- **Diamond demo config controls**: `HeartbeatConfigFacet` now exposes owner-only `setClansmanCooldownSeconds(uint64)` for rapid manual testing and owner-only `triggerBanditSpawn()` to arm a one-shot forced bandit spawn on the next heartbeat.
- **Bandit trigger runbook notes**: Base Sepolia deployment runbook documents the 1-second cooldown setting and one-shot forced bandit spawn command.

### Changed

- Bumped all Clan World workspace package versions to `2.1.1`.

---

## [2.1.0] — 2026-05-03

Pre-demo feature drop. iNFT demo wiring, AXL transport, 0G storage scaffolding, graphics polish, and the full pipeline from the OpenAgents Track 2 submission scope.

### Added

- **ERC-7857 iNFT demo flow** (PR #494): `ClanAgentNFT` contract + `Mock7857Verifier` + Foundry deploy/mint/transfer scripts, Convex `inft.ts` mirror module (auth-gated by `INDEXER_SECRET`), `OwnerEditor` + cockpit `ZeroGTab` UI for mint/transfer/edit. Includes `safeTransferFrom` with `IERC721Receiver` callback, `transferProof.newDataHash` validation, per-item `IntelligentDataItem` event for full URI list reconstruction, and `waitForTransactionReceipt` between `writeContract` and UI refresh.
- **0G mainnet smoke test scaffolding** (`infra/0g/`, PR #494): `smoke-test.ts` exercises `ZeroGMemoryStore.save/recall` for all 4 elders, `setup-env.sh` derives env from `~/.secrets/clanworld-elder-wallets.json`, README documents operator runbook + cost model. Smoke test currently fails on mainnet `FLOW_CONTRACT` submit despite verified-correct address — open environmental issue, file fallback ready as demo path.
- **Gensyn AXL Docker sidecar** (PR #493): `infra/axl/` — `Dockerfile` (Go 1.25 builder + alpine runtime), `docker-compose.yml` (peered axl-1/axl-2 nodes on mutual TLS), `setup.sh` (peer-ID registration for clans 1-4), `test-whisper.sh` (end-to-end `elder whisper send/recv` over real AXL transport, validates `AxlPeerInbox` path not `FilePeerInbox` fallback).
- **8 new clan base sprite themes** (PR #491): 5-level progressions for `cobalt-keep` (knights), `bone-standard` (warlords), `gilded-hold` (merchants), `tide-wardens` (fishers), plus `pale-cathedral`, `amethyst-spire`, `black-forge`, `verdant-grove` shipped as ready-to-wire assets in `apps/web/public/bases/`. 4 active clans now reskinned via `MOCK_CLANS.basePng` swap; sprites scaled 30% from initial render for tile-proportional fit.
- **Live event ticker, top HUD bar, pixel burst effects** (PR #489): `EventTicker.tsx` streams chain events with clan-color coding, `TopHud.tsx` shows live tick + season progress + winter indicator + bandit countdown chip, `WorldMap` agent-log → pixel burst lifecycle. Demo cockpit feels alive instead of static.
- **`getSnapshot` exposes season/winter state** (PR #489): pure `deriveSeasonState(tick)` mirroring `LibSeason.sol` semantics — no chain or schema change needed; `seasonStartTick` / `seasonEndTick` / `winterActive` / `winterStartsAtTick` available client-side.
- **Diamond winter boundary tests** (PRs #472, #473, #474): `DiamondWinterBoundary.t.sol` covers winter-start parity, winter-end parity, and the `MAX_CROP_TRANSITION_PER_TICK` stress path against the diamond.
- **Expanded README** (PR #490): 86 → 215 lines. Game mechanics (regions, missions, wheelbarrows, vault, trading, bandits, winter, seasons, monument), agent architecture (Four Ælders, Elder CLI, Memory & iNFT, Communication channels), tech-stack table, beyond-the-game pitch.
- **AGENTS.md active-scope banner** (PR #495): one-line sticky directing all agents to Base Sepolia + 0G + AXL + KeeperHub V3 scope.

### Changed

- **`OG_STORAGE_API_KEY` → `OG_STORAGE_ENABLED`** (PR #492). The var is a feature flag, not a credential — real auth comes from `ELDER_MNEMONIC`-derived wallets. Misleading legacy name removed across `.env.template`, runner code, README, and 54 tests. Per-clan KV stream IDs (`OG_STREAM_ID_CLAN_<id>`) and per-elder peer-ID env vars (`AXL_PEER_ID_1..4`) added alongside.
- **iNFT identity plane env block added to `.env.template`**: `OG_INFT_ADDRESS`, `INFT_OWNER`, `INFT_NEW_OWNER`, `INFT_TOKEN_ID`, `INFT_METADATA_URI`, `INFT_TRANSFER_URI`, plus `VITE_OG_*` and `VITE_OWNER_EDITOR_ENABLED` for the cockpit owner-editor route.
- **Convex mirror mutations gated by `INDEXER_SECRET`**: all four `mirrorToken` / `mirrorTransfer` / `mirrorMemoryEntry` / `mirrorBulletin` mutations now require the secret arg matching the deployment env var, fail-closed when env unset.

### Fixed

- **`OwnerEditor` stale-state on RPC failure** (PR #494): unminted-tokenId loads now reset to canonical demo state instead of leaving the prior token's owner/data on screen.
- **`OwnerEditor` no longer optimistic-updates ahead of chain**: `setData` + `persistDemoState` only run after `loadToken()` re-fetches a confirmed receipt — rejected wallet prompts can no longer leave the cockpit lying about post-update state.
- **`safeNum` zero-string handling** (PR #489): `Number(v) || fallback` was treating valid `"0"` as falsy. Replaced with `Number.isFinite` check; `wood=0` / `resourceIn=0` events now render correctly.
- **Runner `txHash` surfaced on successful 0G saves**: one-line `console.log` in `ZeroGMemoryStore.save()` exposes the post-submit txHash + rootHash for ops visibility.

### Notes

- All 6 PR #494 review HIGHs (4 contract/Convex + 2 UI) addressed in 3 review rounds (orch inline + parallel opus-4-7 + codex-5-5 file-pointer dispatch). Reviews live in `docs/reviews/pr494-codereview-*.md`.
- 0G mainnet smoke test FLOW_CONTRACT issue documented in PR #494 body — likely an SDK 0.3.3 estimateGas quirk or unsatisfied Market contract permission gate. File fallback works; testnet path mapped if mainnet remains blocked.

---

## [2.0.2] — 2026-05-03

### Fixed

- **Diamond season finalization init guard** (PR #475): `FinalizeSeasonFacet.finalizeSeason()` now requires initialized app storage before it can run, preventing a public deploy race where `finalizeSeason()` could be called after the facet selector was installed but before `ClanWorldDiamondInit.init()` executed.
- **Diamond init season flag reset**: `ClanWorldDiamondInit.init()` explicitly sets `seasonFinalized = false`, so a newly initialized world cannot inherit poisoned pre-init season state.

### Added

- **Pre-init finalization regression coverage**: `testDiamondFinalizeSeasonBeforeInitReverts()` installs the season facet without running init and asserts `finalizeSeason()` reverts.
- **GPT-5.5 Pro PR 468 follow-up triage doc**: `docs/reviews/pr468-gpt-5-5-pro-followup.md` records the stale-but-useful review, the immediate fix, and linked post-demo hardening issues.

### Changed

- Bumped the root package and Clan World workspace package versions to `2.0.2`.

---

## [2.0.1] — 2026-05-02

### Fixed

- **Dead-target cleanup helpers consolidated in `LibBanditCombat`** (PR #469). `releaseDefendersForDeadTarget` + `abortBanditAttacksForDeadTarget` were literally duplicated between `LibBanditCombat` (`public`) and `LibSettlement` (`internal`) after the round-1 SuperSwarm `markClanDead` parity fix. Both opus 4.6 + opus 4.7 r2 reviews flagged the silent-divergence risk: any future change to one copy without the other would re-create the round-1 parity break. Canonical copy now lives in `LibBanditCombat`; `LibSettlement` calls into it. Both functions changed from `public` to `internal` — gets inlined into callers, saves ~700 gas per call vs DELEGATECALL (also addresses opus 4.6 / opus 4.7 r2 MEDIUM about library function visibility). All 58 diamond parity tests pass.

### Still queued for future patch releases

The remaining v2.0.1-target items from the v2.0.0 changelog (lazy-settlement clan death event-emission parity, `_settleClan` 6× duplication, 41 library functions `public→internal` sweep, storage layout field-offset snapshot, `bac7c6a` write-then-overwrite refactor, `MAX_CROP_TRANSITION_PER_TICK` access-modifier parity, `LibDiamond.setContractOwner` zero-address guard) ship in subsequent patch releases.

---

## [2.0.0] — 2026-05-02

### Highlights

> [!IMPORTANT]
> **Diamond proxy migration — major architecture change.** The monolithic `ClanWorld.sol` engine (~3,500 lines, hitting EIP-170 bytecode limit) is replaced by an EIP-2535 Diamond proxy with 24 facets sharing a single `LibStorage.appStorage()` slot. The 52 `IClanWorld` selectors are preserved bit-for-bit — game logic, events, and ABI are identical from a consumer's perspective. The on-chain deploy address changes; clients hardcoding the v1.x contract address must redeploy. PR #468.
>
> *v1.x = monolith era. v2.x = diamond era. Clan World is pre-prod with no on-chain mainnet state to migrate; the version bump signals the architectural cut.*

### Added

- **`packages/contracts/src/diamond/`** — full diamond infrastructure
  - `Diamond.sol` proxy entry-point + selector router
  - `IDiamondCut.sol` + `IDiamondLoupe.sol` admin/introspection
  - `ClanWorldDiamondInit.sol` single-shot init mirroring monolith constructor field-for-field
  - `OwnershipFacet.sol` exposing `transferOwnership(address)` + `owner()` for upgrade-key rotation
  - 24 logic facets covering heartbeat, settlement, submit-orders, bandit lifecycle/combat/spawning, season finalize, gold/vault/blueprint/bundle/clan-ownership transfers, treasury, market views, world/clan/bandit views, raw views, derived views, and diamond cut admin
  - 11 shared libraries: `LibStorage`, `LibDiamond`, `LibSettlement`, `LibSettlementMath`, `LibBanditCombat`, `LibBanditLifecycle`, `LibBanditSpawning`, `LibSeason`, `LibMission`, `LibGameRules`, plus `LibOrder*` order-handling libs
- **`packages/contracts/script/DeployDiamond.s.sol`** — full deployment lifecycle: 24 facets across 3 cut batches → `ClanWorldDiamondInit.init()` → `ClanWorldLens` → 6 boundary tokens → 4 StubPools → `initTreasury` → token seeds → `seedPools()`. CI dry-runs the script.
- **`packages/contracts/script/DiamondSelectors.sol`** — per-domain selector enumeration (52 `IClanWorld` selectors mapped across 24 facet cuts).
- **`packages/contracts/test/diamond/`** — 1,688-line `DiamondSkeleton.t.sol` parity test suite + `DiamondEventParity.t.sol` covering 58 tests across heartbeat / settlement / transfers / views / bandit flows. Field-level equality verification between monolith and diamond.
- **`StorageLayoutGuard.t.sol`** — asserts `clan.world.app.storage.v1` and `clan.world.diamond.storage.v1` slot constants stay distinct + match expected keccak hashes.
- **`docs/architecture/diamond-pattern.md`** — operator/contributor guide to the diamond architecture.
- **CI gates** (`.github/workflows/contracts.yml`, `scripts/check-contract-sizes.mjs`):
  - Per-facet EIP-170 size enforcement (24,576 bytes)
  - Storage layout snapshot guard
  - Diamond parity test suite as separate job
  - `DeployDiamond.s.sol` dry-run

### Changed

- **`Deploy.s.sol`** is now a 3-line wrapper (`contract Deploy is DeployDiamond {}`) — operator muscle memory deploys the diamond, not the oversized monolith. Zero monolith-deploy paths remain.
- **Off-chain ABI consumers** (`packages/shared/src/adapters/IChainClient.ts`, Convex `apps/server/convex/`) regenerated from updated `packages/contracts/abi/IClanWorld.json`. Event field renames (`wood/iron/wheat/fish` → `woodDelta/ironDelta/wheatDelta/fishDelta`) propagated via `pnpm gen:chainclient-abi`.

### Fixed

Two SuperSwarm rounds × 5 reviewers each (Codex 5.4 + 5.5 + Gemini 3 Pro + Opus 4.6 + 4.7) surfaced and resolved 5 MUST-fix items:

- **OwnershipFacet** added so deployer EOA isn't permanent upgrade key (4-way convergent finding)
- **`Deploy.s.sol` rerouted to diamond** (was still deploying oversized monolith)
- **`DeployDiamond.s.sol` completed** with treasury init + pool seeding (was stopping after facet cut)
- **`MAX_CROP_TRANSITION_PER_TICK`** restored to 48 — matches monolith; silent parity break in audited safety constant
- **`markClanDead` cleanup parity** restored: `_clearDefender`, `_refundUpgradeReservation`, `_releaseDefendersForDeadTarget`, `_abortBanditAttacksForDeadTarget` all mirrored from monolith (opus 4.6 unique find — others missed entirely)

Plus:

- **Settlement reservation simulation** (`bac7c6a`): diamond simulation now tracks wood/iron/blueprint reservations during commit. Diamond actually IMPROVES on monolith here per opus 4.6 audit (monolith only tracked wheat in simulation).
- **Season finalization tick boundary** (`e713728`): `currentTick = last tick closed/settled`. Heartbeat freezes at `seasonEndTick`, `finalizeSeason()` settles through `currentTick`, sets `seasonFinalized=true`. Next heartbeat rolls. No double-processing.
- **`LibDiamond.addFunctions/replaceFunctions/initializeDiamondCut`** now have `enforceHasContractCode()` checks — owner-footgun protection against bad cuts to EOAs or dead addresses.
- **`chainclient-abi` CI** — regenerate ABI fragment to track event field renames in `IChainClient.ts`.

### Removed

- `derivedViewsFacetVersion()` orphaned external function (was exposed but not wired to selectors)
- `rawViewsSelectors()` legacy 26-entry function fully replaced by 4 per-domain functions
- `ClanWorldFacetPlaceholders.sol` 12 empty placeholder contracts

### Deferred to v2.0.1

- **Helper consolidation** (PR #469): `releaseDefendersForDeadTarget` + `abortBanditAttacksForDeadTarget` literally duplicated between `LibBanditCombat` and `LibSettlement` after the round-1 markClanDead fix. Both opus 4.6 + opus 4.7 r2 reviews flagged the silent-divergence risk.
- **Lazy-settlement clan death event-emission parity** (codex 5.4 r2 MEDIUM): observer/indexer-facing only; on-chain state correct.
- **6× duplicated `_settleClan` private function** across 6 facets (opus 4.6 MEDIUM): extract to shared lazy-settle.
- **41 library functions `public` instead of `internal`** (opus 4.6 MEDIUM): DELEGATECALL overhead. Optimization only.
- **Storage layout field-offset snapshot** beyond slot constants (opus 4.7 r2 MEDIUM).
- **`bac7c6a` write-then-overwrite pattern** in `LibSettlement.commitSimulation` (opus 4.7 r2 MEDIUM).
- **`MAX_CROP_TRANSITION_PER_TICK` access-modifier parity** (opus 4.7 r2 LOW).
- **`LibDiamond.setContractOwner` zero-address guard** (opus 4.7 r2 LOW).

### Review coverage

- 2× SuperSwarm rounds (5/5 reviewers each: Codex 5.4 + 5.5 + Gemini 3 Pro + Opus 4.6 + 4.7) — convergent SHIP verdict at HEAD `1e01c38`
- 1× cloud (Copilot + ChatGPT codex bot)
- Local 3-tier review on individual round-1 fix commits

### Migration notes (for ops)

The deploy address changes — Diamond.sol is a different contract type than the Clan World monolith. Consumers hardcoding the v1.x `ClanWorld` address need to redeploy with the new Diamond address. Off-chain ABI consumers regenerate from `packages/contracts/abi/IClanWorld.json` (unchanged shape; `pnpm gen:chainclient-abi` keeps `IChainClient.ts` in sync).

`OwnershipFacet.transferOwnership(address)` enables upgrade-key rotation post-deploy. Recommend transferring ownership to a multisig or DAO immediately after the initial deploy + diamond cut.

---

## [1.2.0] — 2026-05-02

### Highlights

> [!NOTE]
> **v5 animation demo-day subset.** v1.2.0 lands the high-ROI slice of the full v5 animation north-star spec — ships the premium-feel cues that read on stage without committing to the multi-week full implementation. Three implementation rounds, six fix-rounds across 3-tier local review × 3 + SuperSwarm × 4 + cloud (Copilot + ChatGPT codex bot), all convergent CLEAN. PR #455.
>
> - **Z-sort architecture fix** — single sortable `worldDynamic` container with global `zIndex = Math.round(y)` enables true 2.5D occlusion (clansman walking behind a building actually renders behind). Previously each entity type lived in a separate Pixi `Container`, breaking cross-type Y-sort even with `sortableChildren = true`. Spec §14 rewrite captures the architectural fix + child-of-host attachment patterns + combat reparenting protocol.
> - **Building breathe** — every base does a 1-pixel vertical sin sway at proper 0.25 Hz (4-second period), with position-derived phase offsets so adjacent bases desync. Invisible until missing — single biggest premium-feel cue.
> - **Day/night cycle** — single GPU `ColorMatrixFilter` on the world container cycles through 4 keyframes (dawn / day / dusk / night) over 30 ticks. Per-base window glow Graphics (alpha tied to `1 - daylightBrightness`) lights up bases at night.
> - **Carry indicators** — fill bar above each traveling clansman tweens 0→1 during gather/travel, drains on deposit. 16×3px parchment-cream fill on ink background with 1px outline.
> - **Tap-to-zoom + selection ring** — `pixi-viewport.animate` to tapped sprite over 400ms easeInOutQuad with scale 2.0; rotating dashed ring (8 segments, 1Hz rotation, 0.5Hz alpha pulse) attached as first child of the selected sprite. Esc tweens viewport back to fit-world.
> - **Counter ticks (RollingNumber)** — vault values wrapped in `<RollingNumber>` with `min(400, 100 + log2(|delta|)*40)`ms easeOutQuad tween; `+N` (green) / `-N` (red) delta floater drifts up 16px and fades over 800ms. Demo-only `useDemoResourceJiggle` 6s interval mutates one random resource so the animation is observable on stage without backend changes.
> - **Combat vignette (3.7s)** — replaces the spec's full-tick 10-phase choreography per codex DA recommendation. Triggered at start of pre-attack tick (or last 4s with precise tickEpoch): world dim fade-in 600ms → combatants reparent to `combatHighlight` above dim → advance to base center 1.5s → idle/jitter 0.5s → full-screen white flash 200ms → resolution 1.5s (success: bandit launch + shrink/fade + defenders cheer; failure: clansmen knockback + wall scale.y drop). `?combat=success|failure` URL toggle for stage flexibility. §10.8 day/night cap rule (`max(0.2, 0.55 - existingDarkness)`) so combat at night stays readable.
>
> *Full v5 animation spec authored by Liam (1,172 lines) is the post-hackathon north-star target — committed but explicitly out of scope for this release. Demo-day subset (235 lines) is the ruthless cut shipped here.*

---

### Added

- `docs/planning/clanworld_v5_animation_spec.md` — full v5 animation north-star (post-hackathon target)
- `docs/planning/clanworld_v5_demo_day_subset.md` — hackathon-scope cut (8 items, 13h budget)
- `apps/web/src/WorldMap.tsx` — tiered Pixi container layout (`terrainBackground`, `terrainAccents`, `worldDynamic`, `inWorldEffects`, `selectionRings`, `bubbleLayer`, `screenEffects`); building breathe ticker; day/night `ColorMatrixFilter` + per-base window glow; tap-to-zoom + dashed selection ring + Esc clear; combat vignette state machine with `combatVignetteRef` + `banditDefeatedRef` lifecycle; carry-indicator child container per traveling clansman
- `apps/web/src/components/cockpit/tabs/VaultTab.tsx` — `RollingNumber` component (rAF tween + `+N`/`-N` floater) wrapping every vault counter; `useDemoResourceJiggle` 6s mock-tick hook

### Fixed

- **Z-sort:** `sortableChildren` only sorts within a single Container — the original §14 layer split (buildings layer 3, clansmen layer 5) made cross-type Y-sort impossible. Single `worldDynamic` container resolves
- **Carry indicator memory leak:** `t.gfx.destroy()` wasn't recursive, leaving carry-bar `Graphics` children to accumulate per-spawn — `destroy({ children: true })` at both expiration sites
- **Breathe frequency:** `Math.sin(t / 4000)` gave a ~25 second period (≈0.04 Hz), not the spec's 4-second period (0.25 Hz). Sin argument is in radians; correct formula is `Math.sin(t * Math.PI / 2000)`
- **Day/night live tick:** `dayNightCb` registered once at Pixi init captured the initial `snapshot` prop forever, leaving the cycle stuck on the `Date.now()` fallback. `snapshotRef` updated by useEffect resolves
- **Bandit fallback selection:** `banditIcon` (Graphics) had `position=(0,0)` and drew shapes at world `(iconX, iconY)`. Tap-zoom called `target.getGlobalPosition()` which returned `worldDynamic` origin, snapping camera to map (0,0) instead of bandit. Position the icon at `(iconX, iconY)` and draw locally
- **Combat dim cap rule:** Earlier `min(0.55, 1 - brightness)` was inverted — at full daylight (brightness=1), combat dim collapsed to 0. Replaced with `max(0.2, COMBAT_DIM_ALPHA - existingDarkness)`: full dim during day, gentle clamp at night
- **Bandit pulse vs vignette:** pulse ticker overwrote `bandit.alpha` every frame after the combat ticker, silently nullifying the success-outcome fade-out. Pulse `onTick` early-returns when `combatVignetteRef.current` is set
- **Combat vignette trigger window:** `getMsUntilTickClose()` falls back to 60s when `tickEpoch` is unavailable, but logs-driven `liveTick` advances every ~20s. The `msUntilTickClose <= 4000` branch never fired before the tick advanced. Detect fallback mode and trigger at start of pre-attack tick instead of last 4s
- **Defeated bandit reappearance:** `finishCombatVignette` unconditionally restored `bandit.alpha = banditStart.alpha`, popping the defeated bandit back at full opacity after a `?combat=success` fade-out. New `banditDefeatedRef` flag set on natural success; respected by `redrawBandit`, pulse `onTick`, and post-vignette restore
- **`Assets.load` mid-vignette regression:** Earlier guard early-returned the entire `.then()` callback, permanently losing the bandit sprite if the asset resolved during the 4s vignette window. Now creates the sprite + assigns to `drawn.banditSprite` unconditionally; only the `redrawBandit()` call is gated
- **`selectTarget` during vignette:** new selection ring during the dimmed combat scene undercut focus and could persist after dim layer faded. Early-return when `combatVignetteRef.current` is set
- **`relayout` during vignette:** snapshot-driven relayout's `redrawBandit()` could snap the reparented bandit back to home anchor mid-choreography. Skip when `combatVignetteRef.current` is set
- **`RollingNumber` rapid-update jump + StrictMode skip:** `previousValueRef.current` was updated immediately in the effect, so back-to-back updates and StrictMode double-invoke produced visible jumps. Two refs (`renderedValueRef` for current displayed value + `targetValueRef` for last seen target) decouple tween-from from no-change-detection
- **Selection ring Graphics leak:** `clearSelection` removed the ring from its parent and nulled the ref but never called `ring.destroy()`. Old rings were JS-GC-able but their WebGL geometry buffers stayed in VRAM until GC fired. `selected.ring.destroy()` before nulling
- **VaultTab `delta` string stale:** `useDemoResourceJiggle` mutated only `value`, leaving the static `delta` string showing conflicting movement. Now updates both alongside

### Deferred to post-demo

- Full v5 spec implementation (combat full-tick 10-phase choreography, strategic 8×8 atlas, cross-fade transitions, Submission 2 transfer demo cinematic, monument tier-up cinematic, speech bubble anti-occlusion, particle pool of 32, asset pipeline validation)
- Bridged GOLD token integration (PR #466 scoping doc only — no code changes; ships post-Diamond-proxy)
- Cosmetic cleanups: `frame.sat` dead config, `combatPlayedTickRef` comment-vs-code mismatch, `combatHighlight` zIndex no-ops, level-badge orphaning defensive path, inline `<style>` collision risk

### Review coverage

- 3× local 3-tier (Codex 5.5 + Claude Opus 4.7 + Gemini 3 Flash) — 1 fix-round per round
- 4× SuperSwarm (Codex 5.4 + 5.5 + Gemini 3 Pro + Opus 4.6 + 4.7) — 2 fix-rounds before convergent CLEAN
- 1× Cloud (Copilot + ChatGPT codex bot) — 1 fix-round
- 13 commits on the feature branch (3 docs + 3 implementation rounds + 7 fix-round commits)

---

## [1.1.0] — 2026-05-02

### Highlights

> [!NOTE]
> **GOLD Bridge workspace + GPT-5.5 Pro audit hotfix bundle.** v1.1.0 introduces the cross-chain GOLD bridge as a sibling workspace and lands 13 MUST-fix findings from external static review across 8 wave-stack fixes:
>
> - **GOLD Bridge workspace (#412)** — standalone `gold-bridge-monorepo/` with the 9-decimal upgradeable Base GOLD token, NTT (Wormhole Native Token Transfer) deployment helpers, recovery/timelock tooling, deployment cockpit UI, and Reown wallet integration. Wired into the root pnpm/turbo workspace. **Not yet integrated into Clan World game flows** — bridge ships first, integration follows in v1.2.
> - **`finalizeSeason()` now actually finalizes** — emits `SeasonFinalized(tick, rankedClanIds, scores)` per spec §13. Was previously dead code (`// TODO Phase 3`). Boundary-freeze guard at the top of `heartbeat()` ensures the engine cannot replay closed ticks while limbo-pending. All 9 clan-state mutators reject submissions during frozen-unfinalized limbo.
> - **Heartbeat upkeep-before-mission ordering** — `_settleClanThroughTick` mirrors lazy-settle path. Heartbeat advances `lastSettledTick`. New `HeartbeatLazyParity.t.sol` proves both paths converge.
> - **Cooldown is submit-side only** — stripped erroneous cooldown reset on natural mission completion. Elders chaining gather→deposit→gather no longer pay ~50% extra wall-clock per cycle.
> - **Convex real-indexer rolled out** behind `CLANWORLD_USE_REAL_INDEXER` flag — webhook tx-decoder, idempotent `(txHash, logIndex)` dedup, 5-block confirmation depth, 8 dedicated tables (`chainEvents`, `tickHistory`, `clanView`, `marketState`, `banditView`, `pricePoint`, `eventCheckpoint`, slim `worldSnapshot`). Webhook validates `receipt.status`, `receipt.to`, payload `engineAddress`; filters logs to engine before parseEventLogs. Mutually exclusive with v1.0.0 fake heartbeat. Indexer cursor isolation: webhook ingests events but only `pollLogs` advances the contiguous-scan cursor — closes a permanent-event-loss class.
> - **Reservation-aware vault primitives** — `_spendableAfterReleasing` + `_deductFromVault`. Bandit theft and winter wood burn now respect resource reservations.
> - **Demo-mode default flipped to opt-in** — `DEMO_MODE` is OFF by default. Prepares for live-chain UAT.
> - **Phase 5B v4.6 economy alignment** — clan death from starvation with next-tick semantic, traveling defender cleanup on dead target, treasury init validation, bandit forbidden region spawn ban (UnicornTown/DeepSea), bandit defeat 1e18 Gold reward, `RealChainClient.submitOrders` field preservation.
> - **CI hardening** — `chainclient-abi.yml` now installs `foundry-rs/foundry-toolchain@v1` AND hard-fails if forge missing. Loud-warns to stderr if dev runs without forge instead of silent-skip. Closes a class of ABI drift that v1.0.0's silent-skip masked.
>
> *v1.0.0 shipped a feature-complete game. v1.1.0 adds cross-chain bridge plumbing for cross-game GOLD flows, lands 13 MUST-fix findings from external GPT-5.5 Pro static review, and hardens the on-chain contract through 8 sequential review-and-fix waves — the last work before live UAT.*

---

### Audit-Driven Hotfixes (8 Waves)

13 MUST findings from GPT-5.5 Pro external static review of v1.0.0, validated by parallel codex + Claude validators (12/13 confirmed by codex; 13/13 confirmed by Claude with 2 forge tests proving bugs present). Implemented as 8 sequential codex waves with super-swarm review rounds catching fix-introduced regressions.

#### Wave 1 — silent-skip → loud-warn + demo-default flip + RealChainClient fields
- **MUST-12** `9af9834` + `a98f66b` — `pnpm test/build/check:abi` loud-warns when forge missing instead of silent-skip; `chainclient-abi.yml` adds hard-fail Foundry guard + foundry-toolchain install step
- **MUST-13** `7e97f7a` → `c635e8f` — flip `DEMO_MODE` default to opt-in (was always-on); gate fake heartbeat cron behind `CLANWORLD_USE_FAKE_HEARTBEAT`; webhook reads tx data instead of calling fake mutation
- **MUST-11** `cd10fba` → `6256043` — `RealChainClient.submitOrders` preserves `targetClanId`, `marketToken`, `marketAmount`, `maxGoldIn`, withdraw fields (was hardcoded to zero)

#### Convex real-indexer rollout
- **C1 schema** `0af22f9` — 8 new Convex tables
- **C2-C8 bulk** `4ba21c8` — webhook decoder + cron pollers + cutover plan, feature-flagged behind `CLANWORLD_USE_REAL_INDEXER`
- **Critical fix-round** `7e298bb` — addresses 5 critical findings from claude reviewer (cold-start RPC bomb prevention, 15s receipt timeout, async snapshot scheduling, 5-block confirmation depth, frontend-compat `clans[]` backfill)

#### Wave 2 — Phase 9 bandit + treasury (4 fixes bundled)
- **MUST-4** `fb399bb` → `58436d2` — bandit forbidden region spawn ban (UnicornTown, DeepSea)
- **MUST-9** — dead-target traveling defender cleanup
- **MUST-10** — treasury init validation (zero/duplicate guards)
- **Synthesis Gap 9.5** — bandit defeat reward includes 1e18 Gold per spec §6.17

#### Wave 3 — heartbeat upkeep-before-mission ordering (MUST-2)
- **`0b2830c`** — `_settleClanThroughTick(clanId, throughTick)` mirrors `_settleClan` upkeep-then-mission ordering. Heartbeat now advances `lastSettledTick`. 7 existing tests updated (they had codified the buggy ordering); new `HeartbeatLazyParity.t.sol` verifies path equivalence.

#### Wave 4 — Phase 9 candidate eager-settle + reservation primitives + upgrade queue
- **`e466189`** — `_eagerSettleBanditCandidateRegion` settles candidates before pickTarget (MUST-5); one-pending-upgrade-per-type guard replaces multi-pending dependency chain (MUST-7); reservation-aware vault primitives — bandit theft + winter wood burn now respect reservations (MUST-8)

#### Wave 5 — `finalizeSeason()` emit-only + auto-roll guard (MUST-1)
- **`3c086d7`** → **`82d0d44`** — `finalizeSeason()` body implements eager-settle + rankings + `SeasonFinalized(tick, rankedClanIds, scores)` emit. Per Liam Decision 0.3, no payout in v1.1.0 (deferred to v1.2+). `_resolveWorldEvents` only auto-rolls when `seasonFinalized == true` — prevents bypass.

#### Wave 6 — strip cooldown on natural completion (MUST-3)
- **`f1e8bfd`** → **`98521ff`** — Per spec v4.2 §10.2, cooldown is a submit-side rate-limit only. Stripped the erroneous reset in `_completeMission`. Saves Elders ~50% wall-clock on chained gather→deposit→gather cycles.

#### Wave 7 — round-1 super-swarm fix bundle (4 MUSTs + 3 SHOULDs)
Round-1 super-swarm (codex 5-3 + 5-4 + 5-5 + Gemini 3.1 Pro) on the post-Wave-6 state caught 4 convergent HIGH bugs, all addressed in Wave 7 `5c68235`:
- **MUST-7.1** — `SeasonFinalized` event ABI drift; regenerated artifacts; new `SeasonFinalizedAbi.t.sol` topic-hash test
- **MUST-7.2** — `finalizeSeason` boundary off-by-one; freeze heartbeat at `seasonEndTick - 1` until finalized
- **MUST-7.3** — Indexer cursor isolation (webhook does NOT advance `eventCheckpoint`) + auth validation (`receipt.status`, `receipt.to`, payload `engineAddress`, log filtering)
- **MUST-7.4** — `validateSubmitOrderPayload` allows `DefendBase` self-orders
- **SHOULD-7.5/7.6** — snapshot block pinning + `pricePointFromEvent` direction

#### Wave 8 — round-2 super-swarm regression fix
Round-2 super-swarm caught Wave 7's MUST-7.2 freeze placement bug (freeze at end of heartbeat → repeated tick replay → bandit `probabilityAccum` runaway). Wave 8 `d6dd56b`:
- **MUST-8.1** — moved boundary freeze to TOP of `heartbeat()`; engine never re-enters same closed tick
- **MUST-8.2** — `_requireNoPendingSeasonFinalization()` guard added to all 9 clan-state mutators (`submitClanOrders`, `settleClan`, `settleClansman`, `mintClan`, `transferClanOwnership`, `transferGold`, `transferVaultResource`, `transferBlueprint`, `transferBundle`)
- **SHOULD-8.3** — snapshot pinning unconditionally uses `receipt.blockNumber` (not payload override)

---

### Phase 5B Economy Alignment (#378)

Path A canonization of v4.6 economy semantics:
- **Clan death from starvation** with `tick+1` next-tick onset semantic (`starvationStartsAtTick = tick + 1` on first detection during settlement)
- **Strict less-than kill check** — `effectiveStarvationStartsAtTick < tick` (kill fires only AFTER onset tick); deferred kill cadence
- **Winter mechanics** — wheat plot lock at winter start (`_lockWheatPlotsForWinter`), restart after winter end (`_restartWheatPlotsAfterWinter`), winter doubles wheat+fish upkeep, winter wood burn per base + per living clansman, cold damage accrual that can degrade walls or kill clansmen
- **Gather actions** — reschedule until carry cap or plot depletion (was: single 4-tick batches always terminate to WAITING)
- **`ResourcesDeposited` event rename** — `wood/iron/wheat/fish` → `*Delta` (clarity-first, per Clan World no-backcompat policy; pre-prod GA)
- **`WOOD_CAP = 15e18`** distinct from `CLANSMAN_CARRY_CAP = 10e18` (wood uses WOOD_CAP)

---

### Cross-Phase Plan + Spec Doc Updates

- **Phase 9 v4.6 bandit redesign addendum** (#341) — Path A canonize impl
- **Phase 12 agent infrastructure rework plan** (#373) — design doc for hybrid `CLAUDE_CONFIG_DIR` (shared `agents/.claude` + per-elder `elder-N/.claude`); 376 lines; ready for v1.2 implementation
- **Phase 5B economy alignment doc** (#378) — UAT checklist updated to validate current code; doc accuracy fixes for winter mechanics, gather rescheduling, wood cap, starvation timing

---

### Validation at Release HEAD

- forge test: **352/352 passing** (was 318 baseline at v1.0.0; +34 from waves 1-8 + Phase 5B)
- pnpm typecheck green
- pnpm test:chainclient-abi green
- pnpm test:abi-parity green
- pnpm -F @clan-world/{shared,runner,agents,server,web} all green
- ABI parity test wired in CI; SeasonFinalized topic-hash directly verified

### Sources

- GPT-5.5 Pro static review of v1.0.0 main — 13 MUST-fix release blockers
- Codex validator (12/13 confirmed) + Claude validator (13/13 + 2 proof tests)
- Round-1 super-swarm: 6 LLMs (codex 5-3 + 5-4 + 5-5 + Opus 4.6/4.7 silent-failed + Gemini 3.1 Pro) — `docs/reviews/pr413-codereview-*.md`
- Round-1 synthesis: `docs/reviews/pr413-synthesis.md`
- Round-2 focused review on Wave 7 deltas (codex 5-4 + 5-5 + Claude) — `docs/reviews/pr413-synthesis-round2.md`
- Convex indexer hybrid plan synthesized from parallel codex + Claude planners
- Merge-fix diagnose-only convergence (codex 5-5 + Claude feature-dev:code-reviewer) — both ROOT_CAUSE_FOUND identifying test fixture issues, not contract bugs

---

## [1.0.0] — 2026-05-01

### Highlights

- Full on-chain game engine: 10 contract phases covering gathering, markets, buildings, bandits, winter, and clan death — 310/310 Forge tests green at ship
- Four AI Elder agents run autonomously on Base Sepolia, each submitting real transactions via `RealChainClient` on every heartbeat tick
- Resource reservation invariant enforced: `WithdrawResources` and all OTC transfer paths are reservation-aware, closing a class of vault-drain exploits found during pre-release audit
- ABI drift is structurally impossible: generated `CLAN_WORLD_ABI` replaces every hand-rolled tuple; `gen-enums.mjs` and `gen-constants.mjs` keep TypeScript in sync with Solidity
- Pixi.js canvas world map with 8 regions, isometric base sprites at five upgrade levels, clansman walking animations, speech bubbles, pinch-to-zoom, and a live scoreboard
- Browser-first frontend with direct access to the live map and cockpit
- Convex real-time backend with heartbeat webhook, safety-net cron, and mock-mode for offline development
- ABI parity test wired into CI — contract shape drift fails the build automatically

---

## Game Engine — Phases 1 through 10

The contract evolved through ten ordered phases. Each phase is its own ratcheted-up version of the engine, with its own super-swarm review pass, its own fix-rounds, and its own integration tests. They merge sequentially: each phase's `dev-phase-N-*` integration branch lands into `dev-merge` only after the prior phase is green.

### Phase 1 — Real Clan World engine (#79, #98)

> [!NOTE]
> **Foundation Engine Online:**
> 1. **`ClanWorld.sol`** — the real on-chain game contract replacing the planning stubs
> 2. **`mintClan`** — clan creation with EVM owner address
> 3. **Order submission** — clansman action queue with explicit `ClanOrder` struct
> 4. **Heartbeat skeleton** — the tick-advancement entry point for the world
> 5. **Lazy settlement core** — clans replay tick-by-tick when next touched (the central performance pattern)
> 6. **View-only simulation** — derived getters can preview state without writing (#261)
>
> Phase 1 is the *substrate*. Without lazy settlement and without the on-chain entry point, none of the later phases compose. Everything from gathering to bandits assumes "I can read the freshest derived state without paying gas," and Phase 1 is what makes that affordable.

- Phase 1 real engine: `mintClan`, order submission, heartbeat, lazy settlement core (#79, #98)
- View-only settlement simulation for derived getters (#261)

### Phase 2 — Economy foundation (bundle E, #91, #137)

> [!NOTE]
> **First Resource Loop:**
> 1. **Initial economy types** — `ResourceType` enum (Wood / Iron / Wheat / Fish), `Vault` struct, vault accounting
> 2. **Resource flows** — gather → vault → carry primitives that later phases extend
> 3. **`bundle E`** — collapses the post-rebase Phase 2 implementation onto the pre-Phase-3 substrate
>
> Phase 2 is the *vocabulary*. Once it landed, every subsequent phase could speak in terms of "wood, iron, wheat, fish" instead of inventing its own resource shapes.

- Bundle E: Phase 2 economy (#91 post-rebase, #137)

### Phase 3 — Mission assignment + lazy settlement (#176–#181, #115)

> [!NOTE]
> **Missions Have Time:**
> 1. **`submitOrders`** — the public order queue API used by Elders + UI
> 2. **`defend_base`** — first defensive mission type, prerequisite for the bandit phase
> 3. **Mission timing rules** — every action gets a duration, a `settlesAtTick`, and a settle path
> 4. **39-case Foundry test spec** — exhaustive coverage scaffold for mission state transitions (#115)
> 5. **Bundle A `feat/phase-3-test-spec`** — the test spec that locked Phase 3 mechanics into the contract
> 6. **Orch-r1 integration fixes** — review-driven correctness pass (#181)
>
> Phase 3 is when the engine *gains time*. Before this, every action was instantaneous; after this, missions take ticks to complete and clansmen can be in flight. This is the substrate for everything that *waits* — bandits camping, walls building, winter approaching.

- Phase 3 mission assignment + lazy settlement: `submitOrders`, `defend_base`, mission timing rules (#176, #177, #178, #179, #180, #181)
- Phase 3 integration fixes from orch-r1 review (#181)
- Phase 3 Foundry test specification — 39 cases (#115)
- Bundle A: `feat/phase-3-test-spec`

### Phase 4 — Heartbeat + progression (#173–#175, #182, #183, #239)

> [!NOTE]
> **The World's Pulse:**
> 1. **Permissionless heartbeat** — anyone can fire ticks; rate-limited via `nextHeartbeatAtTs`
> 2. **Domain-separated RNG** — `keccak256(seed, clan, csId, nonce)` per use site, no cross-contamination
> 3. **Winter + season timers** — the calendar machinery that Phase 10 hangs winter mechanics on
> 4. **Heartbeat ordering fix** — HIGH spec drift between heartbeat and lazy paths corrected (#239)
> 5. **Tick seed publication** — every tick commits a fresh RNG seed visible to indexers and views
>
> Phase 4 is *autonomy*. Once the heartbeat is permissionless, the game runs whether or not any specific keeper is alive — multiple keepers can race, the rate-limit handles contention, and the off-chain runner becomes a *helper* instead of a *requirement*.

- Phase 4 permissionless heartbeat, RNG helpers, winter/season timers, heartbeat ordering fix (#173, #174, #175, #182, #183, #239)
- Phase 4 heartbeat ordering (HIGH spec drift) (#239)

### Phase 5 — Gathering + deposit (#188, #190, #234, #298, #371, #356)

> [!NOTE]
> **Resources Move:**
> 1. **Wood gathering** at forest regions — the first real resource action
> 2. **Deposit action** — vault-to-base resource transfer that settles at clan's home region
> 3. **Per-tick yield** with carry-cap enforcement
> 4. **Starvation next-tick semantics** — first-tick starvation flags, second-tick kills (#234)
> 5. **`ResourcesDeposited` event ordering** — explicit `atTick` field for indexers (#234, #298)
> 6. **Wood carry cap clamping** — clansman can't over-carry forest yield (#234)
> 7. **v4.6 Phase 5 economy alignment addendum** — spec-vs-impl reconciliation (#356)
>
> Phase 5 is the moment Clan World stops being a planning doc and *starts working*. A clansman walks to the forest, chops wood, walks home, deposits — every step settles on-chain and emits an event a UI can render.

- Wood gathering, deposit action, per-tick yield, starvation next-tick, wood carry cap, `ResourcesDeposited` event ordering (#188, #190, #234, #298, #371)
- Phase 5 R1 fixes — `ResourcesDeposited` event order + tick + four medium fixes (#234)
- Phase 5 ABI `uint64` revert + per-tick yield migration + `ERR_NOT_AT_HOMEBASE` (#298)
- v4.6 Phase 5 economy alignment addendum (#356)

### Phase 6 — Markets + pools (#228, #240, #257, #260, #263, #262, #284, #324, #298, #270, #294, #295, #380, #357)

> [!NOTE]
> **Liquid Economy Online:**
> 1. **Resource-bound ERC20 tokens + treasury seeder** — wood/iron/wheat/fish each get a token (#228)
> 2. **Seeded constant-product pools** — wood/gold, iron/gold, wheat/gold, fish/gold (#240)
> 3. **Immediate + scheduled market actions** — clansmen can buy/sell now or queue for next heartbeat
> 4. **Carry-based market trades** — workers *physically haul* the resource to/from the market (#284)
> 5. **`StatusCode` enum stability** — locked by Solidity test, off-chain consumers can rely on ordinals (#324)
> 6. **`MarketBuy` error path + `uintValue` robustness** (#295)
> 7. **Market failure observability** — distinct status codes per failure mode for indexers (#283, #294)
>
> Phase 6 is when Clan World becomes a *trading game*. Resources can be *converted* now, not just gathered — and the carry-based mechanic means a clan can be raided mid-trade, which is the seam Phase 9 (bandits) exploits.

- Resource boundary tokens + treasury seeder (#228)
- Seed pools, immediate and scheduled market actions, carry-based market trades, market failure semantics, market events surface (#240, #257, #260, #263, #262, #284, #283)
- `StatusCode` enum stability (#324)
- Phase 6 cloud-review fix-round (#270)
- Phase 6 R3 wheelbarrow vault-carry + sell validation (#294)
- Phase 6 R4 `ActionType` enum stability + `MarketBuy` error + `uintValue` robustness (#295)
- Phase 6B market spec cleanup — seed ratios, `executeAtTick`, slippage alignment (#380, #357)
- Phase 5/6 ABI `uint64` revert + per-tick migration (#298)

### Phase 7 — OTC transfers + ownership (#243, #246, #248, #252, #256, #389, #397, #292)

> [!NOTE]
> **Inter-Clan Diplomacy:**
> 1. **`transferGold`, `transferVaultResource`, `transferBlueprint`, `transferBundle`** — five direct transfer functions for cross-clan resource flows
> 2. **`transferClanOwnership`** — explicit owner handoff with settle + dead-clan guard (#397)
> 3. **OTC strip-out** — replaced the legacy OTC order type with direct transfers (#389)
> 4. **Phase 7 R3 stale OTC + `expiryTick uint64` + cap reap + access cleanup** (#292)
> 5. **OTC dead-clan restriction** (#256)
> 6. **Codegen allowlist updated** for the 5 new transfer functions (#397)
>
> Phase 7 turns Clan World into a *negotiation game*. Two clans can now form alliances, fund each other's upgrades, or pay tribute — and the contract enforces the *atomic guarantees* (settle-then-debit, dead-clan checks) so the negotiation can't be exploited.

- Gold, vault, blueprint, bundle transfer functions (#243, #246, #248, #252)
- OTC dead-clan restriction (#256)
- Phase 7 OTC strip-out — direct transfers replace OTC orders (#389)
- `transferClanOwnership` (#397)
- Phase 7 R3 stale OTC + `expiryTick uint64` + cap reap + access cleanup (#292)

### Phase 8 — Buildings + upgrades (#236, #238, #242, #251, #360, #361, #364, #291, #296, #391, #355)

> [!NOTE]
> **Bases Grow:**
> 1. **Wall, base, monument upgrades** — three building tracks each with multiple levels (#236, #238, #242)
> 2. **Score + rank getters** — `getRankings`, `_getClanScore`, `quoteLootValueSettled` derive from monument level + vault (#251)
> 3. **Upgrade reservation system** — wood/iron/wheat/blueprints are *held* in `_reserved*ByClan` from queue-time to settle-time (#236, #238, #242)
> 4. **`MAX_CLAN_SCAN_FOR_RANKING`** derived from `MAX_CLANS` (#360)
> 5. **8 HIGH findings** from super-swarm review fixed in one round (#291)
> 6. **Sim/real `fromLevel` parity + ABI pretty-print** (#296)
> 7. **Phase 8B v4.6 buildings alignment addendum** — spec-vs-impl reconciliation (#355)
>
> Phase 8 introduces *time-locked capital*. A clan that queues a wall upgrade has committed wood for the next N ticks — that wood is *no longer spendable* even though it shows in the vault total. This is the invariant that the Tier A reservation-bypass fixes had to retroactively defend.

- Wall, base, monument upgrades; score + rank getters; upgrade reservation coverage (#236, #238, #242, #251, #364)
- Dead internal function cleanup (#361)
- `MAX_CLAN_SCAN_FOR_RANKING` derivation (#360)
- Phase 8 R4 — eight HIGHs from super-swarm review (#291)
- Phase 8 R5 sim/real `fromLevel` parity + ABI pretty-print (#296)
- Phase 8 dev-merge test regressions — winter init + assertion alignment (#391)
- Phase 8B v4.6 buildings alignment addendum (#355)

### Phase 9 — Bandits (#189, #191, #244, #247, #253, #255, #258, #374, #266, #265, #341)

> [!NOTE]
> **Existential Threat Delivered:**
> 1. **Bandit troop state machine** — `Spawned → Camped → Attacking → Resting → Escaped` lifecycle (#189, #244)
> 2. **Spawn chance logic** with global cap and per-region eligibility (#191)
> 3. **Eager-settle scope** — base + defenders in spawn-candidate regions get refreshed pre-spawn (#247)
> 4. **Deterministic attack resolution** — settled defense vs bandit attack power, with two outcomes per spec §6.15 (#253)
> 5. **Defender reward split + blueprint reward on successful defense** (#255, #258)
> 6. **Vault loot theft + rampage path + WAITING-at-home defense** (#374)
> 7. **Cleanup on bandit target death** — defender release + state cleanup (#258)
> 8. **5 HIGH findings** from super-swarm review fixed in one round (#266)
>
> Phase 9 turns boring resource collection into a *strategic shared experience of existential threat*. A bandit can spawn in any region, target the highest-loot clan there, and either steal vault resources or deal damage on attack. Plus the **Phase 9 redesign addendum (#341)** locked v4.6 mechanics. **This is the suspense mechanism** that forces Elders to communicate and cooperate — without bandits, Clan World is a flat optimization game; with them, it's a story.

- Bandit troop state machine, spawn chance logic, eager-settle scope, deterministic attack resolution, defender reward split, blueprint reward on successful defense (#189, #191, #244, #247, #253, #255, #258)
- Vault loot theft + rampage path + WAITING-at-home defense (#374)
- Cleanup on bandit target death (#258)
- Phase 9 super-swarm R2 — five HIGH findings (#266)
- Phase 9 cloud-review fix-round (#265)
- v4.6 Phase 9 bandit redesign addendum (#341)

### Phase 10 — Winter + cold + clan death (#235, #237, #241, #245, #249, #289, #293, #383, #363, #287, #345)

> [!NOTE]
> **Seasons Have Consequences:**
> 1. **Winter schedule** — explicit ranges within the season calendar (#235)
> 2. **Winter upkeep** — wheat consumption *doubles*, fish consumption doubles, wood burn for warmth (#237)
> 3. **Cold damage** — clansmen can take cold damage from insufficient wood, accumulates per-tick (#241)
> 4. **Crop winter transitions** — wheat plots `Harvestable → WinterLocked → Regrowing` (#245)
> 5. **Clan death** — starvation or all-clansmen-cold-death marks `clanState = DEAD`, vault burned, gold preserved (#249)
> 6. **Starvation + cold-reset semantics** — first-tick flag, second-tick kill; reset on winter exit (#289)
> 7. **3 super-swarm HIGHs + cleanups** (#293)
> 8. **Sim/winter parity** — `_simulateApplyUpkeep` mirrors real winter logic (#393)
>
> Phase 10 is the *clock that punishes complacency*. A clan that hoards gold but neglects wheat will starve in winter; a clan with no wood will freeze. Phase 10 is what makes the game's resource priorities *time-dependent* instead of static.

- Winter schedule, winter upkeep, cold damage, crop winter transitions, clan death, starvation + cold-reset semantics (#235, #237, #241, #245, #249, #289, #293, #383, #363)
- Phase 10 super-swarm R2 fixes (#287)
- Phase 10 R3 cold-reset regression + cloud findings (#289)
- Phase 10 R4 three super-swarm HIGHs + cleanups (#293)
- Phase 10 spec-compliance UAT review (#345)
- Phase 10 dev-merge follow-ups — dead constant + sim/winter parity (#393)

---

## Pre-Release Hardening (2026-05-01)

After all 10 phases landed in `dev-merge`, an 8–11 reviewer super-swarm (codex 5.3 + 5.4 + 5.5, Claude Opus 4.6 + 4.7, Sonnet 4.6, Gemini 3.1 Pro, plus per-PR cloud reviewers) audited the integrated state. Three tiers of fixes followed.

### Tier A — Reservation-bypass criticals (#394, #395, #397)

> [!NOTE]
> **Vault-Drain Class Closed:**
> 1. **`WithdrawResources` reservation-aware** — adds `_hasSpendableForWithdraw` helper, blocks withdraws of wood/iron/wheat/blueprints already reserved for upgrades (#394)
> 2. **Phase 7 OTC transfers reservation-aware** — `transferVaultResource`, `transferBlueprint`, `transferBundle` all routed through `_deductFromVault` instead of raw subtraction (#395)
> 3. **`transferClanOwnership` dead-clan guard** — was allowed on dead clans, now settles-then-dead-checks (#397)
> 4. **5 + 49 + new exploit tests** added to lock these regressions out
>
> An entire *class* of vault-drain exploits would have shipped silently with v1.0.0 if the super-swarm hadn't caught the pattern. Tier A is the win that justified the audit-after-merge cadence as a permanent practice.

- WithdrawResources reservation-aware: blocks reserved-resource withdraws (#394)
- Phase 7 OTC transfers reservation-aware: vault transfers route through `_deductFromVault` (#395)
- `transferClanOwnership` settle-then-dead-check + codegen allowlist + `ERR_MUST_SETTLE_FIRST` consistency (#397)

### Tier B — 6-item surgical bundle (#407)

> [!NOTE]
> **Surgical Cleanup:**
> 1. **`HEARTBEAT_ABI` duplicate fields deleted** — silent runtime decode bug caught by *8 of 8 reviewers*
> 2. **`marketMode` field added** to TS `SubmitOrderResult` to match on-chain 5-field struct
> 3. **Fake parity test deleted** — `check-chain-abi-parity.test.ts` was self-tautology (compared two fixtures to each other)
> 4. **Duplicate `cli.test.ts` deleted** — canonical copy lives elsewhere
> 5. **Stub `getDerivedClanState` clanId fix** — multi-clan callers were getting clan 0's data
> 6. **`WithdrawResources` simulation branch wired** — `_simulateResolveAction` now mirrors `_resolveAction`
>
> All six were trivial individually, but each was a surface where *the same kind of bug* could have hidden in production. Tier B is the *cheap good move*.

- 6 surgical fixes from PR #396 superswarm (#407)

### Audit — Hand-coded types (#408, #409)

> [!NOTE]
> **Drift Hazards Eliminated:**
> 1. **`HEARTBEAT_ABI` fully replaced with generated import** — `heartbeat()` added to codegen allowlist, runner now imports `CLAN_WORLD_ABI` (audit MUST 1, #408)
> 2. **`gen-enums.mjs` shipped** — regex-parses `IClanWorld.sol` for all 8 contract enums, emits TS `as const` lookup tables (audit MUST 2, #409)
> 3. **Orchestrator `action: 1` literal becomes `ActionType.ChopWood`** — out-of-band knowledge becomes compile-checked (#409)
> 4. **Parity test refactored** — encoder side now reads canonical `IClanWorld.json` via `getAbiItem` (audit MUST 3, #409)
> 5. **`gen-constants.mjs` shipped** — `ClanWorldConstants.sol` → TS `bigint` exports (#409)
> 6. **`anyApi` casts replaced** with generated Convex API types in `IConvexClient.ts` + `useAgentLogs.ts` (#409)
> 7. **Heartbeat-interval values aligned** across `start-heartbeat-loop.sh` + `getSnapshot.ts` empty-state (#409)
> 8. **`check-chain-abi-parity.mjs` extended + wired into CI** — drift fails the build (#409)
>
> The audit asked *"are there other places like the HEARTBEAT_ABI bug?"* — answer was yes, three more, plus six soft-drift surfaces. **Hand-rolled type mirrors are no longer a viable shortcut** in this codebase. The new `handcoded-types-audit` skill captures the methodology so future pre-release moments re-run the same scan.

- Audit MUST 1 — Replace runner `HEARTBEAT_ABI` with generated `CLAN_WORLD_ABI` import (#408)
- Audit phase 2 — `gen-enums.mjs` + `gen-constants.mjs` + parity test refactor + anyApi cleanup + heartbeat-interval alignment (#409)
- Audit `handcoded-types-audit` skill captured for future pre-releases

---

## Cross-Phase Infrastructure

### Agents and orchestrator

> [!NOTE]
> **Autonomous AI Players:**
> 1. **Elder CLI** — full `status`, `orders`, `submit` subcommand coverage (#71)
> 2. **`RealChainClient` integration** — Elder clan submits real on-chain transactions every heartbeat tick (#32)
> 3. **Elder harness in-repo** with `make install` — sandboxed Claude Code agent per Elder (#154)
> 4. **Orchestrator REGION_FOREST routing + `submitOrders` sim semantics** (#383)
> 5. **`ActionType` enum import** replaces bare numeric literal (#409)
>
> Each clan has an *Elder* — an autonomous Claude Code agent with its own wallet, its own private key, its own `submitOrders` cadence. The orchestrator coordinates them; the harness sandboxes them; the CLI lets a human poke at any of them mid-game.

- Elder CLI full subcommand coverage (#71)
- Elder clan `submitOrders` with real on-chain transactions via `RealChainClient` (#32)
- Elder harness in-repo with `make install` (#154)
- Orchestrator `REGION_FOREST` routing + `submitOrders` sim semantics (#383)
- `ActionType` enum replaces bare numeric literal `action: 1` (#409)

### Shared / adapters

- `RealChainClient` with viem — full typed on-chain interface (#27)
- `IChainClient` adapter interface + codegen pipeline (#362, #385)
- Cross-phase hygiene bundle: stub heartbeat parity, ABI parity broadening (#362, #385)

### Web app — Pixi.js canvas

> [!NOTE]
> **The World You Watch:**
> 1. **8-region canvas world map** with clan flags + speech bubbles (#19)
> 2. **`agentLogs` speech bubbles on canvas** — Elder reasoning surfaces visually (#33)
> 3. **Browser clan-join surface and backend readiness checks** (#34)
> 4. **Isometric base sprites at 5 upgrade levels** + region zones + floating level labels + fullscreen mode (#52, #161)
> 5. **Walking clansman sprites** replace worker dots (#59)
> 6. **Pinch-to-zoom via `pixi-viewport`** — multi-touch + Pixi v8 EventSystem fix (#50, #51, #53)
> 7. **Bubble polish** — clan-colored Elder header, backdrop, tail, fade (#43, #55, #99)
> 8. **Worker travel dot animation** along routes (#45)
>
> Pixi gives Clan World its *spectator surface*. You don't need to read JSON to know what's happening — a clansman is walking from the forest to base, the wall just leveled up, an Elder said *"I'm worried about winter."*

- Pixi.js canvas shell — 8 regions, clan flags, speech bubbles (#19)
- Convex `agentLogs` speech bubbles (#33)
- Browser clan-join surface and backend readiness checks (#34)
- Visual rework — isometric base sprites, region zones, floating level labels, fullscreen mode (#52, #161)
- Clansman walking sprites (#59)
- Speech bubble polish (#43, #55, #99)
- Pinch-to-zoom (#50, #51, #53)
- Bubble tails, world notice panel, live tick counter (#54)
- Demo bypass env for offline recording (#37)
- Graceful render fallback (#35)
- Worker travel dot animation (#45)
- Monument visual + wall opacity by building level (#44)

### Server / backend

- Convex `MOCK_MODE` backend — `getSnapshot` + `agentLogs` (#20)
- Convex heartbeat-webhook HTTP action + safety-net cron (#25)
- Foundry `Heartbeat` script + `start-heartbeat-loop.sh` (#29)

### Tooling and codegen

- `gen-chainclient-abi.mjs` — allowlist-driven ABI extraction to TypeScript (#385)
- `gen-enums.mjs` — regex-parses `IClanWorld.sol` for all 8 contract enums, outputs `as const` lookup tables (#409)
- `gen-constants.mjs` — `ClanWorldConstants.sol` → TypeScript `bigint` exports (#409)
- `check-chain-abi-parity.mjs` extended + wired into CI (#409)
- Playwright e2e harness for `apps/web` (#88)
- Elder vitest CLI suite + regression coverage (#105)
- Vite dev servers default to `port-for` slots (#139)
- Post-bundle-A dev-tooling follow-ups (#140)

### Landing page and docs

- `clan-world.com` landing page — full copy, palette, tale frames, sponsor logos (#30, #48)
- Hackathon judge quick-start banner + submission video embed (#61, #62)
- README polish — hero copy, tech stack, sponsor framing (#31)
- Landing factual corrections — clan count + winter cadence (#36)

---

## Cross-cutting

### Refactor

> [!NOTE]
> **Cleaner Surfaces:**
> 1. **Phase 7 OTC strip-out** — OTC order type replaced with 5 *direct transfer functions* (#389)
> 2. **Base Sepolia chain pivot** — makes Base Sepolia the active chain config (#132)
> 3. **`*Upgraded` events dropped**, `*LevelChanged` kept — cleaner event surface (#365)
> 4. **`MAX_CLAN_SCAN_FOR_RANKING` derived** from `MAX_CLANS` instead of hardcoded (#360)
> 5. **Carry-based market trades** — workers haul resources, no teleport (#284)
> 6. **Orchestrator enum literals** — `action: 1` becomes `ActionType.ChopWood` (#409)
> 7. **4 dead internal contract functions deleted** (#361)
>
> The OTC strip-out and chain pivot were the two big *spec-vs-impl* alignments — once they landed, every downstream phase had a *consistent* substrate to build on.

- Phase 7 OTC strip-out (#389)
- Base Sepolia chain pivot (#132)
- Drop `*Upgraded` events, keep `*LevelChanged` (#365)
- `MAX_CLAN_SCAN_FOR_RANKING` derivation (#360)
- Carry-based market trades (#284)
- Orchestrator action literals replaced with `ActionType` enum (#409)
- 4 dead internal contract functions deleted (#361)

### Tests

> [!NOTE]
> **Validation Footprint at Ship:**
> 1. **310/310 Forge tests green** at release HEAD
> 2. **WithdrawResources exploit test** + wood/iron/fish/surplus-ok variants (#394)
> 3. **Phase 7 transfer reservation tests** (#395)
> 4. **`transferClanOwnership` dead-clan revert test** (#397)
> 5. **Heartbeat + `getRankings` gas profiling** (#359)
> 6. **ABI parity test wired into CI** — reads canonical `IClanWorld.json` (#409)
> 7. **Playwright e2e harness** for `apps/web` (#88)
> 8. **Phase 3 Foundry spec** — *39 cases* (#115)
>
> Every reservation-bypass exploit and every cross-tier integration shape has a *named test* — regressions can't sneak back in. CI fails the build the moment the contract ABI drifts from the TypeScript adapter.

- 310/310 Forge tests at release
- WithdrawResources exploit test (#394)
- Phase 7 transfer reservation tests (#395)
- `transferClanOwnership` dead-clan revert test (#397)
- Heartbeat + `getRankings` gas profiling (#359)
- Upgrade reservation coverage strengthened (#364)
- Phase 3 Foundry test specification (#115)
- Elder vitest CLI suite + regression (#105)
- Playwright e2e harness (#88)
- ABI parity test refactored to canonical-derived shapes, wired into CI (#409)

### Docs

> [!NOTE]
> **Spec + Planning Artifacts Shipped:**
> 1. **`CANONICAL_SPEC.md`** with precedence + conflict resolutions (#70)
> 2. **v4.1–v4.5 engine spec copies** (#70)
> 3. **v4.6 Phase 5 economy alignment addendum** (#356)
> 4. **Phase 8B v4.6 buildings alignment addendum** (#355)
> 5. **v4.6 Phase 9 bandit redesign addendum** (#341)
> 6. **Phase 10 spec-compliance UAT review** (#345)
> 7. **Phase 3 Foundry test specification** (#115)
> 8. **Hackathon coding rules** — minimal tests + env var simplicity (#18)
>
> The spec evolved through 5 named versions during the build — `CANONICAL_SPEC` is the *current source of truth* for every conflict, and the alignment addenda capture *exactly* what changed between versions and *why*.

- `CANONICAL_SPEC`, `DEMO_DRIFT`, v4.1–v4.5 engine spec copies (#70)
- Phase 3 Foundry test specification (#115)
- v4.6 Phase 5 economy alignment addendum (#356)
- Phase 8B v4.6 buildings alignment addendum (#355)
- v4.6 Phase 9 bandit redesign addendum (#341)
- Phase 10 spec-compliance UAT review (#345)
- Hackathon coding rules — minimal tests + env var simplicity (#18)

---

[1.0.0]: https://github.com/OmniPass-world/clan-world/compare/world-build-submission-1...v1.0.0
