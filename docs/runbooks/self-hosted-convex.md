# Self-Hosted Convex Runbook

Issue #347 stands up Convex backend + dashboard inside the compose stack and
deploys the existing `apps/server/convex/` functions against the canonical SDK
schema in `packages/sdk/convex/schema.ts`.

## First Bootstrap

1. Start the backend and generate a CLI/dashboard admin key:

   ```bash
   make bootstrap-convex-admin-key PROFILE=dev
   ```

2. Back up `agents/secrets/convex-admin.key` to the operator password manager.
   The backend does not read this file on boot; it derives the key from the
   instance secret persisted inside the `convex_data` Docker volume.

3. Deploy code:

   ```bash
   make deploy-convex
   ```

## Deploy Sequence

`make deploy-convex` runs:

```bash
pnpm --filter @clan-world/sdk codegen
pnpm --filter @clan-world/server convex:codegen
pnpm typecheck
pnpm --filter @clan-world/server convex:deploy
```

The deploy script exports `CONVEX_SELF_HOSTED_URL` and
`CONVEX_SELF_HOSTED_ADMIN_KEY` for the Convex CLI. There is no `--self-hosted`
Convex CLI flag in the supported flow.

## Post-Deploy Env

After first deploy, set the indexer env on the self-hosted deployment:

```bash
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat agents/secrets/convex-admin.key)"

convex env set CLANWORLD_USE_REAL_INDEXER true
convex env set INDEXER_START_BLOCK <block-at-deploy>
convex env set INDEXER_SECRET <secret>
convex env set RPC_URL_PRIMARY <base-sepolia-rpc>
convex env set CLAN_WORLD_CONTRACT_ADDRESS <diamond>
convex env set CLAN_WORLD_LENS_ADDRESS <lens>
convex env set WEBHOOK_SHARED_SECRET <secret>
```

The heartbeat container posts HTTP actions to
`CONVEX_WEBHOOK_URL=http://convex-backend:3211`.

## Backup And Restore

Create a pre-migration or pre-reset backup:

```bash
make backup-convex
```

Backups are written to `agents/backups/convex-<timestamp>.zip`.

Restore/import into a fresh self-hosted backend:

This is a destructive import. It uses `--replace-all` and is intended only for
a fresh backend or an explicitly confirmed restore.

```bash
FRESH_SELF_HOSTED=1 make import-convex-schema
```

## Do Not Remove `convex_data` Casually

`clan-world_convex_data` contains:

- the SQLite database,
- file storage,
- the generated Convex instance secret,
- the root material used to derive `agents/secrets/convex-admin.key`.

Removing this volume destroys the admin-key root and all self-hosted Convex
data. Always run `make backup-convex` before any operation that might remove
`clan-world_convex_data`.

## Health Checks

```bash
bash bin/check-stack-health.sh
```

Expected dev endpoints:

- backend API: `http://127.0.0.1:3210/version`
- dashboard: `http://127.0.0.1:6791/`
- internal HTTP actions: `http://convex-backend:3211`

If the dashboard loads but cannot authenticate, regenerate or restore
`agents/secrets/convex-admin.key` from the running backend with
`make bootstrap-convex-admin-key FORCE=1 PROFILE=dev`.
