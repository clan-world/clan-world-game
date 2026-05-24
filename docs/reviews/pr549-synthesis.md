# Swarm Review Synthesis — PR #549 (commandBus surviving #421 fixes)

**Head SHA:** `7640fed`
**Round:** 1
**Tiers run:** 1 (Claude subagent) ✓ / 2 (Codex CLI) ✓ / 3 (Gemini flash) ✓

**Overall verdict:** **EFFECTIVELY CLEAN.** All 5 R1+R2+addendum fixes ported correctly. 31/31 tests pass (T1 ran locally). 0 HIGH, 1 MED (latent), 3 LOWs (1 cross-tier overlap, 2 single-tier).

## Per-tier verdicts

- **T1 (Claude subagent):** CLEAN — 2 LOWs (L-1 unused Set drift, L-2 config.ts comment polish). Ran 31/31 tests locally — all pass. Cross-checked Convex `1.17.4` `FilterBuilder.or` signature; verified schema indexes; confirmed MVCC handles the 2-pass atomically. Most thorough verification.
- **T2 (Codex CLI):** CLEAN — 0 findings. Verified all 6 focus areas: 2-pass race (atomic mutation), idempotency safety, lease-grace direction, sweep predicate symmetry, LEASE_MS callers, fake or() helper.
- **T3 (Gemini flash):** NEEDS_FIXES — 1 MED (double-scan latent at scale), 2 LOWs (unused Set, 1ms dead-zone).

## MUST FIX

None — no HIGH findings, no cross-tier MEDIUM consensus.

## SHOULD FIX (fix-round)

| # | Severity | Tiers | File:Line | Finding |
|---|---|---|---|---|
| L-1 | LOW (cross-tier T1+T3, high confidence) | T1, T3 | `apps/server/convex/commandBus.ts:6-7` | `CONTROL_COMMAND_KINDS` Set declared but never referenced. Filter inlines hardcoded string literals (lines 92-94). Drift hazard: future contributor adding a 4th control verb to the Set will silently NOT take effect. **Fix:** Drive filter from the Set, OR delete the Set. Both tiers caught this — high confidence. |

## DEFER (file follow-up issues)

| # | Severity | Tiers | Finding |
|---|---|---|---|
| M-1 | MED | T3 | claimNext 2-pass double-scan under large user_message backlogs (>1000). Risks Convex execution limits under load. **Not a correctness bug today** — Bundle 3 traffic is 4 elders with low TPS — but latent. File follow-up issue for when scale increases. |
| L-2 | LOW | T1 | `packages/elder-runtime/src/config.ts:42-48` comment was updated 5min→6min but doesn't mention `COMPLETION_GRACE_MS = 30s`. Real margin is now 2.5min not 2min. Future contributor changing `LEASE_MS` or `nonceTimeoutMs` needs to account for grace too. **Fix:** Inline polish in fix-round. |
| Design | OBSERVATION | T1 (conf ~55) | `completeCommand` + sweeper observe 30s grace; `ackCommand` + `failCommand` do not. Diagnostic loss only (no reason row written). In practice supervisor's 4min nonceTimeout fires with 2min valid lease remaining. Document for ADR; not blocking. |

## SKIP (false positive / negligible)

- L-3 (T3) — 1ms dead-zone between completeCommand grace boundary (`<=`) and `sweepStaleDelivered` (`lt` strict). Negligible in practice. Skip.

## Cross-tier overlap stats

- Findings flagged by 2+ tiers: 1 (L-1 unused Set, T1 + T3) — high confidence
- Single-tier findings: 4 (M-1 + L-2 + L-3 + design observation)
- All-CLEAN tiers: T2 (codex) reported 0 findings

## Recommended action

Dispatch codex fix-round to apply 2 SHOULD-FIX items (L-1 + L-2). Re-verify with codex tier 2 only (no need for full 3-tier on inline polish). Merge when CI passes + R2 verifies clean.

File follow-up issues:
- M-1 → "Optimize claimNext 2-pass for high command-bus throughput"
- Design observation → ADR draft "Symmetric grace window on commandBus state-machine transitions"

## Refs

- T1 review: `~/claudes-world/tmp/swarm-review-tier1-549.md`
- T2 review: `~/claudes-world/tmp/swarm-review-tier2-549.md`
- T3 review: `~/claudes-world/tmp/swarm-review-tier3-549.md`
