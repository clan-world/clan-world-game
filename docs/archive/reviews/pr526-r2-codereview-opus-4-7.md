# Phase Super-Swarm Review — PR #526 R2 (head 9941c83)

## SUMMARY

CLEAN — ready to merge. All 5 MUST and 4 SHOULD fixes from R1 landed correctly. No new HIGH/MED. Two LOW items below — inconsistent `chmod 0600` between backup and hosted-export paths, and unpinned `convex` binary in runbook env-set examples. Neither blocks.

## R1 FIX VERIFICATION

| R1 MUST Fix | Status | Notes |
|---|---|---|
| Makefile `set -euo pipefail` + `&&` chain + empty-key assertion | LANDED | Recipe joins lines with `\` so `set -euo pipefail` applies to one shell. `tmp=$(mktemp)` + `trap … EXIT` cleanup. `[[ ! -s "$tmp" ]]` guards empty stdout before `install -m 600`. Belt-and-suspenders with `&&` chain is fine. |
| Bootstrap dev-port proxy startup | LANDED | `if [[ "$(PROFILE)" == "dev" ]]; then docker compose up -d convex-backend-dev-port; fi`. Runs after backend is healthy and before key-gen. dev-port `depends_on: convex-backend service_healthy`. |
| `import-convex-schema.sh --include-file-storage` + confirm gate | LANDED | Both `convex_cli export …` calls now pass `--include-file-storage`. External `HOSTED_CONVEX_EXPORT_ZIP` path additionally requires `CONFIRM_EXPORT_HAS_FILE_STORAGE=1`. |
| Deploy script pinned codegen + prod-origin preflight | LANDED | `convex:codegen`/`convex:deploy` scripts use `npx -y convex@${CONVEX_CLI_PINNED_VERSION:-1.39.1}`. `require_prod_origins` rejects empty/localhost/127.0.0.1/`convex-backend` values for the three origins when `CHAIN_NETWORK=prod`. |
| Dashboard curl healthcheck | LANDED | `["CMD","curl","-f","http://localhost:6791/"]` + comment `Verified 2026-05-21: …includes /usr/bin/curl`. |

| R1 SHOULD Fix | Status | Notes |
|---|---|---|
| docker-compose + `.env.template` `${VAR:?}` defaults | LANDED | All three origins use `:?` in `docker-compose.yml`; `.env.template` provides dev-safe defaults. Two-layer gate (compose fail-loud + deploy preflight) is correct. |
| Backup perms 0700/0600 | PARTIAL | `backup-convex.sh` does `install -d -m 0700 agents/backups` + `chmod 0600 "$backup_path"`. `import-convex-schema.sh` creates dir 0700 but does NOT `chmod 0600` the hosted-export zip it creates. Dir mode mitigates; see LOW-1. |
| `FRESH_SELF_HOSTED=1` requires `CONFIRM_TARGET_URL` | LANDED | Exact-string match against `target_url` captured early from `CONVEX_SELF_HOSTED_URL` (after host-port default-fill). Error message echoes expected value verbatim — user copy-pastes, no ambiguity around port or trailing slash. |
| `make check-stack-health` | LANDED | Probes `:3210/version`, `:3211/` (any-status — root isn't a 200), `:6791/`, plus host-loopback probes on dev. |

## HIGH severity findings (new in R2)

None.

## MEDIUM severity findings (new in R2)

None.

## LOW severity findings (new in R2)

- **LOW-1: `import-convex-schema.sh` skips `chmod 0600` on hosted export zip.** `backup-convex.sh` chmods to 0600; the hosted-export path here writes `agents/backups/convex-hosted-<ts>.zip` then leaves mode at the convex CLI's default. Dir is `0700` so the file is not reachable through path traversal by other users, but the inconsistency is a real footgun if someone later relaxes the dir mode or copies the zip out. One-line fix: `chmod 0600 "$export_zip"` after the export branch.

- **LOW-2: Runbook uses unpinned `convex` binary for `env set` examples.** `docs/runbooks/self-hosted-convex.md` instructs operators to run `convex env set CLANWORLD_USE_REAL_INDEXER true` etc. directly, relying on whatever `convex` is on `$PATH`. The deploy/backup/import scripts all pin via `npx -y convex@${CONVEX_CLI_PINNED_VERSION}` — the runbook should match (e.g., `npx -y convex@1.39.1 env set …` or `pnpm --filter @clan-world/server exec convex env set …`). Cosmetic, but defeats the pinning rationale at the point operators most commonly run it.

- **LOW-3: `check_exec` (backend `/version`, dashboard `/`) has no `--connect-timeout`.** Only `check_exec_any_status` (port 3211) sets one. If a container is hung or sockets accept-but-don't-respond, `make check-stack-health` could hang. Add `--max-time 5` for robustness.

## Cross-cutting observations

- Volume path migrated `/data` → `/convex/data` and env var renamed `CONVEX_INSTANCE_NAME` → `INSTANCE_NAME`. Both match the get-convex self-hosted image's expected layout. Operators with a pre-existing `clan-world_convex_data` volume would lose data on upgrade, but per CLAUDE.md §4 ("no production users yet, break things freely") this is acceptable; runbook calls out the volume-secret risk loudly.
- Removal of the `convex-admin-key` Docker secret is correct — the backend derives the key from its persisted instance secret, so injecting one via secret had no effect. `make bootstrap-convex-admin-key` now reads the key out of the running backend, which matches actual Convex self-hosted semantics.
- Two-gate prod-origin protection (compose `:?` + deploy-script preflight) is sound. `is_local_origin` covers `localhost`, `127.0.0.1`, and `convex-backend`. Doesn't match `0.0.0.0` — unlikely as a prod misconfig, not worth flagging.
- `convex:codegen` / `convex:deploy` are inline-`${VAR:-default}` in `package.json`. pnpm expands these from the shell env when scripts run. Confirmed both `apps/server` and `packages/sdk` use the same default `1.39.1`, matching `.env.template`'s `CONVEX_CLI_PINNED_VERSION`.

CLEAN — ready to merge.
