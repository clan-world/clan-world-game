# Phase Super-Swarm Review — PR #526 R2 (head 9941c83)

## SUMMARY
Verdict: CLEAN. The R1 fix-round lands all 5 MUST-fix items and all 4 SHOULD-fix items in the R1→R1-fix delta, with the intended fail-loud and safety gating behavior preserved. I did not find any new HIGH or MEDIUM regressions in the changed files. One LOW note: the `CONFIRM_TARGET_URL` check is strict string equality, so harmless formatting differences (for example trailing slash) will fail closed.

## R1 FIX VERIFICATION
| R1 MUST Fix | Status | Notes |
|---|---|---|
| Makefile set -euo pipefail | LANDED | `bootstrap-convex-admin-key` now uses `set -euo pipefail` in the critical key-generation/write block plus `&&` chaining and non-empty key assertion. |
| Bootstrap dev-port proxy startup | LANDED | `bootstrap-convex-admin-key` now starts `convex-backend-dev-port` when `PROFILE=dev`. |
| import-convex-schema --include-file-storage | LANDED | Hosted export path now uses `convex export --include-file-storage`; external zip path adds `CONFIRM_EXPORT_HAS_FILE_STORAGE=1` gate. |
| deploy script pinned codegen | LANDED | `bin/deploy-convex.sh` now calls pinned `convex:codegen` scripts (`1.39.1` default) in SDK and server. |
| Dashboard curl healthcheck | LANDED | Compose dashboard healthcheck switched to `curl`, with verification comment retained. |

| R1 SHOULD Fix | Status | Notes |
|---|---|---|
| Prod-origin preflight in deploy path | LANDED | `require_prod_origins()` rejects unset/local/internal origins when `CHAIN_NETWORK=prod`. |
| docker-compose/.env fail-loud required origin wiring | LANDED | Compose now uses `${VAR:?required}` for Convex origins/deployment URL; template documents explicit prod override expectations. |
| Backup/export file permission hardening | LANDED | `agents/backups` created with `0700`; backup zip chmodded `0600`; directory ignored in git/docker contexts. |
| Fresh-target destructive import confirmation | LANDED | `FRESH_SELF_HOSTED=1` now requires exact `CONFIRM_TARGET_URL` match before destructive import. |
| Health-check make target | LANDED | `make check-stack-health` + `bin/check-stack-health.sh` added and wired. |

## HIGH severity findings (new in R2)
None.

## MEDIUM severity findings (new in R2)
None.

## LOW severity findings (new in R2)
- `bin/import-convex-schema.sh`: `CONFIRM_TARGET_URL` uses exact string equality against `target_url`. This is safe/fail-closed, but operators can be blocked by equivalent URL formatting differences (for example `http://127.0.0.1:3210` vs `http://127.0.0.1:3210/`).

## Cross-cutting observations
CLEAN — ready to merge.
