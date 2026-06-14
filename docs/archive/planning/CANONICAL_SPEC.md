# ClanWorld — Canonical Spec Reference

This document defines the authoritative read-order for the ClanWorld v4 specification corpus.
When two docs conflict, the higher-ranked doc wins.

---

## Precedence table (rank 1 = highest authority)

| Rank | Document | Location |
|------|----------|----------|
| 1 | `IClanWorld.sol` | `packages/contracts/src/IClanWorld.sol` |
| 2 | `clanworld_v4_2_state_schema_interface_spec.md` | `docs/planning/` |
| 3 | `clanworld_v4_3_schema_patch.md` | `docs/planning/` (additive patch to rank 2 — see note) |
| 4 | `clanworld_v4_4_ui_indexer_getters.md` | `docs/planning/` |
| 5 | `clanworld_v4_5_alignment_addendum.md` | `docs/planning/` (§3/§4/§11 superseded by back-on-plan — see note) |
| 6 | `clanworld_v1_implementation_profile.md` | `docs/planning/` |
| 7 | `clanworld_v4_spec.md` | `docs/planning/` |
| 8 | `clanworld_v4_1_addendum.md` | `docs/planning/` (§A7 patched — see below) |
| 9 | Sponsor integration specs (retired) | _Removed — external-sponsor integrations dropped; current stack is Base Sepolia diamond + self-hosted Convex + dockerized elders._ |
| 10 | Landing/lore copy | `apps/landing/` (non-authoritative) |

---

## Known conflicts and resolutions

### Market-buy: exact-input vs exact-output

**The conflict:** `clanworld_v4_1_addendum.md §A7` originally stated "All v1 market actions are Exact Input actions only" and described `market_buy` as spending an exact amount of gold. This contradicts `IClanWorld.sol`, `clanworld_v4_2_state_schema_interface_spec.md §8.3–8.4`, and `clanworld_v4_3_schema_patch.md`.

**The resolution (rank 2 and rank 1 win):**
- `market_sell` — exact input: `marketAmount` = exact resource amount to sell; gold out is AMM-determined.
- `market_buy` — exact output: `marketAmount` = exact resource amount to receive; `maxGoldIn` = maximum gold willing to spend (slippage guard). Buy fails if required gold exceeds `maxGoldIn` at execution time.

§A7 in `clanworld_v4_1_addendum.md` has been patched (2026-04-26) to reflect this. See §A7 directly for the corrected text.

### v4.2 vs v4.3 rank ordering

v4.3 is a purely additive patch to v4.2 — it adds new rules (same-region NOOP bypass, mission cardinality, RNG domain separation) but does not override v4.2's existing schema fields or rules. For topics v4.3 explicitly addresses, apply v4.3. For topics only in v4.2, apply v4.2. If a true conflict exists between the two, v4.2 (rank 2) wins; use IClanWorld.sol (rank 1) as the final tiebreaker.

### v4.5 alignment addendum: scope and supersession

`clanworld_v4_5_alignment_addendum.md` self-declares as superseding conflicting language in the prior 7 spec docs (its own reading order includes IClanWorld.sol at position 6). Despite this claim, `IClanWorld.sol` retains rank 1 here because it is contract interface *code* — the deployed ABI is ground truth, not a document that a later doc can override. v4.5 is authoritative for architectural and coordination decisions that exist only in docs, not for on-chain interface semantics.

v4.5 remains authoritative for: tick cadence per-submission (§2), agent vocabulary (Elder / orchestrator / toolbelt / situation block — §11.2), and §11.3 sections of `clanworld_agent_runner_spec.md` that remain valid.

The following sections of v4.5 are **superseded by the back-on-plan doc** (`~/claudes-world/plans/inprogress/20260426-clanworld-back-on-plan-v1.md` §1A):
- §3 (heartbeat caller model) — superseded by back-on-plan §1A runner architecture
- §4 (indexer trigger model) — superseded by back-on-plan §1A Convex indexer design
- §11 agent architecture (process model) — superseded by back-on-plan §1A runner: TS daemon, tmux per Elder

### Landing/lore copy

`apps/landing/src/pages/LorePage.tsx` contains gameplay constants (gather durations, cooldown descriptions) written for narrative clarity. These are not authoritative. Where they diverge from rank 1–8 docs, rank 1–8 wins.

---

## How to use this document

1. When implementing a mechanic, find the highest-ranked doc that addresses it.
2. If a lower-ranked doc seems to say something different, check whether the higher-ranked doc explicitly overrides it. If so, follow the higher-ranked doc and note the conflict here.
3. Conflicts not listed above should be escalated to the spec owner before implementation proceeds.
4. `IClanWorld.sol` (rank 1) is the tiebreaker for anything touching the contract interface. If the interface is unambiguous, follow it.
5. Architectural decisions (heartbeat caller, indexer design, runner process model) defer to the back-on-plan doc over v4.5 for the sections noted above.
