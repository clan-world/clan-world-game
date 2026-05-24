# Phase Super-Swarm Review — PR #526 (head ba8d426)

## SUMMARY

NEEDS_FIXES. Bootstrap flow, destructive-op gating, socat dev-only proxy pattern, and webhook URL contract are all well-designed. But one HIGH-impact issue around dashboard liveness signaling and four MEDIUM issues around backup/restore consistency, CLI version pinning drift, and Makefile target hardcoding need addressing before merge.

## HIGH severity findings

- **H1 — convex-dashboard service has no healthcheck defined; socat proxy depends on `service_healthy`.** The `convex-dashboard:` service block in `docker-compose.yml` has no `healthcheck:` configured, but the dependent `convex-dashboard-proxy` socat service uses `depends_on: convex-dashboard: condition: service_healthy`. Without an explicit healthcheck OR a built-in `HEALTHCHECK` directive in the upstream `ghcr.io/get-convex/convex-dashboard:latest` image, the dashboard never reports healthy → socat proxy never starts → port 6791 is never exposed → operators cannot reach the dashboard. Fix: add an explicit `healthcheck:` block to the dashboard service (HTTP GET on port 6791 or a process check), OR verify the upstream image ships a `HEALTHCHECK` directive AND document the dependency.

## MEDIUM severity findings

- **M1:** `import-convex-schema.sh` hosted export omits `--include-file-storage`, while `backup-convex.sh` includes it. Restoring from a backup loses file-storage data silently. Match the backup script's flag.
- **M2:** `generate_admin_key.sh` path used inside the backend image is unverified — if the upstream backend image rename/move that script, bootstrap silently breaks. `:latest` tag compounds the fragility. Pin the convex-backend image to a specific digest or version tag and verify the script path.
- **M3:** Deploy script mixes workspace `convex@1.17.4` and `npx convex@1.39.1` for codegen vs deploy. Risks generated-types drift between local dev iteration (using workspace binary) and CI/deploy (using pinned npx binary). Either pin both to 1.39.1 via workspace dep upgrade, or pin both to 1.17.4 via npx.
- **M4:** `reset-anvil` Makefile target hardcodes `--profile dev` instead of using `$(PROFILE)`. Inconsistent with other targets and confusing if operator overrides PROFILE.

## LOW severity findings

- Shell duplication across `bin/deploy-convex.sh` and `bin/backup-convex.sh` (could share a sourced lib).
- Missing healthcheck for heartbeat (covered separately by PR #525) and anvil-fork (only matters if a service depends on it later).
- No backup rotation in `backup-convex.sh` — repeated runs accumulate. Defer-OK for now.
- `.sha256` fingerprint emitted by `bootstrap-convex-admin-key` is not mentioned in the runbook. Document or remove.

## Cross-cutting observations

- **Bootstrap flow** is well-designed: backend generates admin key on first up, bootstrap target reads it back to `agents/secrets/convex-admin.key` 0600. Solves the chicken-and-egg cleanly.
- **Destructive-op gating** (`FRESH_SELF_HOSTED=1` or `CONFIRM_REPLACE_ALL=1` required for `import-convex-schema`) is the right safety posture.
- **socat:1.7.4.4 loopback proxy** is the right pattern for dev-only dashboard exposure without binding the dashboard container directly to 0.0.0.0.
- **Webhook URL contract** with sibling PR #525 (`CONVEX_WEBHOOK_URL=http://convex-backend:3211`) is well-coordinated.

---
*Note: this review was produced by the model but the model's Write tool was permission-denied repeatedly; orchestrator reformatted the output from the log file.*
