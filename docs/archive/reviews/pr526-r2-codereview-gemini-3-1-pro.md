# Phase Super-Swarm Review — PR #526 R2 (head 9941c83)

## SUMMARY
NEEDS_FIXES. The R1 fix-round successfully addressed all 5 MUST-fix items and 3 of the 4 SHOULD-fix items, ensuring clean bootstraps and prod fail-safes. However, it partially missed SHOULD #2, leaving hosted schema exports without protected file permissions. Fix this medium severity issue before merging.

## R1 FIX VERIFICATION
| R1 MUST Fix | Status | Notes |
|---|---|---|
| Makefile set -euo pipefail | LANDED | Safe and functional; handles failures correctly. |
| Bootstrap dev-port proxy startup | LANDED | Included correctly in dev profile startup sequence. |
| import-convex-schema --include-file-storage | LANDED | Added with the appropriate external zip safety gate. |
| deploy script pinned codegen | LANDED | CLI version checked and pinned codegen command used. |
| Dashboard curl healthcheck | LANDED | Updated to use curl as verified. |

**SHOULD Fixes:**
1. prod-origin fail-loud defaults: **LANDED**
2. Backup permissions: **BROKEN** (Missed in `import-convex-schema.sh`)
3. FRESH_SELF_HOSTED requires CONFIRM_TARGET_URL: **LANDED**
4. make check-stack-health target: **LANDED**

## HIGH severity findings (new in R2)
None.

## MEDIUM severity findings (new in R2)
1. **Unprotected Hosted Export Permissions:** `import-convex-schema.sh` creates the hosted backup zip (`$export_zip`) but fails to run `chmod 0600` on it after export, unlike `backup-convex.sh`. This leaves potentially sensitive export data with default system permissions.

## LOW severity findings (new in R2)
1. **Strict Target URL Equality:** The `CONFIRM_TARGET_URL` gate uses strict string matching (`!= "$target_url"`). If an operator includes a trailing slash (e.g., `http://127.0.0.1:3210/`), the import will safely fail but might cause minor UX friction.
2. **Redundant Makefile Pattern:** In the `bootstrap-convex-admin-key` target, mixing `set -euo pipefail` with an `&&` chain for the main execution block is stylistically contradictory. The `&&` chain naturally suppresses `set -e` intermediate triggers. It functionally works because the chain is the last statement (causing the shell to exit non-zero on failure anyway), but replacing `&& \` with `; \` is the standard pattern under `set -e`.

## Cross-cutting observations
The R1 fixes are generally well-implemented and the prod fail-loud defaults are solid. Once the backup permissions oversight in the import script is fixed, this PR is clean to merge.