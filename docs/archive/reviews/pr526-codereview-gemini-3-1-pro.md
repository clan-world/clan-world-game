# Phase Super-Swarm Review — PR #526 (head ba8d426)

## SUMMARY
NEEDS_FIXES. The PR effectively establishes the self-hosted Convex architecture, securely wiring up dev-only access proxies and establishing a robust chicken-and-egg admin key bootstrap. However, there is a critical CI/CD regression where the deploy script uses the unpinned workspace Convex CLI for the SDK codegen, risking version mismatches. A few operational fixes are needed regarding Makefile error handling and container healthchecks before merge.

## HIGH severity findings

**SDK `codegen` uses unpinned CLI version during deploy**
`bin/deploy-convex.sh:46`
The deploy script calls `pnpm --filter @clan-world/sdk codegen`, which runs the unpinned `convex codegen` command (using the workspace `1.17.4` binary). The PR explicitly added a `convex:codegen` script to the SDK's `package.json` to use the pinned `1.39.1` CLI to match the server deployment. Using the unpinned version here breaks the CLI version constraint and will lead to codegen mismatches.
*Suggested fix*: Update `bin/deploy-convex.sh` line 46 to run `pnpm --filter @clan-world/sdk convex:codegen`.

## MEDIUM severity findings

**Silent failure during Convex admin key generation**
`Makefile:31`
The `docker compose ... exec -T convex-backend ./generate_admin_key.sh > "$$tmp";` command is executed inside a continued `\` line block without `set -e`. If the backend container is up but the script fails (e.g., container not fully initialized internally), the error is swallowed, and `install` will silently write an empty or malformed key to `agents/secrets/convex-admin.key`, breaking all subsequent admin commands.
*Suggested fix*: Chain the `docker compose exec` command with `&&` to the `install` command, or insert `set -e;` at the beginning of the `mktemp` block.

**Dashboard healthcheck uses `curl` which may not be available**
`docker-compose.yml:128`
The healthcheck for `convex-dashboard` was changed from `wget --spider -q` to `curl -f`. The standard `get-convex/convex-dashboard` image is typically a minimal Node.js/Alpine container that includes `wget` but may lack `curl`. If `curl` is missing, the healthcheck will permanently fail, which will subsequently block the `convex-dashboard-dev-port` proxy container from starting due to the `depends_on: condition: service_healthy` constraint.
*Suggested fix*: Revert the `convex-dashboard` healthcheck to use `wget`, or explicitly verify that the published dashboard image contains the `curl` binary.

## LOW severity findings

**`NEXT_PUBLIC_DEPLOYMENT_URL` defaults to an internal Docker hostname**
`docker-compose.yml:121`
If `.env` is missing (e.g., during operator bypass testing), the dashboard deployment URL falls back to `http://convex-backend:3210`. Since Next.js `NEXT_PUBLIC_` variables are utilized by the user's browser client, the browser will attempt to resolve the internal `convex-backend` host and fail.
*Suggested fix*: Change the default fallback to `http://localhost:3210` or `http://127.0.0.1:3210` to ensure it resolves correctly in local dev browsers.

**`CONVEX_CLOUD_ORIGIN` default creates inaccessible file storage URLs**
`docker-compose.yml:92`
Similarly, `CONVEX_CLOUD_ORIGIN` defaults to `http://convex-backend:3210`. If Convex uses this origin to serve file storage links to the browser, those links will be unreachable from the host.
*Suggested fix*: Change the default to `http://localhost:3210`.

## Cross-cutting observations

**Volume Mount Migration**
The migration of `convex_data:/data` to `convex_data:/convex/data` in `docker-compose.yml` successfully preserves data by mounting the root of the existing volume to the new internal path. This is a clean approach, provided the backend image was updated to expect the new path. The robust backup runbook additions correctly mitigate the risk of operator confusion.

**Internal URL Topology**
The routing scheme effectively isolates Convex internally in prod while selectively exposing it via socat in dev. The `check-stack-health.sh` validation is a strong operator ergonomic improvement, explicitly validating both internal Docker DNS resolution and host loopback proxies.