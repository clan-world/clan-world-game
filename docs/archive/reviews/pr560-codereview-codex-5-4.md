# Phase Super-Swarm Review — PR #560 (head 09f78c8) — Codex GPT-5

## SUMMARY
NEEDS_FIXES. The containerization direction is coherent, but the combined release still has two shipping blockers on the core “elders running in containers via Convex command bus” path: the command-bus auth secrets are never made visible to Convex, and the documented operator/bootstrap surface for the elder stack is not actually present in the repo. I would not merge to `main` until those are fixed; otherwise the stack can come up partially healthy while the new control plane is dead.

## HIGH severity findings
- `apps/server/convex/commandBus.ts:7-18`, `docker-compose.yml:91-103`, `docs/runbooks/self-hosted-convex.md:43-56`  
  The command bus now authenticates every operator/elder call against `process.env.BUS_OPERATOR_SECRET` / `BUS_ELDER_SECRET_<n>`, but the self-hosted Convex backend service never receives those env vars, and the runbook never sets them as deployment env either. In the combined state, `enqueueCommand`, `claimNext`, `ackCommand`, `completeCommand`, `failCommand`, and even the elder heartbeat mutation all fail closed with `Unauthorized`, which means Bundle 2’s supervisor can never actually talk to Bundle 1’s schema in production. Suggested fix: explicitly plumb the bus secrets into the Convex runtime seen by `commandBus.ts` (or change `commandBus.ts` to read from the supported self-hosted Convex env mechanism), and add that bootstrap step to the runbook.

- `agents/README.md:3-12`, `agents/README.md:41-48`, `Makefile:1-58`, `.env.template:268-287`, `docker-compose.yml:49-64`  
  The repo claims the elder fleet is operated through an `agents/Makefile` with `make up`, `make status`, `make logs`, `make reset-elder-*`, `make wipe-elder-*`, plus `bootstrap-bus-secrets`/OAuth bootstrap, but the only committed Makefile is the repo-root one and it only contains Convex admin/deploy/backup helpers. That leaves no repo-native way to generate the required secret files referenced by Compose, no `make up` path for the elder containers, and no implementation of the operator workflow the docs point people to. For a release whose headline is “full elder-agent dockerization migration,” this is a bring-up blocker, not just a docs gap. Suggested fix: land the actual operator Makefile/scripts (or remove the claims and replace them with the real supported commands before merge).

## MEDIUM severity findings
- `agents/shared/run.sh:22-25`, `agents/shared/run.sh:110-127`, `agents/README.md:45-46`  
  The elder session continuity path still relies on a best-effort project-path encoding heuristic plus `claude --continue`. The script itself documents that this can silently fail if Claude Code’s path encoding drifts, in which case the elder simply starts a fresh conversation. In this phase that is operationally significant: restart/wipe/reset are now first-class container workflows, so “conversation continuity” is part of the product surface, not a nice-to-have. Suggested fix: persist an explicit session id and resume with `claude --resume <id>`; at minimum, fail loud when prior state exists but resume cannot be proven.

## LOW severity findings
- `agents/shared/run.sh:47-52`, `agents/elder-1/.env.template:23-26`, `packages/elder-runtime/src/config.ts:24-31`  
  The elder docs/config still tell operators to populate `BUS_ELDER_SECRET` in `elder-N/.env`, and `run.sh` warns that bus participation is disabled when that env var is absent, but the actual supervisor now reads the bus secret from `BUS_ELDER_SECRET_FILE` / `/run/secrets/...`. In the shipped compose wiring, that warning is misleading noise and the documented env var is unused by the runtime path that matters. Suggested fix: align docs/warnings/templates with the secret-file model and remove the stale env-var guidance.

## Cross-cutting observations
- The biggest phase-level issue is not inside an individual bundle; it is the seam between them. Bundle 2’s runtime and Bundle 1’s schema look correct in isolation, but the release still lacks the glue that makes the auth/bootstrap story real.
- Test coverage is still mostly unit-level at the edges (`apps/server/convex/commandBus.test.ts` mocks the DB; `packages/elder-runtime/test/userMessage.test.ts` mocks tmux + bus). I did not find an integration test that exercises the load-bearing chain `claimNext -> ack/fail/complete -> tmux dispatch -> nonce detection`, which is the highest-risk seam in this release.
- There is still some architectural drift between the documented plan and the shipped implementation on operator UX: the docs describe a fuller phase-1 operator surface than the repo actually provides. That mismatch will turn first-deploy failures into confusing “healthy-but-nonfunctional” states.
