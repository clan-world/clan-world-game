# ClanWorld Dockerize Migration v1 - Rehearsal Transcript

> Operator note: fill this out while running the rehearsal pass from
> `docs/runbooks/dockerize-migration-v1.md`. The rehearsal stack is isolated
> by `docker-compose.rehearsal.yml` and should be destroyed with `down -v`
> after the transcript is complete.

## Metadata

| Field | Value |
|---|---|
| Date, Eastern Time | |
| Operator | |
| VPS hostname | |
| Repo commit | |
| Convex backend image tag | |
| Convex dashboard image tag | |
| Convex CLI pin | 1.17.4 |
| Rehearsal instance secret generated fresh | [ ] yes |
| Hosted export path | |
| SDK schema SHA256 | |

## Step 1.a - Stand Up Rehearsal Stack

**Command run:**

```bash
export CONVEX_REHEARSAL_INSTANCE_SECRET="$(openssl rand -hex 32)"
docker compose -f docker-compose.rehearsal.yml up -d
docker compose -f docker-compose.rehearsal.yml ps
```

**Output:**

```text

```

**Result:** [ ] PASS  [ ] FAIL

## Step 1.b - Generate Rehearsal Admin Key

The backend generates and persists its instance secret inside the rehearsal
volume. The admin key is derived from the running backend.

**Command run:**

```bash
mkdir -p agents/secrets
docker compose -f docker-compose.rehearsal.yml exec -T convex-backend \
  ./generate_admin_key.sh > agents/secrets/convex-admin.rehearsal.key
chmod 0600 agents/secrets/convex-admin.rehearsal.key
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat agents/secrets/convex-admin.rehearsal.key)"
curl -fsS http://127.0.0.1:38050/api/list_tables \
  -H "Authorization: Convex ${CONVEX_SELF_HOSTED_ADMIN_KEY}" >/tmp/rehearsal-list-tables.json
```

**Output:**

```text

```

**Result:** [ ] PASS  [ ] FAIL

## Step 1.c - Capture Hosted Export And Schema Fingerprint

**Command run:**

```bash
export CONVEX_CLI_PINNED_VERSION=1.17.4
export HOSTED_EXPORT="agents/backups/convex-hosted-rehearsal-$(date -u +%Y%m%dT%H%M%SZ).zip"
mkdir -p agents/backups
npx -y "convex@${CONVEX_CLI_PINNED_VERSION}" export --path "$HOSTED_EXPORT" --include-file-storage
sha256sum packages/sdk/convex/schema.ts > /tmp/clanworld-sdk-schema.sha256
```

**Export size and SDK schema fingerprint:**

```text

```

**Result:** [ ] PASS  [ ] FAIL

## Step 1.d - Deploy Schema To Rehearsal

**Command run:**

```bash
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:38050
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat agents/secrets/convex-admin.rehearsal.key)"
npx -y "convex@${CONVEX_CLI_PINNED_VERSION}" deploy --yes
```

**Deploy output:**

```text

```

**Result:** [ ] PASS  [ ] FAIL

## Step 1.e - Import Hosted Data Into Rehearsal

**Command run:**

```bash
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:38050
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat agents/secrets/convex-admin.rehearsal.key)"
npx -y "convex@${CONVEX_CLI_PINNED_VERSION}" import --replace-all --yes "$HOSTED_EXPORT"
```

**Import output:**

```text

```

**Result:** [ ] PASS  [ ] FAIL

## Step 1.f - Rehearsal Teardown

**Command run:**

```bash
docker compose -f docker-compose.rehearsal.yml down -v
rm -f agents/secrets/convex-admin.rehearsal.key
```

**Output:**

```text

```

**Result:** [ ] PASS  [ ] FAIL

## Issues Encountered

| Step | Issue | Resolution |
|---|---|---|
| | | |

## Sign-Off

I have executed the rehearsal pass. The rehearsal backend accepted the hosted
export, the SDK schema fingerprint was recorded, and the isolated rehearsal
volume was destroyed.

| Field | Value |
|---|---|
| Signed by | |
| Date, Eastern Time | |
| Next action | Schedule production cutover with Liam |
