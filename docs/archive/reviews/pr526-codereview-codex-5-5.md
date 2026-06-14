# Phase Super-Swarm Review — PR #526 (head ba8d426)

## SUMMARY
NEEDS_FIXES. The compose topology is close, and the `convex-backend:3211` webhook contract lines up with sibling PR #525, but the bootstrap/import paths still have merge-blocking operator footguns. Fix admin-key bootstrap error handling, start the dev loopback required by the documented deploy path, and preserve file storage during destructive imports before merging.

## HIGH severity findings

- `Makefile:31` — `bootstrap-convex-admin-key` can write an empty or bad admin key and still exit green. The continued recipe chains commands with `;`, so a failing `docker compose ... ./generate_admin_key.sh` does not stop `install`, `sha256sum`, or the success message. Because shell redirection creates the temp file before `exec`, this can persist a zero-byte `agents/secrets/convex-admin.key` with mode `0600`, then make later deploy failures look like opaque auth errors. Suggested fix: run the block under `set -euo pipefail`, use `&&`, and assert `[[ -s "$$tmp" ]]` before installing.

- `Makefile:23` + `bin/deploy-convex.sh:20` + `docs/runbooks/self-hosted-convex.md:9` — the documented first-bootstrap flow does not start the host loopback proxy that deploy requires. `make bootstrap-convex-admin-key PROFILE=dev` only starts `convex-backend`; `make deploy-convex` then targets `http://127.0.0.1:3210`, which is only served by `convex-backend-dev-port`. On a fresh machine, the runbook’s step 1 then step 3 fails even though the backend is healthy. Suggested fix: have the bootstrap target also start `convex-backend-dev-port` for `PROFILE=dev`, or make the runbook start the dev stack/proxy before deploy.

- `bin/import-convex-schema.sh:75` — hosted-to-self-hosted import does not round-trip file storage. `backup-convex.sh` exports with `--include-file-storage`, but the hosted export branch here uses plain `convex_cli export --path "$export_zip"` and then performs `import --replace-all --yes`. If the source deployment has Convex file storage, the self-hosted replacement import silently drops it. Suggested fix: add `--include-file-storage` to the hosted export path, and require an explicit acknowledgement when `HOSTED_CONVEX_EXPORT_ZIP` is supplied externally because the script cannot prove that zip contains file storage.

## MEDIUM severity findings

- `bin/backup-convex.sh:42` — backups are created with default directory/archive permissions. These exports can contain the full Convex dataset and file storage, but `mkdir -p agents/backups` and the generated zip inherit the process umask, commonly resulting in `0755` directories and `0644` archives on shared hosts. Suggested fix: create the directory with `install -d -m 0700 agents/backups` and `chmod 0600 "$backup_path"` after export.

- `bin/import-convex-schema.sh:78` — `FRESH_SELF_HOSTED=1` bypasses the destructive import confirmation without verifying freshness. A stale shell export or wrong target URL can still run `--replace-all --yes` against a populated backend. Suggested fix: when `FRESH_SELF_HOSTED=1`, first query/inspect the target and assert it has no app data, or require a second target-specific confirmation such as `CONFIRM_TARGET_URL=$CONVEX_SELF_HOSTED_URL`.

- `docker-compose.yml:97` and `docker-compose.yml:122` — prod/browser origins are not fail-loud. If `.env` is incomplete or `CHAIN_NETWORK=prod` reuses defaults, the backend/dashboard can advertise Docker-internal hosts like `convex-backend`, which browsers cannot resolve. Suggested fix: add a prod overlay or validation script that requires browser-routable `CONVEX_CLOUD_ORIGIN` and `CONVEX_DASHBOARD_DEPLOYMENT_URL` before prod deployment.

- `bin/deploy-convex.sh:32`, `bin/backup-convex.sh:18`, `bin/import-convex-schema.sh:18` — the CLI version check is mostly tautological because the helper invokes `npx -y convex@${CONVEX_CLI_PINNED_VERSION}` and then checks that exact binary’s version. It does not protect against the workspace `convex` dependency drifting or accidental use of the unpinned binary elsewhere. Suggested fix: either drop the check as noise, or validate the actual command path used by each script/package.

## LOW severity findings

- `Makefile:6` — there is no `check-stack-health` target even though `bin/check-stack-health.sh` is part of the operator surface. Add a make target so the runbook can use the same interface as deploy/backup/import.

- `docs/runbooks/self-hosted-convex.md:45` — the manual `convex env set` snippet uses `convex` directly instead of the pinned CLI wrapper. That can accidentally use the workspace `1.17.4` binary or a global install. Prefer `npx -y convex@${CONVEX_CLI_PINNED_VERSION:-1.39.1}` or add a helper target.

- `Makefile:35` — the generated `.sha256` fingerprint file is not mentioned in the runbook. Either document how operators should use it during key restore/rotation, or skip writing it.

- `bin/check-stack-health.sh:53` — `check_exec_any_status` is the right shape for the HTTP actions origin, but the output does not explain that a non-2xx response can still be healthy. Add a short label like “reachable, any HTTP status accepted” to avoid operator confusion.

## Cross-cutting observations

The admin-key lifecycle direction is good: deriving a host-side operator credential from the backend’s persisted instance root keeps the key out of `docker inspect` and makes `convex_data` the correct durability boundary. The runbook’s warnings about preserving that volume are useful and should stay loud.

The biggest pattern to tighten is “operator path as code.” The PR adds useful scripts, but the fresh-bootstrap path, import path, and health path need the same level of fail-fast validation as the compose service definitions. A small shared shell helper for loading env, selecting the pinned CLI, enforcing secret/backup permissions, and checking the loopback would remove repeated logic and reduce future drift.