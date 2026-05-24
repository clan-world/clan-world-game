# Phase Super-Swarm Review — PR #526 R2 (head 9941c83)

## SUMMARY
CLEAN for the reviewed R1-fix SHA `9941c83`: the 5 MUST fixes and 4 requested SHOULD fixes landed cleanly, with no new HIGH/MED blockers found in the R1->R1-fix delta. Note: the local checkout is currently `ba8d426`, which follows up by reverting SDK CI codegen to the workspace Convex binary; this review verified `9941c83` via `git show` plus the supplied diff.

## R1 FIX VERIFICATION
| R1 Fix | Status | Notes |
|---|---|---|
| Makefile set -euo pipefail | LANDED | Bootstrap key generation now runs in one guarded shell block, checks non-empty output before install, and cleans temp file via trap. Make recipe semantics are OK because the guarded block is line-continued. |
| Bootstrap dev-port proxy startup | LANDED | `PROFILE=dev` now starts `convex-backend-dev-port` after backend health, so host-run deploy can reach `127.0.0.1:3210`. |
| import-convex-schema --include-file-storage | LANDED | Hosted export path now includes `--include-file-storage`; external zips require `CONFIRM_EXPORT_HAS_FILE_STORAGE=1`. |
| deploy script pinned codegen | LANDED | `deploy-convex.sh` uses `convex:codegen` for SDK and server at `9941c83`. Follow-up `ba8d426` adjusts SDK CI path; not a blocker for this R2 SHA. |
| Dashboard curl healthcheck | LANDED | Kept curl healthcheck and added image-verification comment. |
| Backup permissions | LANDED | `backup-convex.sh` uses `install -d -m 0700` and `chmod 0600` for backup zips; `agents/backups/` is ignored by git/docker. |
| Prod-origin fail-loud / preflight | LANDED | Compose uses required substitutions at `9941c83`; deploy script rejects localhost/internal prod origins when `CHAIN_NETWORK=prod`. |
| FRESH_SELF_HOSTED target confirmation | LANDED | `CONFIRM_TARGET_URL` must exactly match the resolved self-hosted target URL before destructive fresh import. Exact matching is strict but acceptable for an operator safety gate. |
| make check-stack-health | LANDED | Target exists at `9941c83` and delegates to `bin/check-stack-health.sh`. |

## HIGH severity findings (new in R2)
None.

## MEDIUM severity findings (new in R2)
None.

## LOW severity findings (new in R2)
- `bin/import-convex-schema.sh` — the generated hosted export lands under a `0700` directory, but unlike `backup-convex.sh` it does not explicitly `chmod 0600 "$export_zip"`. Directory permissions mitigate this; align for consistency when touching the script next.
- `bin/import-convex-schema.sh` — `CONFIRM_TARGET_URL` is byte-exact, so trailing slash or `localhost` vs `127.0.0.1` will fail. That is acceptable for a destructive gate, but the error should remain clear.

## Cross-cutting observations
The R1 fix-round tightened the operator path substantially: bootstrap is fail-fast, fresh-host deploy has its loopback, destructive imports preserve file storage, and prod URL mistakes now fail before deploy. CLEAN — ready to merge, modulo the already-present follow-up `ba8d426` SDK codegen CI adjustment.
