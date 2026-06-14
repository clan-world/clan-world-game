# Phase Super-Swarm Review — PR #526 R2 (head 9941c83)

## SUMMARY
CLEAN. The R1 fix-round lands all 5 MUST fixes and the 4 listed SHOULD fixes in the supplied R1→R1-fix delta, and I did not find any new HIGH or MED regressions in the new shell/compose paths. The main risk left is routine operator drift, not a correctness bug in this patch.

## R1 FIX VERIFICATION
| R1 MUST Fix | Status | Notes |
|---|---|---|
| Makefile set -euo pipefail | LANDED | `bootstrap-convex-admin-key` now guards the critical block with `set -euo pipefail`, uses `&&`, and refuses to install an empty generated key. |
| Bootstrap dev-port proxy startup | LANDED | `Makefile` now starts `convex-backend-dev-port` when `PROFILE=dev`, so the documented fresh-host bootstrap path matches `deploy-convex`'s loopback default. |
| import-convex-schema --include-file-storage | LANDED | Hosted export path now uses `--include-file-storage`; external zips require explicit `CONFIRM_EXPORT_HAS_FILE_STORAGE=1`. |
| deploy script pinned codegen | LANDED | `bin/deploy-convex.sh` now calls the pinned `convex:codegen` scripts and checks the CLI version before deploy. |
| Dashboard curl healthcheck | LANDED | `docker-compose.yml` keeps the curl-based dashboard healthcheck and documents the image verification inline. |
| Backup permissions hardening | LANDED | Backup dir creation is now `0700` and export zips are chmodded `0600` in both backup/import paths. |
| FRESH_SELF_HOSTED target confirmation | LANDED | `import-convex-schema.sh` now requires `CONFIRM_TARGET_URL` to match the self-hosted target before destructive fresh import. |
| check-stack-health wrapper | LANDED | `bin/check-stack-health.sh` exists and `make check-stack-health` is added. |
| Prod origin fail-loud guards | LANDED | `.env.template`, `docker-compose.yml`, and `bin/deploy-convex.sh` now force explicit/routable prod origins instead of silently using localhost/internal defaults. |

## HIGH severity findings (new in R2)

None.

## MEDIUM severity findings (new in R2)

None.

## LOW severity findings (new in R2)

None.

## Cross-cutting observations

CLEAN — ready to merge.
