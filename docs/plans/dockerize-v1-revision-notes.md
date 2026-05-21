# dockerize-v1 plan revision notes

**Date:** 2026-05-16
**Input:** `docs/research/dockerize-v1-DA-codex.md` (codex DA verdict NEEDS_REWRITE; 48 findings).
**Scope:** ALL 18 HIGH findings addressed in-place. Secondary MED/LOW handled surgically where adjacent. Ambient MED/LOW deferred to follow-up issues.

## HIGH findings addressed (18)

3, 4, 6, 9, 10, 11, 12, 19, 20, 22, 24, 28, 29, 33, 37, 38, 39, 44 — all answered in-plan.

Key structural fixes:
- **#3+#37 (cutover order):** Locked decision #1 rewritten + Phase 2 fully restructured into 8 steps. Legacy systemd stays running through internal smoke + Caddy add + 30-min coexist window. Legacy disabled ONLY after explicit `make smoke-test` validation gate. Step 8a rollback for every failure-point.
- **#6+#19+#20+#22+#23 (command-bus):** Phase 1.8 adds `unfreeze` verb, explicit FSM (`queued→leased→delivered→completed/failed`), per-kind completion deadlines, `sweepStaleDelivered()` cron, `BUS_OPERATOR_SECRET`/`BUS_ELDER_SECRET_<id>` auth model, retention rules that preserve incomplete commands.
- **#24 (runner-vs-tmux):** Phase 1.6 redesigned — supervisor runs INSIDE elder container as sibling process to tmux+ttyd under tini. Drops the broken cross-container `tmux send-keys` design. Phase 1.9 and Appendix B updated. Pause/unpause via `kill -STOP`/`-CONT` on supervisor PID.
- **#9+#28+#29 (heartbeat):** Explicit `CHAIN_NETWORK=dev|prod` env (fail-fast if unset), no cross-env fallback. Chain-ID assertion at startup. `preflight-single-caller.sh` aborts if legacy heartbeat detected. Webhook payload aligned to AGENTS.md (`{chain, engineAddress, txHash, firedAtTs, source}`). HMAC-SHA256 with 60s replay window.
- **#10 (admin-key):** `make bootstrap-convex-admin-key` generates + persists at `/etc/clan-world/secrets/convex-admin.key`, mounted as Docker secret (not env var). Rotation deferred to #356.
- **#11 (schema migration):** Phase 1.13 pins CLI + backend + dashboard versions, requires schema-fingerprint check before import, requires recorded rehearsal transcript.
- **#12+#13 (ttyd WS):** Phase 1.5 ships canonical Caddyfile with `@ws_elder` matcher, `handle_path /elder-N/*` for prefix-strip, `transport http { versions h1 }` for ttyd HTTP/1.1, idle 1h, write 0. WS smoke via websocat AND Playwright.
- **#33 (PROFILE):** Makefile requires `PROFILE=dev|prod` explicit, no default. Confirmation banner shows profile + RPC + chain ID + contract before any container starts.
- **#39+#41 (smoke):** Per-elder Claude-auth smoke + per-elder game-loop proof (valid order accepted by chain/backend within 2 min OR explicit no-op decision with reasoning).
- **#44 (OAuth):** `make oauth-bootstrap` + `oauth-bootstrap-elder-N` moved from risk-text into Phase 1.12 committed scope + acceptance.

## Secondary findings handled in-place

1, 5, 7, 14, 15, 16, 17, 18, 25, 26, 27, 30, 31, 32, 34, 35, 40, 42, 43, 45, 46, 47, 48 — all addressed with terse adjacent edits. See revised plan sections matching each finding's location.

## Deferred to follow-up issues

- #356 — admin-key rotation automation
- #357 — Android updates (if mobile workspace archived)
- #358 — anvil-fork state-hash in `make status` (Finding 8)
- #359 — bandwidth measurement parity hosted vs self-hosted (Finding 2)

## Section growth (top 6)

Phase 2: 67→212 (+145). Phase 1.5: 23→108 (+85). Appendix B: 16→96 (+80). Phase 1.8: 41→93 (+52). Phase 1.10: 22→62 (+40). Phase 1.12: 25→63 (+38).

Plan total: 840 → 1497 lines (+657). Recommend re-DA before dispatch.
