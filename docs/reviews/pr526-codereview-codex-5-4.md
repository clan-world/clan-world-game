# Phase Super-Swarm Review — PR #526 (head ba8d426)

## SUMMARY

NEEDS_FIXES. The self-hosted Convex topology is mostly headed the right way, and the `convex-backend:3211` webhook contract lines up with the heartbeat side. But the bootstrap and migration paths still have a few merge-blocking footguns: admin-key bootstrap can succeed with a bad/empty key, the documented dev happy path does not actually bring up the loopback port the deploy step needs, and hosted import drops file storage.

## HIGH severity findings

- `Makefile:31-37` — `bootstrap-convex-admin-key` can write a bad key file and still exit green. The backslash-continued recipe is chained with `;`, not `&&`, so a failing `docker compose ... ./generate_admin_key.sh` does not stop the later `install`, `sha256sum`, and success prints. That can leave a zero-byte or partial `agents/secrets/convex-admin.key`, after which `make deploy-convex` fails later with a misleading auth error. Use `&&` or `set -e -o pipefail` inside the block, and assert `[[ -s "$$tmp" ]]` before installing it.

- `Makefile:23` + `bin/deploy-convex.sh:20` + `docs/runbooks/self-hosted-convex.md:9-23` — the documented dev bootstrap path does not start the loopback proxy that deploy depends on. `make bootstrap-convex-admin-key PROFILE=dev` only starts `convex-backend`, but `make deploy-convex` defaults `CONVEX_SELF_HOSTED_URL` to `http://127.0.0.1:3210`, which only exists if `convex-backend-dev-port` is up. As written, step 1 then step 3 in the runbook can fail on a fresh dev bring-up. Either start `convex-backend-dev-port` from the bootstrap target, or make the runbook require a broader `docker compose --profile dev up -d` first.

- `bin/import-convex-schema.sh:73-86` — hosted export/import is not round-tripping file storage. `backup-convex.sh` exports with `--include-file-storage`, but the hosted-export branch here uses plain `convex_cli export --path "$export_zip"` and then does `import --replace-all`. If hosted Convex contains file storage, this restore path drops it while replacing everything else. Add `--include-file-storage` here too, and ideally force an explicit acknowledgement when reusing a prebuilt zip that may not contain files.

## MEDIUM severity findings

- `apps/server/package.json:8-10` + `packages/sdk/package.json:20-24` + `bin/deploy-convex.sh:46-49` — Convex codegen/deploy is version-skewed. Runtime deps still pin `convex` `1.17.4`, while the new self-hosted commands invoke `convex@1.39.1`; on top of that, deploy still runs `pnpm --filter @clan-world/sdk codegen`, which uses the old local binary instead of the new pinned `convex:codegen` script. That gives the repo two different generators against the same schema. Pick one version and use it consistently in both workspace deps and both codegen steps.

- `bin/backup-convex.sh:42-45` — backups are created with default permissions. These zips can contain the full Convex dataset and file storage, but `mkdir -p agents/backups` and the export leave access at the process umask, typically world-readable on a shared host. Create the directory `0700` and chmod the archive `0600` after export.

- `docker-compose.yml:97-98,122` + `.env.template:221-228` — prod defaults still silently advertise dev/local URLs. If `CHAIN_NETWORK=prod` and those vars are not overridden, the backend/dashboard fall back to docker-internal or localhost origins that browser clients cannot resolve. This should fail loud for prod instead of booting with unusable origins.

## LOW severity findings

- `docs/runbooks/self-hosted-convex.md:48-54` — the post-deploy env block uses bare `convex env set ...`, not the pinned CLI path this PR is trying to enforce. That makes operator behavior depend on whatever is already installed on the host.

- `Makefile:6-15` + `docs/runbooks/self-hosted-convex.md:94-96` — there is no `make check-stack-health` target even though the other Convex ops are wrapped and the runbook points operators at a health script.

## Cross-cutting observations

The direction is good: keeping Convex internal and using loopback-only socat shims for dev is the right exposure model, and the heartbeat webhook target is wired correctly for sibling PR #525. The main risk cluster is operational drift: bootstrap, codegen, deploy, and restore are each individually close, but they are not yet one reliable, documented end-to-end path.