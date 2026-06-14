# Phase Super-Swarm Synthesis — PR #532 (head 1ed8d60)

**Models run:** Codex 5.3 ✓ | Codex 5.4 ✓ | Codex 5.5 ✓ | Opus 4.6 ✓ | Opus 4.7 ✓ | Gemini 3.1 Pro ✓
**Phase:** Bundle 1 dockerize release — `dev-containerize-services` → `dev`
**Diff size:** 2,770 lines (gh pr diff 532 | wc -l); +1,380 / -378 across 30 files
**CI:** all 5 checks green; `mergeStateStatus: CLEAN`

## Summary

**Verdict: NEEDS_FIXES (small, 2 MUST / 3 SHOULD)** before Liam's morning merge of `dev-containerize-services → dev`.

The phase is structurally coherent: self-hosted Convex backend + dashboard, dev-only loopback socat proxies, a containerized heartbeat with proper preflight + bearer-auth webhook, secret-file mounting, prod fail-loud guards on browser origins, and clean bootstrap / deploy / backup / import / health-check make targets. Six reviewers produced 1 cross-model HIGH (image `:latest` defaults), 1 single-model HIGH (Opus 4.7 prefix-match bash glob), 5 plausible MEDIUMs, and several LOWs.

**The dominant cross-model finding — five of six reviewers flagging SettleLatch removal as a HIGH timing regression — is a FALSE POSITIVE.** SettleLatch (Cycle A waits for Cycle B) was an UNAPPROVED architectural change that PR #523 yanked precisely because Liam never approved that coordination model. Opus 4.7 is the only reviewer with that context and is correct that the removal is intentional. The 5 dissenting reviewers all reason from the deleted code as if the latch were a load-bearing safety, when in fact removing it restored the architecturally-correct independent Cycle A heartbeat driver. Memory: `feedback_settle_latch_architectural_mistake_2026_05_21.md`, `feedback_settle_latch_overcorrection_2026_05_21.md`.

**Recommend Liam-merge after the 2 MUST fixes land** (both are ≤10-line patches and do not touch the SettleLatch question). The 3 SHOULDs and DEFERs are safe to file as follow-up issues.

## MUST FIX

| File:line | Models | Severity | Finding | Suggested fix |
|---|---|---|---|---|
| `bin/deploy-convex.sh:34-37` (`is_local_origin`) | Opus 4.7 (H1) | HIGH (verified) | Glob `[[ "$value" == http://convex-backend* ]]` rejects `http://convex-backend-prod.example.com` (false-positive blocks legitimate prod URLs whose host starts with `convex-backend`) AND accepts `http://[::1]/`, `http://[::ffff:127.0.0.1]/`, `http://0.0.0.0/` as prod-routable (false-negative slips IPv6 loopback past `require_prod_origins`). Verified at HEAD. | Tighten case-glob to require port or path terminator after the host token; add explicit cases for `[::1]`, `0.0.0.0`. ≤10-line patch. |
| `docker-compose.yml:87,113` + `.env.template:215-216` (Convex image `:latest` defaults) | Codex 5.3 (MED), Codex 5.5 (HIGH), Gemini (LOW), Opus 4.7 (MED) — **4 of 6 models** | HIGH (cross-model) | `CONVEX_BACKEND_TAG=latest` and `CONVEX_DASHBOARD_TAG=latest` are the shipped `.env.template` defaults. Self-hosted Convex is the source of truth for game state; an unaudited upstream rebuild can land on next `compose up` with zero audit trail. Codex 5.5 escalates to HIGH because this is a prod path. | Pin both defaults to a tested digest in `.env.template`; either fail-loud in compose when `CHAIN_NETWORK=prod` and tag is `latest`, OR ship a pinned digest comment + docs entry. Add the same pin for `node:22-alpine` in `agents/heartbeat/Dockerfile`. |

## SHOULD FIX

| File:line | Models | Severity | Finding | Reason |
|---|---|---|---|---|
| `docker-compose.yml:228` heartbeat env block | Gemini (H2) | MED | `RUNNER_PRIVATE_KEY` and `INDEXER_SECRET` passed as plain env vars (visible in `docker inspect`), inconsistent with the rest of the file which uses Docker file-secrets for the webhook shared secret. | Single-model finding, but verifiable and consistent with the project's own established secret-handling pattern (Finding 10 cited by Gemini). Move both behind `*_FILE` env vars + `secrets:` block. |
| `docker-compose.yml:228-238` heartbeat `depends_on` in dev profile | Opus 4.7 (M1) | MED | Heartbeat depends only on `convex-backend: service_healthy`. In dev the entrypoint runs `cast chain-id` against `anvil-fork:8545` with 30×2s retry. anvil's worst-case ready time (start_period 20s + 3×15s healthcheck ~65s) plus the new `restart: on-failure:5` can burn the retry budget on a slow VPS cold-start. | Add dev-profile-only `anvil-fork: service_healthy` dependency OR widen `RPC_RETRY_MAX` to ~60. ≤5-line change. |
| `bin/backup-convex.sh:21` (no prod-guard) | Opus 4.7 (M6) | MED | `backup-convex.sh` defaults `CONVEX_SELF_HOSTED_URL` to loopback even on a prod host (`http://127.0.0.1:${CONVEX_BACKEND_HOST_PORT:-3210}`), and unlike `deploy-convex.sh` has no `require_prod_origins` call. If an operator runs `make backup-convex` on prod without first sourcing a prod-routed URL, backup either fails noisily OR — worse — succeeds against the wrong (dev) instance if a dev-port proxy is up. | Add `is_local_origin` + prod-guard from deploy-convex.sh. Asymmetric guard surface is the failure mode. |

## DEFER (file as follow-up issues)

- **Volume mount path change `/data` → `/convex/data`** (`docker-compose.yml:104`) — Opus 4.6 (M2), Opus 4.7 (M4). Fresh-deploy correct; concern is operators upgrading from the prior #347 scaffold whose `convex_data` volume contains data at the old path. File runbook note + first-deploy assertion in `check-stack-health`. Not blocking — this PR is Bundle 1 first-deploy, no upgrade-in-place scenario yet. (Memory: cross-model overlap only on the upgrade ergonomics question, not on the current-deploy correctness.)
- **Anvil-fork runbook references wrong Makefile path** (`docs/runbooks/anvil-fork-dev-rpc.md:95,99`) — Opus 4.6 (M3). `make -C agents reset-anvil` should be `make reset-anvil` (target is in root Makefile). Docs-only fix.
- **`HEARTBEAT_SUCCESS_FILE_OVERRIDE` env-vs-healthcheck mismatch** (`docker-compose.yml:241`) — Gemini (M1). Healthcheck hardcodes `/tmp/last-heartbeat-success`, but the code respects an env override. If operator sets the override, container goes unhealthy. Low blast — defer with a docs note that the override is not safe to use under compose.
- **Webhook auth non-constant-time string equality** (`apps/server/convex/heartbeat.ts:127`) — Opus 4.7 (M2). Bearer-token comparison via `!==`. Practical exploit cost on a high-entropy secret is high. File as follow-up; not Bundle-1-blocking.
- **`.env.template` nested `${VAR:-default}` is shell-only** (`.env.template:228,232,239`) — Opus 4.6 (M1). Docker Compose `.env` reader doesn't recurse; operators using `.env` directly get broken origins. The intended `.env.local` + Makefile flow handles this correctly. Add a comment at top of `.env.template` warning against direct `docker compose --env-file .env` usage.
- **`reset-anvil` assumes `clan-world` compose project name** (`Makefile:51-58`) — Opus 4.7 (L5). Different clone directory → wrong volume name → silent no-op delete.
- **`CONVEX_DEPLOY_URL` is dead env on heartbeat service** (`docker-compose.yml:221`) — Codex 5.5 (LOW), Opus 4.6 (L3), Opus 4.7 (L4). Three-model overlap on a cosmetic redundancy; remove or comment.
- **`EXPECTED_CHAIN_ID=84532` hardcoded in entrypoint** (`agents/heartbeat/entrypoint.sh:13-16`) — Opus 4.7 (M7). Correct today (project is Base Sepolia only per CLAUDE.md §6). Add a README note about migration.
- **README success-file semantics overstated** (`agents/heartbeat/README.md:42-46`) — Opus 4.7 (L1). Says "successful webhook POST" but the marker writes even when the webhook 4xx/5xxes (`postHeartbeatWebhook` catches all errors). Drop the misleading clause. Docs-only.
- **Stale SettleLatch prose in planning doc** (`docs/plans/dockerize-v1-revision-notes.md:65`) — Opus 4.7 (L2). One-line fix.
- **`bin/import-convex-schema.sh` doesn't `chmod 0600` pre-existing zips** — Opus 4.7 (L6). Operator-supplied; low impact.
- **`reset-anvil` Makefile target has no PROFILE guard** — Opus 4.6 (M3, second half). Runbook claim is wrong but code is fine.

## SKIP (false positive / out of scope)

- **SettleLatch removal is a HIGH timing regression** — Codex 5.3, Codex 5.4, Codex 5.5, Gemini, Opus 4.6 (5 of 6 models).
  - **Why SKIPped despite 5-model overlap:** The latch was an unapproved Cycle-A-waits-for-Cycle-B coordination that Liam never approved. PR #523 yanked it for exactly this reason. The phase-super-swarm cannot see commit history beyond the diff, so 5 reviewers reason "load-bearing safety was removed without replacement → HIGH regression" — but the architecturally-correct state is the independent heartbeat driver that this PR ships. Opus 4.7 is the only reviewer that read the change as intentional (correctly).
  - **Memory references:** `feedback_settle_latch_architectural_mistake_2026_05_21.md`, `feedback_settle_latch_overcorrection_2026_05_21.md`, `feedback_super_swarm_orchestrator_early_exit.md`.
  - **Cross-cutting observations from Codex 5.3, Codex 5.4, Gemini, Opus 4.6, Opus 4.7 all confirm** the syntactic removal is mechanically complete: no dangling refs in `packages/runner/src/`, tests are updated, deleted-file imports are gone. The only residue is one prose line in `docs/plans/dockerize-v1-revision-notes.md` (filed as DEFER).
  - **Verifying against HEAD:** `git grep -E 'SettleLatch|markSettled' packages/runner/` returns zero matches at `1ed8d60`. Tests in `packages/runner/test/heartbeatScheduler.test.ts` explicitly assert the new no-backpressure behavior (Gemini correctly notes one such test at L437; that test codifies the intended behavior, not a bug).

- **`bootstrap-convex-admin-key` references `convex-backend-dev-port` service that doesn't exist** — Codex 5.4 (HIGH).
  - **Why SKIPped:** Verifiably wrong at HEAD. The `Makefile` `bootstrap-convex-admin-key` target does `docker compose --profile "$(PROFILE)" up -d convex-backend` first (line 26), then separately `up -d convex-backend-dev-port convex-dashboard-dev-port` ONLY when `PROFILE=dev` (line 36). Both `convex-backend-dev-port` and `convex-dashboard-dev-port` ARE defined services in `docker-compose.yml:148-167`. Codex 5.4 conflated the two `up -d` calls or read stale code.

- **Heartbeat container has no write path for `/tmp/last-heartbeat-success`** — Codex 5.4 (HIGH).
  - **Why SKIPped:** Verifiably wrong at HEAD. `writeHeartbeatSuccessFile()` is exported from `runnerCastHeartbeat.ts:261` and called from TWO sites: (a) `runnerCastHeartbeat.ts:146` after `postHeartbeatWebhook()` returns in the receipt-confirmed success path, and (b) `heartbeatScheduler.ts:232` in the timeout-recovery-with-advanced-state branch. Opus 4.7 cross-cutting observation independently verified this. Codex 5.4 likely searched for the wrong symbol name or against stale tree.

- **`NEXT_PUBLIC_DEPLOYMENT_URL` is hardcoded to `http://convex-backend:3210` ignoring `CONVEX_DASHBOARD_DEPLOYMENT_URL`** — Codex 5.4 (MED).
  - **Why SKIPped:** Verifiably wrong at HEAD. `docker-compose.yml:119` reads `NEXT_PUBLIC_DEPLOYMENT_URL: ${CONVEX_DASHBOARD_DEPLOYMENT_URL:?CONVEX_DASHBOARD_DEPLOYMENT_URL required; set browser-reachable dashboard deployment URL explicitly}` (fail-loud). Codex 5.4 read a prior revision.

- **`bootstrap-convex-admin-key` starts backend before secret file exists** — Codex 5.5 (MED).
  - **Why SKIPped:** The `convex-backend` service in `docker-compose.yml:80-101` does NOT declare the (now-removed) `convex-admin-key` Docker secret. The compose service has only `webhook-shared` secret on the heartbeat service. The "inline diff still shows the admin-key secret" suspicion is Codex 5.5 hedging against its own staleness. Verified clean at HEAD.

- **`bin/check-stack-health.sh` reports HTTP 500 as GREEN** — Codex 5.5 (LOW).
  - **Why SKIPped:** Codex 5.5 also hedges this ("Confirm the submitted head contains the HTTP-code parsing version"). At HEAD, `check_exec_any_status` does classify 5xx as RED. Verified.

- **`agents/heartbeat/entrypoint.sh` doesn't trim webhook secret newlines** — Codex 5.5 (LOW).
  - **Why SKIPped:** Codex 5.5 hedges ("If the final head has the stronger version, this is clean"). At HEAD, the entrypoint reads `WEBHOOK_SHARED_SECRET_FILE`, trims trailing whitespace, and explicitly rejects embedded newlines/CR. Verified by Opus 4.7 cross-cutting observation.

- **Heartbeat health marker masks Convex ingest outage** — Codex 5.3 (MED).
  - **Why SKIPped:** This is a documented design decision (heartbeat-chain-progress vs Convex-ingest are intentionally separate signals; the README states this explicitly). Splitting markers is a reasonable feature request but not a Bundle-1 blocker. Could be filed as a DEFER follow-up.

- **load_env scripts source `.env` directly** — Codex 5.3 (LOW).
  - **Why SKIPped:** Operator-trust footgun, acceptable for the hackathon threat model. Codex 5.3 itself marked LOW + "optional follow-up".

## Cross-model overlap stats

- **Flagged by 4+ models:** Convex image `:latest` defaults (4 of 6). The single cross-model HIGH.
- **Flagged by 5 models (false-positive cluster):** SettleLatch "regression" (Codex 5.3, 5.4, 5.5, Gemini, Opus 4.6) — verified intentional architectural change; SKIPped with explicit reasoning above.
- **Flagged by 3 models:** `CONVEX_DEPLOY_URL` dead env on heartbeat service (Codex 5.5, Opus 4.6, Opus 4.7). Cosmetic LOW.
- **Flagged by 2 models:** Volume path `/data` → `/convex/data` upgrade visibility (Opus 4.6, Opus 4.7); Anvil-fork runbook Makefile path (Opus 4.6 alone, Opus 4.7 not picked up here).
- **Single-model HIGHs that were verified true:** Opus 4.7 `is_local_origin` bash glob (1 of 6). Verified against HEAD; classified MUST.
- **Single-model HIGHs verified FALSE:** Codex 5.4 dev-port service refs, Codex 5.4 success-file write path missing, Codex 5.4 dashboard URL hardcoded. All three are stale-tree reads.

**Key signal:** Cross-model overlap is necessary but NOT sufficient. The 5-model SettleLatch overlap is wrong; the single-model `is_local_origin` finding is right. Architectural-intent context (memory) and at-HEAD verification beat reviewer counting.

## Per-model verdicts

- **Codex 5.3:** NEEDS_FIXES — 1 HIGH (SettleLatch — SKIP false positive), 2 MED (heartbeat health-marker design — DEFER, Convex `:latest` defaults — MUST cross-model), 1 LOW.
- **Codex 5.4:** NEEDS_FIXES — 2 HIGH (both verifiably wrong at HEAD; SettleLatch SKIP + dev-port SKIP + success-file SKIP), 1 MED (dashboard URL — SKIP false positive). **Net: 0 real findings.** Codex 5.4 appears to have read stale tree or stale review fragments from prior rounds.
- **Codex 5.5:** NEEDS_FIXES — 2 HIGH (SettleLatch — SKIP, `:latest` defaults — MUST cross-model), 3 MED (1 dual-runner — DEFER, 2 hedged staleness — SKIP), 2 LOW (both hedged staleness — SKIP).
- **Gemini 3.1 Pro:** NEEDS_FIXES — 2 HIGH (SettleLatch — SKIP, secrets-via-env — SHOULD), 1 MED (healthcheck override mismatch — DEFER), 1 LOW.
- **Opus 4.6:** NEEDS_FIXES — 1 HIGH (SettleLatch — SKIP), 1 HIGH (secrets-via-env, overlaps Gemini — SHOULD), 1 MED (healthcheck override mismatch — DEFER), 1 MED (volume mount upgrade — DEFER), 1 MED (anvil-fork runbook — DEFER), 1 LOW.
- **Opus 4.7:** NEEDS_FIXES (small) — 1 HIGH (`is_local_origin` glob — MUST), 7 MED (heartbeat depends_on, webhook timing-safe, `:latest` defaults, volume path, rate-limit marker, backup-convex prod guard, chain-id hardcode — mix of SHOULD/DEFER), 8 LOW. Only reviewer to correctly identify SettleLatch removal as intentional.

**Reviewer quality ranking for this PR:**
1. **Opus 4.7** — only model with correct architectural-intent context; caught the real single-model HIGH; most thorough verification depth.
2. **Opus 4.6** — solid second; identified secrets-via-env cleanly; missed SettleLatch context.
3. **Gemini 3.1 Pro** — concise; secrets-via-env catch is shared with Opus 4.6.
4. **Codex 5.3** — clean reasoning, hedged correctly on hackathon scope.
5. **Codex 5.5** — three hedged-staleness findings reduce signal-to-noise.
6. **Codex 5.4** — three verifiably-wrong HIGH/MED claims at HEAD; reading stale tree.

## Merge recommendation

**For Liam:** Hold on `dev-containerize-services → dev` until the 2 MUST FIX items land (both ≤10-line patches):

1. Fix `bin/deploy-convex.sh:34-37` `is_local_origin` glob (Opus 4.7 H1).
2. Pin `CONVEX_BACKEND_TAG` and `CONVEX_DASHBOARD_TAG` defaults to digests in `.env.template`, OR add a prod `latest`-tag rejection in `deploy-convex.sh:require_prod_origins`.

The 3 SHOULDs can be addressed in a follow-up PR before the next bundle merges to `main`. The DEFER list is safe to file as GitHub follow-up issues.

**Per ADR 0018 + memory `feedback_only_orch_merges_dev.md`:** the orchestrator MAY merge `dev-containerize-services → dev` after MUST fixes land + local 3-tier swarm is clean. The `dev → main` release-train merge is Liam-only per `feedback_release_pr_merge_requires_explicit_liam_approval.md`.
