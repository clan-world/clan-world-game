# Phase Super-Swarm Review — PR #526 (head ba8d426)

## SUMMARY
NEEDS_FIXES. The self-hosted Convex bootstrap and operator tooling are close, but one high-risk data-loss path and one deploy-sequence mismatch should be fixed before merge. Security posture is mostly improved (loopback-only dev exposure, no admin key secret mount), and PR #525 webhook integration looks aligned (`CONVEX_WEBHOOK_URL=http://convex-backend:3211`). Merge after addressing the findings below.

## HIGH severity findings

- `bin/deploy-convex.sh:46` and `docs/runbooks/self-hosted-convex.md:30` — deploy runs `pnpm --filter @clan-world/sdk codegen` (workspace `convex@1.17.4`) instead of the pinned `1.39.1` path added in this PR. The brief explicitly documents asymmetric CLI handling because newer CLI needs deployment env in CI; however this script is the self-hosted operator path and should avoid silently running a different major/minor CLI than the server deploy step. This can produce incompatible/generated type drift between SDK and server on real operator deploys. Suggested fix: switch deploy sequence to `pnpm --filter @clan-world/sdk convex:codegen` and update runbook command list accordingly.

- `Makefile:17-37` (`bootstrap-convex-admin-key`) — `FORCE=1` overwrites `agents/secrets/convex-admin.key` with newly generated output from the currently running backend without verifying operator intent against backend instance identity/fingerprint. If operators accidentally point to a different stack/profile (or stale compose project) they can replace the local key artifact with another instance key, breaking dashboard/admin access expectations and risking operational lockout workflows. Suggested fix: print/compare backend instance identifier and require explicit confirmation token (or require `PROFILE` + instance fingerprint match) before overwrite; at minimum refuse `FORCE=1` unless `CONFIRM_ROTATE_CONVEX_ADMIN_KEY=1` is also set.

## MEDIUM severity findings

- `bin/import-convex-schema.sh:78-80` — destructive import guard accepts `FRESH_SELF_HOSTED=1` alone, but never verifies the target is actually fresh. A typo or stale shell export can still wipe a populated backend (`--replace-all --yes`). Suggested fix: when `FRESH_SELF_HOSTED=1`, assert emptiness first (or require a second explicit confirm gate tied to target URL).

- `bin/check-stack-health.sh:52-54` — the script always checks `convex-backend`, `convex-dashboard` regardless of profile; for `PROFILE=prod` dashboards may intentionally be unexposed/unstarted in future hardening. This turns expected prod posture into false-red noise. Suggested fix: gate dashboard checks behind an env switch (`EXPECT_CONVEX_DASHBOARD=1`) or service-exists probe.

- `docker-compose.yml:92` and `.env.template:212-213` — both Convex images default to `latest`, while comments advise SHA pinning in prod. That leaves accidental mutable-image deploy risk on operator error. Suggested fix: fail-loud in `PROFILE=prod` if tags are `latest` (entrypoint/preflight check).

## LOW severity findings

- `.dockerignore:104` + `.gitignore:203` — adding `agents/backups/` is correct, but runbook should also mention backup retention/pruning to avoid silent disk growth on long-lived hosts.

- `bin/backup-convex.sh:44` vs `bin/import-convex-schema.sh:75` — backup includes file storage; hosted export path does not specify include behavior (defaults may differ by CLI version). Worth documenting expected parity for operator clarity.

## Cross-cutting observations

- Security direction is good: admin key is no longer injected as Docker secret/env into backend, and dev exposure is loopback-bound socat sidecars.
- #525 integration seam looks coherent in this PR: heartbeat hits internal HTTP actions origin (`3211`) and backend advertises matching `CONVEX_SITE_ORIGIN`.
- Main architectural risk is operator foot-guns on destructive flows (import/force-overwrite). Adding one extra explicit confirmation layer on each destructive path would materially improve safety with minimal hackathon overhead.
