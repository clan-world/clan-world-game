# Phase Super-Swarm Review — PR #526 R2 (head 9941c83)

## SUMMARY

**CLEAN — ready to merge.** All 5 MUST FIX and 4 SHOULD FIX items from R1 landed correctly at commit `9941c83` on branch `feat/issue-347-convex-self-host-v2`. The fixes are well-structured, internally consistent, and introduce no new HIGH or MED issues. Three LOW observations noted below, none blocking.

Note: `9941c83` is on `feat/issue-347-convex-self-host-v2`, not yet merged into `pr526` (HEAD `ba8d426`). The current `pr526` branch reverted SDK codegen (`ba8d426`) and lacks several R1 fixes. This review evaluates the fix commit itself.

## R1 FIX VERIFICATION

### MUST FIX

| R1 MUST Fix | Status | Notes |
|---|---|---|
| Makefile `set -euo pipefail` | LANDED | Last recipe block of `bootstrap-convex-admin-key` uses `set -euo pipefail; \` with `&&` chaining + `trap` cleanup. Earlier recipe lines rely on make's built-in exit-status checking per line, which is correct. |
| Bootstrap dev-port proxy startup | LANDED | `@if [[ "$(PROFILE)" == "dev" ]]; then docker compose ... up -d convex-backend-dev-port; fi` inserted between readiness loop and admin-key generation. |
| import-convex-schema `--include-file-storage` | LANDED | Added to the hosted-export codepath (line 75). External zips gated by `CONFIRM_EXPORT_HAS_FILE_STORAGE=1`. |
| Deploy script pinned codegen | LANDED | `convex_cli()` wrapper uses `npx -y "convex@${CONVEX_CLI_PINNED_VERSION:?...}"`. `check_cli_version()` aborts on mismatch. Both SDK and server use `convex:codegen` script → pinned CLI. |
| Dashboard curl healthcheck | LANDED | `wget --spider` replaced with `curl -f`. Verification comment notes `/usr/bin/curl` confirmed in the image. |

### SHOULD FIX

| R1 SHOULD Fix | Status | Notes |
|---|---|---|
| Backup permissions (`0700` dir / `0600` files) | LANDED | `install -d -m 0700 agents/backups` in both `backup-convex.sh` and `import-convex-schema.sh`. `chmod 0600 "$backup_path"` after export in `backup-convex.sh`. Admin key uses `install -m 600` in Makefile. |
| `FRESH_SELF_HOSTED=1` requires `CONFIRM_TARGET_URL` | LANDED | Exact-match check: `"${CONFIRM_TARGET_URL:-}" != "$target_url"`. Error message prints expected value for copy-paste. |
| `make check-stack-health` target | LANDED | Added to `.PHONY` and delegates to `bin/check-stack-health.sh`. Script checks internal endpoints via `docker compose exec` + host loopbacks (dev only). Non-zero exit on any RED. |
| docker-compose prod-origin fail-loud defaults | LANDED | `CONVEX_CLOUD_ORIGIN`, `CONVEX_SITE_ORIGIN`, `CONVEX_DASHBOARD_DEPLOYMENT_URL` all use `${VAR:?message}` in compose. `require_prod_origins()` in deploy-convex.sh rejects localhost/internal values when `CHAIN_NETWORK=prod`. |

## HIGH severity findings (new in R2)

None.

## MEDIUM severity findings (new in R2)

None.

## LOW severity findings (new in R2)

**L1: `is_local_origin()` glob matches overly broad hostnames.** `deploy-convex.sh:35-38` — `http://localhost*` would match `http://localhost.evil.com`. Not a real risk since this is a developer guardrail for prod misconfiguration, not a security boundary. No action needed.

**L2: `CONFIRM_TARGET_URL` has no trailing-slash normalization.** `import-convex-schema.sh:69` — `http://127.0.0.1:3210/` would fail against `http://127.0.0.1:3210`. Mitigated by the error message printing the exact expected value for copy-paste. No action needed.

**L3: `check_cli_version` does raw string comparison on `--version` output.** `deploy-convex.sh:33-39`, `backup-convex.sh:19-25`, `import-convex-schema.sh:19-25` — if a future Convex CLI release changes `--version` output format (e.g., `v1.39.1` or `convex 1.39.1`), the check breaks with a clear error. Standard practice, no action needed.

## Cross-cutting observations

1. **Branch topology**: The fix commit (`9941c83`) lives on `feat/issue-347-convex-self-host-v2`, not on `pr526`. Merging the fix branch into `pr526` (or rebasing `pr526` onto it) is required before the PR reflects the fixes.

2. **`ba8d426` revert on `pr526`**: The current `pr526` HEAD reverted SDK codegen to workspace convex binary. The fix commit re-introduces `convex:codegen` for the SDK. Confirm the revert was intentional and won't conflict when the fix lands.

3. **Consistent defensive patterns**: All three shell scripts (`deploy-convex.sh`, `backup-convex.sh`, `import-convex-schema.sh`) share the same `load_env` / `convex_cli` / `check_cli_version` structure. The duplication is acceptable for standalone scripts that must work independently; extracting a shared lib would add fragility for minimal gain.
