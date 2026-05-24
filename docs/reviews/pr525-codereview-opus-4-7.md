# Phase Super-Swarm Review — PR #525 (head 44f72e4)

## SUMMARY

**Verdict: NEEDS_FIXES (minor)** — no HIGH severity findings, but a small handful of MEDIUM items around least-privilege (`env_file: [.env]` leaks unrelated secrets into the heartbeat container, container runs as root), PID-1 signal-handling robustness, and a healthcheck threshold that is implicitly coupled to a 60s on-chain interval. The architecture (container = existing TS scheduler, preserve all behavior, atomic /tmp success file for healthcheck) is sound and minimal. Recommend addressing MED-1 / MED-2 before merge to `dev-containerize-services`; the rest are defer-OK with follow-up issues.

## HIGH severity findings

CLEAN — no findings.

## MEDIUM severity findings

### MED-1 — `env_file: [.env]` leaks all root secrets into the heartbeat container (least-privilege violation)
**docker-compose.yml:173**

The new `env_file: [.env]` on the heartbeat service loads the *entire* root `.env` into the container's process environment. Per `.env.template`, that file contains `DEPLOYER_PRIVATE_KEY`, `JUPITER_API_KEY`, `ELDER_*_ANTHROPIC_API_KEY`, `ELDER_*_CLAUDE_CODE_OAUTH_TOKEN`, plus any Solana/treasury keys — none of which the heartbeat process needs. The pre-PR pattern (explicit `environment:` block only) was tighter. The heartbeat wallet should be the *only* private key visible to this container.

**Suggested fix:** Drop `env_file: [.env]` and instead add the variables the heartbeat actually needs (`RUNNER_PRIVATE_KEY`, `INDEXER_SECRET`, `CONVEX_URL`, etc.) to the explicit `environment:` block, using `${RUNNER_PRIVATE_KEY:?required}` so compose fails loudly if missing. This restores the per-service allowlist that PR #523-era cleanup established.

### MED-2 — Container runs as root (no `USER` directive)
**agents/heartbeat/Dockerfile:1-39**

`node:22-alpine` defaults to `USER root`. The heartbeat process holds `RUNNER_PRIVATE_KEY` and a Convex-side `INDEXER_SECRET`; running as UID 0 inside the container is unnecessary and expands the blast radius of any RCE in tsx / pnpm / a transitive dep. The image already includes the `node` user (UID 1000) from the upstream base.

**Suggested fix:** After the `COPY . .` + `touch .env.local` + `chmod +x` lines, add:
```
RUN chown -R node:node /app
USER node
```
Verify `/tmp` remains writable (it is — alpine `/tmp` is 1777). The Convex secret file `/run/secrets/webhook-shared` should also be readable by `node`; Compose mounts secrets 0444 by default, so this should work without further change.

### MED-3 — PID 1 signal handling: exec'd pnpm becomes init, no `tini`/`dumb-init`/`init: true`
**agents/heartbeat/Dockerfile:39; docker-compose.yml:169-207**

`ENTRYPOINT ["./agents/heartbeat/entrypoint.sh"]` + `exec pnpm --filter ... heartbeat` makes `pnpm` PID 1. PID 1 in Linux ignores SIGTERM unless explicitly handled, and signal forwarding through `pnpm → tsx → node` is brittle (especially across pnpm versions). `heartbeatLoopMain.ts` registers SIGTERM/SIGINT handlers that drive `AbortController` shutdown — but they only fire if the signal actually arrives at the Node process. If shutdown stalls, compose `SIGKILL`s after the grace period mid-tx-receipt-wait, which is exactly the case the scheduler's clean shutdown path was designed to avoid.

**Suggested fix:** Either add `init: true` to the compose service (lightweight — uses docker's bundled tini), or install `tini` in the Dockerfile and `ENTRYPOINT ["/sbin/tini", "--", "./agents/heartbeat/entrypoint.sh"]`. Prefer `init: true` for symmetry with how the elder containers are described (line 211 comment already mentions tini).

### MED-4 — Healthcheck threshold (120s) is implicitly coupled to a 60s on-chain interval; will false-positive if interval is widened
**docker-compose.yml:200; agents/heartbeat/README.md:60-64**

The healthcheck rejects any timestamp older than 120s, which works while the on-chain `heartbeatIntervalSeconds()` stays at 60s. If an operator widens the interval (the README and scheduler explicitly support this as an "operational" cadence change with no code modification), the container will be marked unhealthy on every cycle even though the heartbeat is firing on schedule. Worse: on a fresh boot, if a heartbeat fired moments before container start, the scheduler will wait until the next on-chain slot — which can exceed 120s after `start_period: 60s` ends, leading to a flapping `unhealthy` state right after a clean restart.

**Suggested fix:** Either (a) derive the threshold from `heartbeatIntervalSeconds()` at container start and write it to a sidecar file the healthcheck reads, or (b) write the *expected next heartbeat ts* into `/tmp/last-heartbeat-success` instead of the wall-clock success ts and have the healthcheck assert `now < expected_next + grace`. Simpler short-term: bump the healthcheck threshold to `max(2 * interval, 120s)` via an env var (`HEARTBEAT_HEALTH_THRESHOLD_S`) and document the coupling clearly in the README.

### MED-5 — No tests for `writeHeartbeatSuccessFile()` atomic-rename behavior
**packages/runner/src/runnerCastHeartbeat.ts:261-269; packages/runner/test/runnerCastHeartbeat.test.ts**

The success-file writer is the *only* signal feeding the compose healthcheck — it's load-bearing for ops, but `packages/runner/test/runnerCastHeartbeat.test.ts` contains zero references to `last-heartbeat-success`, `writeHeartbeatSuccess`, or `HEARTBEAT_SUCCESS_FILE`. The function silently swallows errors via `console.warn`, so any regression (e.g., someone refactors the path, the temp+rename ordering, the EPERM-on-/tmp case) lands with no test coverage.

**Suggested fix:** Add a small vitest spec that (1) verifies the file is created with the success path after a successful `callHeartbeat()`, (2) verifies the temp file is named with the pid, (3) verifies the rename is atomic (final file exists with expected content), (4) verifies the writer swallows EACCES without crashing the scheduler. Use `tmpdir()` + monkey-patch the constant if needed.

## LOW severity findings

### LOW-1 — Fragile `COPY package.json` allowlist will break frozen-lockfile install when a workspace package is added
**agents/heartbeat/Dockerfile:14-27**

Each workspace package is hand-copied. The next person who adds an `apps/foo` or `packages/foo` will hit a `frozen-lockfile` failure with no obvious pointer to this file. Consider switching to `COPY --parents */*/package.json ./` (BuildKit) or `pnpm fetch --filter @clan-world/runner...` + `pnpm install --offline --frozen-lockfile`. Defer-OK; the comment in the README is good but the failure mode is opaque.

### LOW-2 — Webhook secret file: `cat` strips only *trailing* newlines; internal whitespace and CRLF pass through
**agents/heartbeat/entrypoint.sh:43**

`WEBHOOK_SHARED_SECRET="$(cat "$WEBHOOK_SHARED_SECRET_FILE")"` — POSIX command substitution strips the *last* `\n` only. A secret file with CRLF endings, a leading newline, or embedded whitespace will silently produce a Bearer token that won't match server-side. Operator-side concern, but cheap to guard: `WEBHOOK_SHARED_SECRET="$(tr -d '\r\n[:space:]' < "$WEBHOOK_SHARED_SECRET_FILE")"` (or at least warn if length-after-trim ≠ length-before-trim).

### LOW-3 — `pnpm install --frozen-lockfile` installs ALL workspace deps for a single-package container
**agents/heartbeat/Dockerfile:29**

`@clan-world/runner` is the only thing this image runs, but the install layer pulls deps for `apps/web`, `apps/dev-ui`, `apps/landing`, `apps/mobile`, etc. Image is heavier than needed, build is slower, and the surface area of transitive deps in the image is larger than the runtime requires. Switch to `pnpm install --frozen-lockfile --filter @clan-world/runner...` or use `pnpm deploy --filter @clan-world/runner --legacy /out` and copy the deploy output. Defer-OK; image-size optimization is a Phase-1.10 follow-up at best.

### LOW-4 — `apk add` does not pin versions; rebuild reproducibility risk
**agents/heartbeat/Dockerfile:5**

`ca-certificates libgcc libstdc++` are pulled at floating versions. For a security-sensitive container holding a private key, deterministic builds matter. Add explicit version pins or commit to a base image digest. Defer-OK — alpine `apk` is reasonably stable, and the cast self-test catches the most common breakage shape.

### LOW-5 — README claim about "Plain Docker Compose does not restart … because it is unhealthy" — consider linking the external ops tooling
**agents/heartbeat/README.md:64-67**

The README accurately notes the healthcheck-vs-restart gap, but doesn't tell the operator *what* to wire up. A pointer to the Convex/dev UI status view (or whatever monitor is canonical) would close the loop. Defer-OK / doc-only.

### LOW-6 — `set -eu` without `pipefail` — fine on busybox `ash`, but worth a comment for the next editor
**agents/heartbeat/entrypoint.sh:2**

Alpine `sh` is busybox `ash`, which doesn't support `set -o pipefail`. The script doesn't pipe, so this is fine *today*. A future editor who adds `cmd1 | cmd2` will silently lose error-propagation. One-line comment or `if command -v bash >/dev/null; then set -o pipefail; fi` (no-op on ash) would future-proof. Defer-OK / nit.

### LOW-7 — `RUN cast --version` lives BEFORE `WORKDIR /app`
**agents/heartbeat/Dockerfile:9-12**

Purely cosmetic — the self-test would be more discoverable grouped with `WORKDIR` + initial COPY. Defer / nit.

## Cross-cutting observations

1. **Atomic temp+rename in `writeHeartbeatSuccessFile()` is correct.** `${HEARTBEAT_SUCCESS_FILE}.${process.pid}.tmp` namespaces the temp by pid (only matters if the scheduler ever forks; today it doesn't), and POSIX `rename` is atomic on the same filesystem. Good defensive code.

2. **Pre-flight chain-id assertion is the right gate.** Catches the most common ops error (wrong RPC URL pointed at a different chain) before tsx starts. The dev/prod URL selection is clean. The prod-rejection list (`*anvil-fork*|*localhost*|*127.0.0.1*`) won't catch every misconfiguration (e.g., a private LAN RPC at `192.168.1.X`), but the principle is right and the chain-id check covers the residual.

3. **`RPC_URL_PRIMARY` export-rename in the entrypoint preserves the existing runner code path.** A genuinely clean way to keep the architectural promise of "container IS the existing TS scheduler" without touching `configFromEnv()`.

4. **The architectural choice — preserve runnerStatus writes, exp backoff, Telegram alerts, on-chain interval — matches the post-#503 SettleLatch lesson** about *not* drifting from approved behavior under cover of a containerization PR. This PR resists that temptation cleanly. (cf. `feedback_settle_latch_architectural_mistake_2026_05_21.md`.)

5. **Bundle interaction with PR #523:** This PR depends on the SettleLatch removal landing first, which it does. The `restart: on-failure:5` change (from `:0`) is the operationally-correct softening — but the README footnote about plain compose not restarting on unhealthy is the loose end. If an operator depends on `restart` for liveness, they will be disappointed; a `compose --watch`-style external monitor or the Convex-side liveness assertion is the real safety net.

6. **Missing test coverage on the integration seam:** No test exercises "entrypoint validates env → runner writes success file → healthcheck reads it." A smoke test (`docker compose --profile dev up heartbeat`, wait 90s, `docker inspect --format '{{.State.Health.Status}}'`) would close this. The README mentions a `docker build` smoke test but not a `compose up` health-status smoke. Worth filing a follow-up issue.

7. **Single-caller guard genuinely deferred, not silently dropped.** The README acknowledges it and points at Convex-side liveness as the residual mechanism. Matches Liam's Option C directive scope.
EXIT=0
