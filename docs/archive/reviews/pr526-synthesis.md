# Phase Super-Swarm Synthesis — PR #526 (head ba8d426)

**Models run:** Codex 5.3 ✓ | Codex 5.4 ✓ | Codex 5.5 ✓ | Opus 4.6 ✓ | Opus 4.7 ✓ | Gemini 3.1 Pro ✓ (full 6-model lineup)
**PR:** feat(convex): self-hosted backend + dashboard stand-up (#347)
**Target:** dev-containerize-services
**CI:** 5/5 SUCCESS

## Summary

**Verdict: NEEDS_FIXES (substantial)** — 0 unanimous HIGH but 5 cross-model HIGH clusters with 3-5 reviewers each flagging the same bugs. Plus ~8 unique MEDs. The bootstrap → deploy → import operator path has multiple footguns: silent empty admin-key writes, missing loopback proxy startup, file-storage data loss during destructive imports, and CLI version skew. Architecture (chicken-and-egg admin key, socat loopback proxies, instance-secret in volume) is sound. Security posture is improved over prior.

**Recommended action:** substantial fix-round on the 5 cross-model HIGHs + 4-5 SHOULD FIX MEDs. ~150-300 LOC across Makefile, bash scripts, docker-compose.yml, .env.template, runbook. Codex 5-stage dispatch.

## MUST FIX (cross-model overlap)

| File:line | Models flagging | Finding | Fix |
|---|---|---|---|
| `Makefile:31-37` | codex 5.4 H1, codex 5.5 H1, opus 4.7 H1, gemini M1 (**4/6**) | Bootstrap chained with `;` not `&&` — failing `generate_admin_key.sh` produces 0-byte key file, `install` succeeds, recipe exits green with bad key. Deploy then fails with opaque auth error. | Add `set -euo pipefail`, use `&&` between commands, assert `[[ -s "$$tmp" ]]` before `install`. |
| `Makefile:23` + `bin/deploy-convex.sh:20` + runbook | codex 5.4 H2, codex 5.5 H2, opus 4.7 H2 (**3/6**) | `bootstrap-convex-admin-key PROFILE=dev` only starts `convex-backend`; deploy targets `http://127.0.0.1:3210` which only exists if `convex-backend-dev-port` socat proxy is up. Fresh-host bootstrap → deploy fails. | Bootstrap target also `up -d convex-backend-dev-port` for PROFILE=dev, OR runbook adds `docker compose --profile dev up -d` as prerequisite step. |
| `bin/import-convex-schema.sh:75` | codex 5.4 H3, codex 5.5 H3, opus 4.7 H3, opus 4.6 M1 (**4/6**) | Hosted export omits `--include-file-storage` while `backup-convex.sh:44` includes it. Combined with `--replace-all` later, this silently wipes file storage during migration. | Add `--include-file-storage` on line 75. Require operator flag when `HOSTED_CONVEX_EXPORT_ZIP` supplied (zip may not contain file storage). |
| `bin/deploy-convex.sh:46-47` + `apps/server/package.json` + `packages/sdk/package.json` | codex 5.3 H1, codex 5.5 M1, opus 4.7 M1+M2, gemini H1, opus 4.6 M3 (**5/6**) | SDK codegen in deploy script runs `pnpm --filter @clan-world/sdk codegen` which resolves to workspace `convex@1.17.4` binary. Asymmetric with `convex:codegen` script (npx 1.39.1) added in this PR for the same purpose. Two different CLIs generating types against the same schema. | Switch deploy script line 46 to `pnpm --filter @clan-world/sdk convex:codegen`. OR align workspace `convex` dep with `CONVEX_CLI_PINNED_VERSION` (preferred for true consistency). |
| `docker-compose.yml:128` convex-dashboard healthcheck | opus 4.6 H1, opus 4.7 M (escalated), gemini M2 (**3/6**) | Dashboard healthcheck changed from `wget --spider` to `curl -f`. The standard `get-convex/convex-dashboard` Next.js Alpine image historically ships `wget` but may lack `curl`. If `curl` is missing, dashboard never reports healthy → `convex-dashboard-dev-port` socat never starts → port 6791 not exposed. **Verify before applying any fix:** `docker run --rm ghcr.io/get-convex/convex-dashboard:<tag> which curl`. | If absent: revert to `wget --spider`. If present: keep, document. |

## SHOULD FIX (single-model MED or MED in 2 models)

| File:line | Models | Finding | Fix |
|---|---|---|---|
| `bin/backup-convex.sh:42-44` | opus 4.7, codex 5.5 (2/6) | Backups dir + zip created with default umask (0755/0644). Exports contain full Convex data + potentially `INDEXER_SECRET`/`WEBHOOK_SHARED_SECRET`/user data. | `install -d -m 0700 agents/backups` + `chmod 0600 "$backup_path"` after export. Mirror .gitignore/.dockerignore exclusions. |
| `docker-compose.yml:92, 97, 122` + `.env.template:212-228` | codex 5.3 M3, codex 5.5 M3, opus 4.7 M3, gemini LOW (4/6) | Prod defaults silently fall back to dev/internal URLs (`convex-backend:3210`, `latest` image tags). Browser clients can't resolve Docker-internal hostnames. | Make `CONVEX_CLOUD_ORIGIN`, `CONVEX_SITE_ORIGIN`, `CONVEX_DASHBOARD_DEPLOYMENT_URL` fail-loud `:?required` when `CHAIN_NETWORK=prod`. Pin image tags by SHA for prod. |
| `bin/import-convex-schema.sh:78` | codex 5.3 M1, codex 5.5 M2 (2/6) | `FRESH_SELF_HOSTED=1` bypasses confirmation without verifying target is actually fresh. Stale shell export or typo can still wipe populated backend. | When `FRESH_SELF_HOSTED=1`, first query target and assert no app data, OR require `CONFIRM_TARGET_URL=$CONVEX_SELF_HOSTED_URL` second gate. |
| `Makefile` (missing target) | codex 5.4 LOW, codex 5.5 LOW, opus 4.7 LOW (3/6) | `bin/check-stack-health.sh` exists but no `make check-stack-health` target. Inconsistent with other ops. | Add `check-stack-health` Make target. |
| `Makefile:17-37` | codex 5.3 H2 (single-model HIGH) | `FORCE=1` overwrites admin key without verifying backend instance identity. Wrong-stack mistake can replace the key. | Print + compare backend instance fingerprint before overwrite, OR require `CONFIRM_ROTATE_CONVEX_ADMIN_KEY=1` second gate. |
| `bin/{deploy,backup,import-convex-schema}.sh` CLI version check | opus 4.7 M, codex 5.5 M (2/6) | CLI version check is tautological — `npx -y convex@X --version` always returns X. Provides no protection. | Drop the check, OR validate the actual binary resolved by `npx --no-install convex --version`. |
| `docs/runbooks/self-hosted-convex.md:48-54` | opus 4.7 M, codex 5.5 LOW, codex 5.3 LOW (3/6) | Manual `convex env set` snippet uses bare `convex` instead of pinned CLI. Operator may hit hosted Convex by accident. | Prefix with `npx -y convex@${CONVEX_CLI_PINNED_VERSION:-1.39.1}` OR add `make convex-env-set` wrapper. |

## DEFER (LOW findings, file follow-up issues where useful)

- `bin/check-stack-health.sh:52-54` — always checks dashboard regardless of profile (codex 5.3 M2)
- `bin/import-convex-schema.sh:64-67` — SDK_SCHEMA_SHA256 check opt-in (opus 4.7 LOW)
- `Makefile:45 reset-anvil` — `|| true` masks failures (opus 4.7 LOW)
- `Makefile:45 reset-anvil` — hardcodes `--profile dev` not `$(PROFILE)` (opus 4.6 M4)
- `docker-compose.yml:139-140, 151-152` — socat no per-host connection cap (opus 4.7 LOW)
- `docker-compose.yml:93, 117` — `stop_grace_period: 10s` tight for SQLite (opus 4.7 LOW)
- Runbook missing `docker compose pull` step (opus 4.7 LOW)
- Shell duplication across bin/ scripts (opus 4.6 LOW)
- `Makefile` service name `convex-backend` hardcoded twice (opus 4.7 LOW)
- `agents/backups/` retention/pruning not documented (codex 5.3 LOW, codex 5.5)
- `.sha256` fingerprint not in runbook (codex 5.5 LOW)
- `bin/check-stack-health.sh:53` — clarify "reachable, any status" labeling (codex 5.5 LOW)

## Cross-model overlap stats

- Findings flagged by 4+ models: 3 (admin-key bootstrap silent failure, file-storage import, CLI version skew)
- Findings flagged by 3 models: 2 (bootstrap dev-port proxy, dashboard healthcheck wget→curl)
- Findings flagged by 2 models: ~5 (backup permissions, FRESH_SELF_HOSTED bypass, prod fail-loud, check-stack target, CLI version tautology)
- Single-model findings: ~10

## Per-model verdicts

- **Codex 5.3:** NEEDS_FIXES (2 HIGH, 3 MED, 2 LOW) — focus on deploy CLI consistency + admin-key safety
- **Codex 5.4:** NEEDS_FIXES (3 HIGH, 3 MED, 2 LOW) — caught the Makefile semicolon bug FIRST
- **Codex 5.5:** NEEDS_FIXES (3 HIGH, 4 MED, 4 LOW) — best-organized; identifies the "operator path as code" cross-cutting theme
- **Opus 4.6:** NEEDS_FIXES (1 HIGH, 4 MED, 4 LOW) — escalated dashboard healthcheck wget→curl to HIGH
- **Opus 4.7:** NEEDS_FIXES (3 HIGH, ~10 MED, ~10 LOW) — most exhaustive; same 3 HIGHs as codex 5.4/5.5 + many supporting findings
- **Gemini 3.1 Pro:** NEEDS_FIXES (1 HIGH, 2 MED, +) — narrower but caught the SDK codegen drift as HIGH

## Key observations

1. **Cross-model convergence is strong on the operator-path footgun cluster.** The Makefile semicolon bug + missing dev-port proxy startup + import file-storage drop all flagged by 3-4 reviewers. High confidence these are real.
2. **"Operator path as code" is the unifying theme** (codex 5.5 verbatim). The PR adds useful scripts, but they need the same fail-fast discipline as the compose service definitions.
3. **Security posture is genuinely improved** (admin key derived not mounted, dev exposure is loopback-only socat, secrets in volume not env). All 6 reviewers commend this direction.
4. **The wget→curl healthcheck change is the most important to verify empirically** before fix-round — could be a non-issue (if image has curl) or a HIGH (if it doesn't).
5. **CI version skew has 5/6 reviewers flagging the same root cause** even with different framings (HIGH from gemini + codex 5.3, MED elsewhere). Fix is mechanical.

This synthesis based on full 6-model lineup. Round 1 — pre-fix-round.
