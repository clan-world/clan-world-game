# ClanWorld Dockerize Migration v1 - Phase 2 Cutover Runbook

**What this migrates:** hosted Convex plus the legacy host-run Elder/heartbeat
layout to the current docker-compose stack: self-hosted Convex, `heartbeat`,
`anvil-fork` for dev, and four Elder containers (`elder-1` through `elder-4`)
running tmux, ttyd, and the `elder-runtime` supervisor in one container per
Elder.

**Strategy:** parallel coexistence. Bring up and validate the Docker stack
before disabling legacy services. Public cutover is a cloudflared-only routing
change to the compose `caddy` service, guarded by the Step 8 health checks.

**When to use:** scheduled Phase 2 migration on the ClanWorld VPS after the
rehearsal transcript has been signed off.

**When not to use:** ordinary local dev, partial restarts, or one-off Convex
deploys. For those, use the root `Makefile`, `docker compose`, or the targeted
runbooks linked at the end.

---

## Tooling Versions

Phase 2 migration commands pin Convex CLI **1.17.4** because of issue #531:
Convex CLI 1.39.1 requires `CONVEX_DEPLOYMENT` in flows that break the
isolated rehearsal/import path. The `.env.template` default of
`CONVEX_CLI_PINNED_VERSION=1.39.1` remains correct for normal production
operation after migration, but operators must override it during this cutover:

```bash
export CONVEX_CLI_PINNED_VERSION=1.17.4
```

Keep this export active before running `make deploy-convex` or
`make import-convex-schema` in this runbook.

## Current Stack Facts

| Area | Current source of truth |
|---|---|
| Compose file | `docker-compose.yml` |
| Rehearsal compose | `docker-compose.rehearsal.yml` |
| Root operator targets | `Makefile` |
| Self-hosted Convex runbook | `docs/runbooks/self-hosted-convex.md` |
| Canonical Convex schema | `packages/sdk/convex/schema.ts` |
| Server schema file | `apps/server/convex/schema.ts` re-exports the SDK schema |
| Elder image | `agents/Dockerfile` |
| Elder entrypoint | `agents/entrypoint.sh` |
| Elder runtime supervisor | `packages/elder-runtime/src/main.ts` |
| Heartbeat container | `agents/heartbeat/Dockerfile` + `agents/heartbeat/entrypoint.sh` |

## Current Services

| Service | Profile | Purpose |
|---|---|---|
| `convex-backend` | `dev`, `prod` | Self-hosted Convex backend, internal ports `3210` API and `3211` HTTP actions/site |
| `convex-dashboard` | `dev`, `prod` | Self-hosted Convex dashboard, internal port `6791` |
| `convex-backend-dev-port` | `dev` | Host loopback proxy for backend API |
| `convex-dashboard-dev-port` | `dev` | Host loopback proxy for dashboard |
| `anvil-fork` | `dev` | Forked Base Sepolia RPC for local/dev rehearsals |
| `heartbeat` | `dev`, `prod` | Containerized `@clan-world/runner heartbeat` scheduler |
| `elder-1` to `elder-4` | `dev`, `prod` | One Elder per container: tmux + ttyd + elder-runtime supervisor |

## Existing Make Targets

These are the root targets that exist in this branch:

```bash
make bootstrap-convex-admin-key PROFILE=dev
make deploy-convex
make import-convex-schema
make backup-convex
make check-stack-health
make reset-anvil
```

Do not use older `agents/Makefile` examples for this migration. Targets such as
`up`, `down`, `smoke-test`, bus-secret bootstrap, OAuth bootstrap, and Caddy
snippet install/check are not present in this branch.

## Required Environment

Populate `.env` before production cutover because Docker Compose auto-loads
that file. If you keep local overrides in `.env.local`, pass
`--env-file .env.local` to every `docker compose` command in this runbook.

| Concept | Current variable or file |
|---|---|
| Profile selector | `PROFILE=dev` or `PROFILE=prod` for Make targets |
| Chain selector | `CHAIN_NETWORK=dev` or `CHAIN_NETWORK=prod` |
| Prod RPC | `RPC_URL_PRIMARY` |
| Dev RPC | `DEV_RPC_URL=http://anvil-fork:8545` |
| Diamond | `CLAN_WORLD_CONTRACT_ADDRESS` |
| Lens | `CLAN_WORLD_LENS_ADDRESS` |
| Heartbeat wallet | `RUNNER_PRIVATE_KEY` |
| Runner/indexer write secret | `INDEXER_SECRET` |
| Heartbeat webhook target | `CONVEX_WEBHOOK_URL` |
| Heartbeat webhook secret file | `WEBHOOK_SHARED_SECRET_FILE=agents/secrets/webhook-shared.key` |
| Convex admin key file | `CONVEX_SELF_HOSTED_ADMIN_KEY_FILE=agents/secrets/convex-admin.key` |
| Operator command-bus secret file | `BUS_OPERATOR_SECRET_FILE=agents/secrets/bus-operator.key` |
| Per-Elder bus secret files | `BUS_ELDER_SECRET_FILE_1` through `BUS_ELDER_SECRET_FILE_4` |
| Web frontend Convex URL | `VITE_CONVEX_URL` |

Set Convex deployment env for command-bus auth after self-hosted deploy:

```bash
export CONVEX_SELF_HOSTED_URL=<self-hosted-api-url>
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat agents/secrets/convex-admin.key)"

npx -y convex@1.17.4 env set BUS_OPERATOR_SECRET "$(cat agents/secrets/bus-operator.key)"
npx -y convex@1.17.4 env set BUS_ELDER_SECRET_1 "$(cat "${BUS_ELDER_SECRET_FILE_1:-agents/secrets/bus-elder-1.key}")"
npx -y convex@1.17.4 env set BUS_ELDER_SECRET_2 "$(cat "${BUS_ELDER_SECRET_FILE_2:-agents/secrets/bus-elder-2.key}")"
npx -y convex@1.17.4 env set BUS_ELDER_SECRET_3 "$(cat "${BUS_ELDER_SECRET_FILE_3:-agents/secrets/bus-elder-3.key}")"
npx -y convex@1.17.4 env set BUS_ELDER_SECRET_4 "$(cat "${BUS_ELDER_SECRET_FILE_4:-agents/secrets/bus-elder-4.key}")"
```

The `agentCommands`, `commandResults`, and `elderHeartbeat` tables are defined
in `packages/sdk/convex/schema.ts`. The runtime claims commands with
`queued -> leased -> acked -> completed/failed` state and writes per-Elder
heartbeats to `elderHeartbeat`.

---

## Step 0 - Pre-Flight Inventory

**Goal:** prove the branch, files, secrets, and legacy rollback path are known
before starting.

```bash
git status --short --branch
docker compose version
export CONVEX_CLI_PINNED_VERSION=1.17.4
npx -y convex@1.17.4 --version
cast --version

test -f docker-compose.yml
test -f agents/Dockerfile
test -f agents/entrypoint.sh
test -f agents/heartbeat/Dockerfile
test -f packages/sdk/convex/schema.ts

# Capture rollback artifacts before changing runtime state.
sudo crontab -l > /tmp/sudo-crontab-pre-cutover.txt 2>/dev/null || true
crontab -l > /tmp/user-crontab-pre-cutover.txt 2>/dev/null || true

# Capture current web Convex env for rollback.
vercel env pull /tmp/clanworld-web-env-pre-cutover.env \
  --environment=production \
  --cwd apps/web
rg -n '^VITE_CONVEX_URL=' /tmp/clanworld-web-env-pre-cutover.env

# Capture current legacy heartbeat env for rollback.
if [[ -f ~/.config/clan-world-heartbeat/env ]]; then
  cp -p ~/.config/clan-world-heartbeat/env /tmp/clanworld-heartbeat-env-pre-cutover
  cat /tmp/clanworld-heartbeat-env-pre-cutover
else
  echo "WARNING: ~/.config/clan-world-heartbeat/env not found; record the legacy heartbeat env path manually before proceeding." >&2
fi
```

Record the current hosted Convex URL, current web deployment env, legacy
systemd units, and heartbeat cron/tmux entries in the operator notes.

**Verify:** every command exits 0 and the current branch is the intended
integration branch.

**Rollback:** none; this step is read-only.

## Step 1 - Mandatory Rehearsal

**Goal:** rehearse hosted export, schema deploy, and destructive import against
an isolated self-hosted Convex instance.

```bash
export CONVEX_REHEARSAL_INSTANCE_SECRET="$(openssl rand -hex 32)"
docker compose -f docker-compose.rehearsal.yml up -d
docker compose -f docker-compose.rehearsal.yml ps

mkdir -p agents/secrets agents/backups
docker compose -f docker-compose.rehearsal.yml exec -T convex-backend \
  ./generate_admin_key.sh > agents/secrets/convex-admin.rehearsal.key
chmod 0600 agents/secrets/convex-admin.rehearsal.key
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat agents/secrets/convex-admin.rehearsal.key)"
curl -fsS http://127.0.0.1:38050/api/list_tables \
  -H "Authorization: Convex ${CONVEX_SELF_HOSTED_ADMIN_KEY}" >/tmp/rehearsal-list-tables.json

export CONVEX_CLI_PINNED_VERSION=1.17.4
export HOSTED_EXPORT="agents/backups/convex-hosted-rehearsal-$(date -u +%Y%m%dT%H%M%SZ).zip"
npx -y "convex@${CONVEX_CLI_PINNED_VERSION}" export --path "$HOSTED_EXPORT" --include-file-storage
sha256sum packages/sdk/convex/schema.ts > /tmp/clanworld-sdk-schema.sha256

export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:38050
npx -y "convex@${CONVEX_CLI_PINNED_VERSION}" deploy --yes
npx -y "convex@${CONVEX_CLI_PINNED_VERSION}" import --replace-all --yes "$HOSTED_EXPORT"
```

`docker-compose.rehearsal.yml` wires
`INSTANCE_SECRET=${CONVEX_REHEARSAL_INSTANCE_SECRET}` explicitly. It has a
local-only fallback so `docker compose config` remains parseable, but signed
rehearsals must export a fresh random value as shown above.

Fill in `docs/runbooks/dockerize-migration-v1-rehearsal-transcript.md`, then
tear the rehearsal down:

```bash
docker compose -f docker-compose.rehearsal.yml down -v
rm -f agents/secrets/convex-admin.rehearsal.key
```

**Verify:** export exists, schema deploy exits 0, import exits 0, transcript is
signed off.

**Rollback:** `docker compose -f docker-compose.rehearsal.yml down -v`.

## Step 2 - Production Backup From Hosted Convex

**Goal:** capture the authoritative hosted snapshot and schema fingerprint.

```bash
mkdir -p agents/backups
HOSTED_EXPORT="agents/backups/convex-hosted-prod-$(date -u +%Y%m%dT%H%M%SZ).zip"
npx -y convex@1.17.4 export --path "$HOSTED_EXPORT" --include-file-storage
chmod 0600 "$HOSTED_EXPORT"
sha256sum packages/sdk/convex/schema.ts | tee agents/backups/sdk-schema-pre-migration.sha256
ls -lh "$HOSTED_EXPORT"
```

**Verify:** backup zip size is non-zero and the SDK schema hash is recorded.

**Rollback:** none; this step is read-only.

## Step 3 - Start Self-Hosted Convex

**Goal:** bring up production self-hosted Convex and generate the admin key from
the running backend.

```bash
docker compose --profile prod up -d convex-backend convex-dashboard
docker compose --profile prod ps convex-backend convex-dashboard

export CONVEX_CLI_PINNED_VERSION=1.17.4
make bootstrap-convex-admin-key PROFILE=prod
make deploy-convex
```

For prod, ensure `CONVEX_CLOUD_ORIGIN`, `CONVEX_SITE_ORIGIN`, and
`CONVEX_DASHBOARD_DEPLOYMENT_URL` are routed, browser-reachable URLs. The
deploy script rejects localhost/internal prod origins.

**Verify:**

```bash
test -s agents/secrets/convex-admin.key
docker compose --profile prod exec -T convex-backend curl -fsS http://localhost:3210/version
```

**Rollback:**

```bash
docker compose --profile prod down
```

Do not remove `clan-world_convex_data` unless a backup exists and Liam approves
destroying the self-hosted instance state.

## Step 4 - Import Hosted Data Into Self-Hosted Convex

**Goal:** import the hosted export into the fresh self-hosted deployment.

```bash
export HOSTED_CONVEX_EXPORT_ZIP="$HOSTED_EXPORT"
export CONFIRM_EXPORT_HAS_FILE_STORAGE=1
export FRESH_SELF_HOSTED=1
export CONFIRM_TARGET_URL="${CONVEX_SELF_HOSTED_URL:?set this to the production self-hosted API URL}"
export CONVEX_CLI_PINNED_VERSION=1.17.4
make import-convex-schema
```

The import script checks the local SDK schema fingerprint and requires explicit
confirmation before `--replace-all`.

**Verify:** import exits 0. Then open the Convex dashboard through the routed
admin URL and spot-check expected tables, including `agentCommands`,
`elderHeartbeat`, `commandResults`, `runnerStatus`, `tickClock`, and
`worldSnapshot`.

**Rollback:**

```bash
docker compose --profile prod down
```

This rollback only stops the stack. Imported self-hosted data remains in the
`clan-world_convex_data` volume. Destructive recovery, including removing that
volume or replacing imported data, requires explicit Liam approval and a named
backup/export path.

## Step 5 - Configure Convex Env

**Goal:** set indexer, heartbeat, and command-bus env on the self-hosted Convex
deployment.

```bash
export CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:?set self-hosted API URL}"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat agents/secrets/convex-admin.key)"

npx -y convex@1.17.4 env set CLANWORLD_USE_REAL_INDEXER true
npx -y convex@1.17.4 env set INDEXER_START_BLOCK <block-at-cutover>
npx -y convex@1.17.4 env set INDEXER_SECRET "$INDEXER_SECRET"
npx -y convex@1.17.4 env set RPC_URL_PRIMARY "$RPC_URL_PRIMARY"
npx -y convex@1.17.4 env set CLAN_WORLD_CONTRACT_ADDRESS "$CLAN_WORLD_CONTRACT_ADDRESS"
npx -y convex@1.17.4 env set CLAN_WORLD_LENS_ADDRESS "$CLAN_WORLD_LENS_ADDRESS"
npx -y convex@1.17.4 env set WEBHOOK_SHARED_SECRET "$(cat agents/secrets/webhook-shared.key)"
npx -y convex@1.17.4 env set BUS_OPERATOR_SECRET "$(cat agents/secrets/bus-operator.key)"
npx -y convex@1.17.4 env set BUS_ELDER_SECRET_1 "$(cat "${BUS_ELDER_SECRET_FILE_1:-agents/secrets/bus-elder-1.key}")"
npx -y convex@1.17.4 env set BUS_ELDER_SECRET_2 "$(cat "${BUS_ELDER_SECRET_FILE_2:-agents/secrets/bus-elder-2.key}")"
npx -y convex@1.17.4 env set BUS_ELDER_SECRET_3 "$(cat "${BUS_ELDER_SECRET_FILE_3:-agents/secrets/bus-elder-3.key}")"
npx -y convex@1.17.4 env set BUS_ELDER_SECRET_4 "$(cat "${BUS_ELDER_SECRET_FILE_4:-agents/secrets/bus-elder-4.key}")"
```

**Verify:** `npx -y convex@1.17.4 env list` shows the expected keys. Do not
paste secret values into issue comments or PR logs.

**Rollback:** restore the web app and legacy heartbeat env captured in Step 0.
Leave the self-hosted Convex env in place for inspection.

```bash
HOSTED_VITE_CONVEX_URL="$(
  rg -N '^VITE_CONVEX_URL=' /tmp/clanworld-web-env-pre-cutover.env | head -1 | cut -d= -f2-
)"
test -n "$HOSTED_VITE_CONVEX_URL"

vercel env rm VITE_CONVEX_URL production --yes --cwd apps/web || true
printf '%s\n' "$HOSTED_VITE_CONVEX_URL" \
  | vercel env add VITE_CONVEX_URL production --cwd apps/web
vercel deploy --prod --cwd apps/web

if [[ -f /tmp/clanworld-heartbeat-env-pre-cutover ]]; then
  mkdir -p ~/.config/clan-world-heartbeat
  install -m 600 /tmp/clanworld-heartbeat-env-pre-cutover ~/.config/clan-world-heartbeat/env
fi
```

## Step 6 - Start Heartbeat And Elder Containers

**Goal:** mask the legacy runner first, then run the Docker heartbeat and
Elder fleet. Mask legacy runner FIRST so only the new Docker heartbeat fires
on-chain transactions.

```bash
sudo systemctl stop clanworld-runner.service
sudo systemctl disable clanworld-runner.service
systemctl status clanworld-runner.service --no-pager || true

docker compose --profile prod up -d heartbeat elder-1 elder-2 elder-3 elder-4
docker compose --profile prod ps heartbeat elder-1 elder-2 elder-3 elder-4
docker compose --profile prod logs --tail=100 heartbeat
```

Each Elder container starts:

- a named tmux session (`elder-N`) running `agents/shared/run.sh`,
- ttyd on container port `7681`, attached to that tmux session,
- `tsx /opt/elder-runtime/src/main.ts`, the command-bus supervisor.

The supervisor claims commands from Convex, writes command results, maintains
`elderHeartbeat`, and uses the tmux sink hot-fix path that pipes content into
`tmux load-buffer` via stdin before pasting.

**Verify:**

```bash
docker compose --profile prod exec -T elder-1 tmux has-session -t elder-1
docker compose --profile prod exec -T elder-1 pgrep -f 'ttyd'
docker compose --profile prod exec -T elder-1 pgrep -f 'tsx.*main.ts'
docker compose --profile prod exec -T elder-1 test -f /workspace/.runtime/elder-runtime.ready
```

Repeat for `elder-2`, `elder-3`, and `elder-4`.

**Rollback:**

```bash
docker compose --profile prod stop heartbeat elder-1 elder-2 elder-3 elder-4
sudo systemctl enable --now clanworld-runner.service
sudo crontab /tmp/sudo-crontab-pre-cutover.txt
crontab /tmp/user-crontab-pre-cutover.txt
```

## Step 7 - Internal Health Gate

**Goal:** prove the current container stack is healthy before any public
routing or web env cutover.

```bash
make check-stack-health PROFILE=prod
docker compose --profile prod ps
docker compose --profile prod logs --since=10m heartbeat elder-1 elder-2 elder-3 elder-4
```

`make check-stack-health` currently checks Convex backend, HTTP actions/site,
and dashboard reachability. It does not yet replace a full elder command-bus
smoke test.

Manual command-bus smoke:

```bash
export CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:?set self-hosted API URL}"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat agents/secrets/convex-admin.key)"
npx -y convex@1.17.4 run commandBus:enqueueCommand '{
  "secret": "'"$(cat agents/secrets/bus-operator.key)"'",
  "targetAgentId": "elder-1",
  "kind": "snapshot_request",
  "payload": {"lines": 80},
  "source": "migration-runbook"
}'
```

Then verify `commandResults` and `elderHeartbeat` update in the dashboard.

**Rollback:**

1. Stop Docker heartbeat and Elders:

   ```bash
   docker compose --profile prod stop heartbeat elder-1 elder-2 elder-3 elder-4
   ```

2. Re-enable the legacy runner, reversing Step 6's `stop` + `disable`:

   ```bash
   sudo systemctl enable --now clanworld-runner.service
   ```

3. Verify the legacy runner is healthy and consuming heartbeats again before
   investigating the failed Docker health gate.

## Step 8 - Docker Caddy Public Routing Gate

**Goal:** route `app.clan-world.com` to the Docker Caddy service only after the
compose stack is healthy internally.

The ClanWorld router is the compose `caddy` service. Host Caddy is not in the
`app.clan-world.com` path; it continues serving unrelated shared-host routes.
Warning: restarting cloudflared briefly drops ALL tunnels, usually for about 5
seconds. Choose an operator-approved time.

Back up the current config:

```bash
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak-$(date +%Y%m%d%H%M%S)
```

Edit `/etc/cloudflared/config.yml` and add one ingress entry BEFORE the final
`http_status:404` catch-all rule. Cloudflared does not expand shell variables
in `config.yml`; this example assumes the default `CADDY_HOST_PORT=18081`:

```yaml
- hostname: app.clan-world.com
  service: http://127.0.0.1:18081
  originRequest:
    httpHostHeader: app.clan-world.com
```

Validate Docker Caddy locally before restarting cloudflared:

```bash
docker compose --profile prod up -d caddy
curl -sf "http://127.0.0.1:${CADDY_HOST_PORT:-18081}/healthz"
curl -I "http://127.0.0.1:${CADDY_HOST_PORT:-18081}/elder-1/"
```

Validate the cloudflared config, restart cloudflared, and verify the new route
plus one existing tunnel:

```bash
sudo cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
sudo systemctl restart cloudflared
curl -I https://app.clan-world.com/healthz
curl -I https://cockpit.clan-world.com
```

Then verify:

- `app.clan-world.com` routes to the current web app,
- `/map` reaches the public map route,
- `/elder-1/` through `/elder-4/` reach the Docker-internal ttyd services,
- legacy `cockpit.clan-world.com/elder-N-tty/` still works during coexistence.

**Rollback:** restore the timestamped backup from the first command and restart
cloudflared:

```bash
sudo cp /etc/cloudflared/config.yml.bak-YYYYMMDDHHMMSS /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```

Keep the Docker stack running internally for diagnosis if it is healthy.

## Step 9 - Swap Web App Convex URL

**Goal:** point the browser app at self-hosted Convex after internal health and
public routing are both green.

Set the web deployment's `VITE_CONVEX_URL` to the routed self-hosted Convex API
origin. Then redeploy the web app through the existing deployment process.

**Verify:** open the live app, check browser network traffic, and confirm
Convex requests use the self-hosted URL.

**Rollback:** restore `VITE_CONVEX_URL` to the hosted Convex URL and redeploy.

## Step 10 - 30-Minute Coexist Observation

**Goal:** observe the Docker stack after the legacy runner has been masked.
Legacy state and the captured rollback files remain available, but the legacy
runner must stay stopped so it does not double-fire heartbeat transactions.

Run in separate terminals:

```bash
systemctl status clanworld-runner.service --no-pager || true
docker compose --profile prod logs -f heartbeat elder-1 elder-2 elder-3 elder-4
```

Observe for at least 30 minutes:

- no unhandled errors in `heartbeat`,
- `runnerStatus` updates from the heartbeat container,
- `elderHeartbeat` updates for each Elder,
- no command-bus lease buildup in `agentCommands`,
- `clanworld-runner.service` remains inactive.

**Rollback:** stop Docker heartbeat/Elders, re-enable the legacy runner, restore
saved crontabs, and investigate.

## Step 11 - Confirm Legacy Runner Disabled And Remove Legacy Cron

**Goal:** keep the legacy runner disabled after the coexist observation and
remove any legacy heartbeat cron entries. The runner was already stopped in
Step 6 before the Docker heartbeat started.

```bash
sudo systemctl stop clanworld-runner.service
sudo systemctl disable clanworld-runner.service

sudo crontab -l | grep -v clanworld-heartbeat | sudo crontab -
crontab -l | grep -v clanworld-heartbeat | crontab -

pgrep -af clanworld-runner || true
```

**Verify:** `systemctl status clanworld-runner.service` is inactive and no
legacy heartbeat cron remains.

**Rollback:**

```bash
sudo systemctl enable --now clanworld-runner.service
sudo crontab /tmp/sudo-crontab-pre-cutover.txt
crontab /tmp/user-crontab-pre-cutover.txt
```

## Step 12 - 24-Hour Soak

**Goal:** prove the Docker stack can run through normal operation before
archiving legacy state.

During soak:

```bash
make check-stack-health PROFILE=prod
docker compose --profile prod ps
docker compose --profile prod logs --since=1h heartbeat elder-1 elder-2 elder-3 elder-4
```

Check Convex dashboard rows for `runnerStatus`, `elderHeartbeat`,
`agentCommands`, `commandResults`, `tickClock`, and `worldSnapshot`.

**Rollback during soak:** re-enable legacy runner/heartbeat, restore
`VITE_CONVEX_URL` to hosted Convex, and stop Docker heartbeat/Elders.

## Step 13 - Archive Legacy State

**Goal:** archive, not delete, legacy state after a clean soak.

```bash
ARCHIVE_DATE=$(date +%Y%m%d)
mkdir -p ~/.world/archive
mkdir -p docs/operations

mv ~/code/clan-world/legacy-runner-state \
  ~/.world/archive/runner-state-pre-dockerize-${ARCHIVE_DATE}

cat >> docs/operations/dockerize-cutover-${ARCHIVE_DATE}.md <<EOF
# ClanWorld Dockerize Cutover - ${ARCHIVE_DATE}

Legacy runner state archived to:
  ~/.world/archive/runner-state-pre-dockerize-${ARCHIVE_DATE}

Cutover completed by: <operator>
Soak period: <start ET> - <end ET>
All checks passed: yes
EOF
```

**Verify:** archive path exists and legacy state has not been silently deleted.

**Rollback:** move the archive back to the original path.

---

## Troubleshooting

### Compose Fails During Config Interpolation

The compose file intentionally requires production values. Populate `.env`
before `docker compose --profile prod config`, or pass
`--env-file .env.local` explicitly if using local override files.

Common missing values: `CHAIN_NETWORK`, `RUNNER_PRIVATE_KEY`,
`CLAN_WORLD_CONTRACT_ADDRESS`, `INDEXER_SECRET`, `CONVEX_WEBHOOK_URL`,
`CONVEX_CLOUD_ORIGIN`, `CONVEX_SITE_ORIGIN`, and
`CONVEX_DASHBOARD_DEPLOYMENT_URL`.

### Self-Hosted Convex Is Unhealthy

```bash
docker compose --profile prod logs convex-backend --tail=100
docker compose --profile prod exec -T convex-backend curl -fsS http://localhost:3210/version
```

If the admin key file is missing, regenerate it from the running backend:

```bash
make bootstrap-convex-admin-key PROFILE=prod FORCE=1
```

### Import Is Refused

`make import-convex-schema` refuses destructive imports unless the confirmation
env vars are set. For a fresh self-hosted target, set:

```bash
FRESH_SELF_HOSTED=1
CONFIRM_TARGET_URL=<exact self-hosted URL>
HOSTED_CONVEX_EXPORT_ZIP=<export zip>
CONFIRM_EXPORT_HAS_FILE_STORAGE=1
```

### Agent Containers Cannot Reach Convex

Inside an Elder container:

```bash
docker compose --profile prod exec -T elder-1 curl -fsS http://convex-backend:3210/version
```

Then verify `CONVEX_DEPLOY_URL=http://convex-backend:3210` and
`BUS_ELDER_SECRET_FILE=/run/secrets/bus-elder-N` in the service definition.

### Elder Runtime Restart Loop

```bash
docker compose --profile prod logs elder-1 --tail=120
docker compose --profile prod exec -T elder-1 ls -l /workspace/.runtime
```

Common causes:

- missing `ELDER_N`,
- missing per-Elder `.env`,
- unreadable bus secret file,
- stale `/workspace/.runtime/supervisor.lock`,
- Claude OAuth token missing from `agents/elder-N/.env`.

### Heartbeat Container Fails

```bash
docker compose --profile prod logs heartbeat --tail=150
```

Confirm `CHAIN_NETWORK`, selected RPC URL, `RUNNER_PRIVATE_KEY`,
`CLAN_WORLD_CONTRACT_ADDRESS`, `INDEXER_SECRET`, `CONVEX_URL`,
`CONVEX_DEPLOY_URL`, and `CONVEX_WEBHOOK_URL`.

## Pager Quick Reference

Stop the new Docker heartbeat and Elder fleet:

```bash
docker compose --profile prod stop heartbeat elder-1 elder-2 elder-3 elder-4
```

Inspect stack health:

```bash
make check-stack-health PROFILE=prod
docker compose --profile prod ps
```

Restart one Elder:

```bash
docker compose --profile prod restart elder-1
docker compose --profile prod logs --tail=100 elder-1
```

Tail heartbeat and Elder logs:

```bash
docker compose --profile prod logs -f heartbeat
docker compose --profile prod logs -f elder-1 elder-2 elder-3 elder-4
```

Restore legacy runner service:

```bash
sudo systemctl enable --now clanworld-runner.service
```

Restore saved crontabs:

```bash
sudo crontab /tmp/sudo-crontab-pre-cutover.txt
crontab /tmp/user-crontab-pre-cutover.txt
```

Key Convex URLs:

| Purpose | URL |
|---|---|
| Docker-internal API | `http://convex-backend:3210` |
| Docker-internal HTTP actions/site | `http://convex-backend:3211` |
| Dev host API loopback | `http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}` |
| Dev dashboard loopback | `http://127.0.0.1:${CONVEX_DASHBOARD_HOST_PORT:-6791}` |

Key Convex tables to inspect:

| Table | Meaning |
|---|---|
| `runnerStatus` | Heartbeat caller liveness and last fire result |
| `elderHeartbeat` | Per-Elder runtime liveness |
| `agentCommands` | Command-bus queue and lease state |
| `commandResults` | Command-bus completion/failure output |
| `tickClock` | Current tick clock |
| `worldSnapshot` | Latest indexed game snapshot |

## Cross-Links

- `docs/runbooks/self-hosted-convex.md`
- `docs/plans/dockerize-elder-infra-v1.md`
- `docs/plans/dockerize-v1-revision-notes.md`
- `agents/heartbeat/README.md`
- `agents/README.md`
- `docker-compose.yml`
- `docker-compose.rehearsal.yml`
- `docs/runbooks/dockerize-migration-v1-rehearsal-transcript.md`
