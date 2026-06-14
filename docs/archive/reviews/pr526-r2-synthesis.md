# Phase Super-Swarm R2 Synthesis — PR #526 (head 9941c83)

**Models run:** Codex 5.3 ✓ | Codex 5.4 ✓ | Codex 5.5 ✓ | Opus 4.6 ✓ | Opus 4.7 ✓ | Gemini 3.1 Pro ✓ (full 6-model lineup, R2 verification of R1 fix-round)
**PR:** feat(convex): self-hosted backend + dashboard stand-up (#347)
**Target:** dev-containerize-services
**CI:** 5/5 SUCCESS

## Summary

**Verdict: NEEDS_FIXES (minor)** — 5/6 reviewers CLEAN. Gemini alone flagged 1 MEDIUM finding. Opus 4.7 separately flagged the same issue as LOW. Cross-model overlap (2 models, different severities) = real finding worth fixing. One-shot fix-round dispatched.

## R1 fix verification (all 6 reviewers)

| R1 MUST Fix | Verification |
|---|---|
| Makefile `set -euo pipefail` + && chain + empty-key assertion | ✅ unanimous LANDED |
| Bootstrap target starts `convex-backend-dev-port` for PROFILE=dev | ✅ unanimous LANDED |
| `import-convex-schema.sh --include-file-storage` + external-zip gate | ✅ unanimous LANDED |
| `bin/deploy-convex.sh` switches to `pnpm convex:codegen` + prod-origin preflight | ✅ unanimous LANDED |
| Dashboard curl healthcheck (empirically verified) | ✅ unanimous LANDED |

| R1 SHOULD Fix | Verification |
|---|---|
| Backup permissions 0700/0600 (backup-convex.sh + import-convex-schema.sh) | ⚠ PARTIAL — gemini caught import-convex-schema.sh export zip missing `chmod 0600` after the `convex_cli export` call |
| Prod-env fail-loud defaults | ✅ unanimous LANDED |
| `FRESH_SELF_HOSTED=1` requires `CONFIRM_TARGET_URL` | ✅ unanimous LANDED |
| `make check-stack-health` target | ✅ unanimous LANDED |

## R2 NEW findings

### MED-1 (gemini MED + opus 4.7 LOW — cross-model overlap)

**File:** `bin/import-convex-schema.sh:80`

`convex_cli export --path "$export_zip" --include-file-storage` exports the hosted Convex data to a zip in `agents/backups/` but does NOT `chmod 0600 "$export_zip"` after. `backup-convex.sh:45` DOES chmod 0600 the backup. Both zips can contain full Convex data + secrets — asymmetric, unprotected hosted-export.

**Fix:** add `chmod 0600 "$export_zip"` after line 80. One-line patch.

### LOW (gemini)

1. **Strict Target URL Equality** — `CONFIRM_TARGET_URL` gate uses `!= "$target_url"`. If operator includes trailing slash (`http://127.0.0.1:3210/`), fails closed (safe but UX friction). Defer.
2. **Redundant Makefile Pattern** — `set -euo pipefail` + `&&` chain in bootstrap target is stylistically contradictory. Functional, just nit. Defer.

### LOW (opus 4.7)

1. Same chmod 0600 asymmetry as gemini MED-1 (re-categorized as MED).
2. Runbook env-set examples use unpinned `convex` binary (deferred from R1).

## Cross-model overlap

- Unanimous CLEAN on all 5 R1 MUST + 3 of 4 R1 SHOULD
- Cross-model (gemini + opus 4.7) on chmod 0600 asymmetry → 1 MED to fix
- 0 HIGH

## Per-model verdicts

- **Codex 5.3**: CLEAN
- **Codex 5.4**: CLEAN
- **Codex 5.5**: CLEAN
- **Opus 4.6**: CLEAN — verified all 9 fixes
- **Opus 4.7**: CLEAN — noted 2 LOWs, one matching gemini's MED
- **Gemini 3.1 Pro**: NEEDS_FIXES — 1 MED (chmod 0600 asymmetry) + 2 LOW

## Action

One-shot codex fix-round dispatched for the chmod 0600 asymmetry. Expected 1 commit, 1 LOC change. When committed + CI green, PR #526 should be CLEAN to merge alongside PR #525.

## Convergence

- R1: 5 cross-model HIGH + 8 MED → R1 fix-round addressed 5 MUST + 4 SHOULD
- R2: this round → 5/6 CLEAN + 1 MED (chmod 0600) → R2 fix-round (one-shot)
- Expected R3: unanimous CLEAN

Total expected: 2 super-swarm rounds + 2 fix-rounds. Acceptable convergence for a Bundle 1 foundation PR.
