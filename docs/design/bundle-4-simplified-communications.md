# Bundle 4 — Simplified Communications Architecture

Design doc for the elder agent infrastructure refactor that follows Bundle 1 + 2 + 3 dockerize migration. Strips the over-engineered command bus and replaces it with a thin message-injection layer, hook-based liveness, kill-tmux resets, and per-elder runners co-located with each elder container.

**Status:** Locked design (2026-05-23 PM ET — superseded the 2026-05-22 draft after design conversation with Liam). Awaiting DA round 2 + sub-PR planning.

## Why this rewrite

The previous draft (2026-05-22) shipped to a DA review that surfaced 7 CRITICAL ambiguities. Most were about who owns which control surface — the runner, the supervisor, the indexer, or Convex. The 2026-05-23 design conversation collapsed those ambiguities by reframing the process layout:

- The **heartbeat container** becomes a dumb singleton — it submits the on-chain heartbeat transaction and nothing else.
- The **per-elder runner** moves inside each elder container and owns the entire elder lifecycle: tmux session management, send-keys injection, reset, recovery, healthcheck.
- The **command bus** as a distributed-queue abstraction goes away. Messages are written to a thin `pendingMessages` table, read by the per-elder runner, fire-and-forget.
- **Resets are kill-tmux + spawn-fresh-claude**, NOT `/clear`. Recovery is the same flow but with `claude --continue`.

This means three of the original DA CRITICAL findings (`/clear` detection too hand-wavy, reset path contradicts itself, pending-message loss not implementable) are simply resolved by the new shape rather than patched.

## Process model

Five processes total in production:

| Process | Cardinality | Container | Responsibility |
|---|---|---|---|
| `heartbeat` | 1 | `heartbeat` container | Submit on-chain heartbeat tx on schedule. Nothing else. |
| `elder-N runner` | 4 (one per elder) | `elder-N` container, alongside tmux | Subscribe to ticks, derive templates, send-keys into local tmux pane, manage tmux lifecycle, watch the local Claude process. |
| `tmux` | 4 (one per elder) | `elder-N` container | Hosts the elder's claude process so ttyd can attach. |
| `claude` | 4 (one per elder) | `elder-N` container, inside tmux | The actual LLM doing the agent work. |
| `ttyd` | 4 (one per elder) | `elder-N` container | Read-only web terminal exposing the tmux pane to the operator cockpit. |

Naming: what we previously called "supervisor" is now "runner". The thing previously called "runner" (the heartbeat package) is renamed "heartbeat" to match.

## Package renames

Two `packages/` package renames as part of Bundle 4:

| Before | After | Why |
|---|---|---|
| `packages/runner/` | `packages/heartbeat/` | Reflects the dumb-singleton role. Only owns heartbeat tx submission. |
| `packages/elder-runtime/` | `packages/runner/` | Reflects the new role — runner is now the per-elder process. |

Codex handles the rename across the monorepo as part of the Bundle 4 PR (tsconfig paths, pnpm workspaces, Docker `COPY` targets, import paths in `apps/server/convex/`, etc.).

## Runner lifecycle

### Startup (per elder container boot)

1. **Read game settings** from Convex once. Cache in memory. Settings include: heartbeat interval, ticks-between-memory-resets, winter timing, season length, current diamond address, etc.
2. **Check one-claude-per-container invariant**. `pgrep claude` should return exactly zero (cold boot) or exactly one (warm restart, runner restarted but elder process survived). If we find multiple claudes, fail loud + exit non-zero. Do not pgrep+pkill — discovery beats silent recovery for R&D.
3. **Check tmux session state**. Three possibilities:
   - No session exists → fresh launch path.
   - Session exists, claude alive → warm restart, continue normal flow.
   - Session exists, no claude → recovery path: respawn claude inside the existing tmux session.
4. **Look up last-received tick** from Convex (see "Two-phase commit" below). Compare to current tick.
5. **Subscribe to tick updates**. Begin normal tick-handling loop.

### Normal tick handling (per tick)

1. Wake on new tick number from Convex subscription.
2. Query Convex for current world state (tickClock + game settings drift check + auxiliary tables as needed for event-driven templates).
3. **Drift check**: re-fetch game settings as part of the per-tick read. If any cached value diverges, panic + exit non-zero. Operator must restart all elder containers to pick up new settings.
4. **Template selection** — compute which templates apply to this tick:
   - **Pure-tick-math templates** (computed locally): `00_game_start.md`, `05_pre_memory_wipe_5ticks.md`, `06_pre_memory_wipe_1tick.md`, `07_post_memory_wipe.md`, `10_pre_winter_10ticks.md`, `11_winter_started.md`, `12_winter_ended.md`.
   - **Event-driven templates** (require auxiliary query): `20_bandits_appeared.md`, `21_bandits_attacking.md`, `22_post_bandit_attack.md`. Runner queries `banditView` + `chainEvents` to detect events on this tick.
5. **Compose message**: base line `tick: <N>` + each applicable template body wrapped in `<world_update name="<template-name>">...</world_update>` XML, concatenated in alphabetical order by template filename (numbered prefix = priority knob).
6. **Two-phase commit**:
   - Write `sent` row to Convex: `{elderId, tickNumber, sentAt, messageHash}`.
   - Run `tmux load-buffer` + `tmux paste-buffer` + `tmux send-keys Enter`.
7. The `UserPromptSubmit` hook fires when Claude actually receives the message; it writes `received` row to Convex: `{elderId, tickNumber, receivedAt}`.
8. Loop.

### Restart behavior (runner crash → docker compose restart)

After `Startup` steps 1-3:

1. Look up the highest `tickNumber` with a `received` record for this elder.
2. Look up `current_tick` from Convex `tickClock`.
3. Branch:
   - **a) `current_tick == last_received`** → no-op. Don't re-send. Wait for next tick.
   - **b) `current_tick > last_received` AND no memory-wipe boundary in the gap** → inject fast-forward prefix `"Fast-forwarding from tick <last_received> to tick <current_tick>"` (one line) + the normal tick-N message (template selection per current state). The fast-forward prefix is grep-able in logs for R&D anomaly hunting.
   - **c) `current_tick > last_received` AND memory-wipe boundary falls in `(last_received, current_tick]`** → SPECIAL CASE. Do kill-tmux + spawn-fresh-claude (no `--continue`) + inject `07_post_memory_wipe.md` template for current tick. The elder's memory was wiped during the runner outage; they need a clean fresh start.
   - **d) `current_tick == last_received + 1` AND received-but-not-sent state (hook landed without sent record)** → impossible state, log + treat as case (a).
   - **e) `sent` recorded but no `received` for tick N == current_tick** → trust the `received` record. Re-send the message. Double-paste accepted as harmless: claude sees a duplicate prompt, responds twice or shrugs. The hook will then record the receipt.

### Tick backlog handling

A runner can fall behind only via: operator pause (`docker compose pause`), network partition, OS scheduling stall, OOM kill, container restart. All of these effectively look identical to the restart behavior above — the runner wakes up, reads `last_received` from Convex, computes `current_tick`, and runs the same branch logic. Same code path, no separate "backlog" handler.

### Reset (tick-driven hard wipe)

When `current_tick % ticks_between_memory_resets == 0` (computed locally from cached settings):

1. **Log reset start** to Convex: `{elderId, resetTick, startedAt, reason: "scheduled"}`.
2. **Kill the existing tmux session**: `tmux kill-session -t elder-N`. This disconnects ttyd; cockpit detects the disconnect and overlays a "Elder memory is being reset…" animation in place of the default ttyd reconnect screen.
3. **Spawn a fresh tmux session**: `tmux new-session -d -s elder-N -c /workspace`.
4. **Launch claude WITHOUT `--continue`**: `tmux send-keys -t elder-N "claude" Enter`. Fresh session id, fresh JSONL. Memory is gone.
5. **Brand the session**: send-keys `"/rename Ælder Crimson"` + Enter + Enter + `"/color red"` + Enter + Enter. Branding values keyed off `ELDER_ID` env var. (Elders: Crimson/red, Azure/blue, Verdant/green, Amber/yellow — exact mapping in `agents/shared/runner/elder-config.json`.)
6. **Inject first tick**: `tick: <current_tick>` + `<world_update name="07_post_memory_wipe">...</world_update>`.
7. **Log reset complete** to Convex: `{elderId, resetTick, completedAt}`.
8. Resume normal tick handling.

The reset-event log is **observability-only**. It does NOT gate the next tick. The runner moves on as soon as step 7 commits.

### Recovery / resume (cold boot with prior state)

When the elder container boots and finds tmux + claude alive, OR boots fresh but `agents/elder-N/.claude/projects/` already has JSONL files from a prior life:

1. If tmux + claude alive: do nothing, just begin tick handling. Claude is already running and has its history.
2. If tmux exists but claude died: `tmux send-keys -t elder-N "claude --continue" Enter`. `--continue` picks up the latest session JSONL, restoring color + rename + chat history.
3. If tmux doesn't exist but `.claude/projects/` does: `tmux new-session -d -s elder-N` + `tmux send-keys "claude --continue" Enter` (preserves prior state).
4. If neither tmux nor `.claude/projects/` exists: fresh launch (same as reset step 3+ but inject `00_game_start.md` instead of `07_post_memory_wipe.md`).

### Late-join (operator brings up a new elder mid-game)

This is the "container 5+ created after game has been running for 500 ticks" scenario. Reuse the reset flow with the `07_post_memory_wipe.md` template. The elder wakes up with no memory in a running game; same semantic as post-wipe.

## Game settings — immutable for game duration

Read-once at runner startup. Cached in memory. Drift-checked on every per-tick query (piggyback, zero extra reads). If the cached value ever diverges from Convex on the per-tick re-fetch, panic. Fail loud — the operator forgot to restart after changing a setting.

**Operational rule (capture in runbook):** To change ANY setting in `gameSettings` (heartbeat interval, memory-reset cadence, winter timing, season length), restart every elder container. There is no live-update path. The fail-loud drift check is a defensive trip-wire; it does not coordinate the change.

## Prompt templates

### Storage location

On disk at `agents/shared/runner/prompts/`. Files copied into each elder container's image at build time. Template content is static markdown. Edits require a runner-image rebuild + container restart.

(Future: skills could provide dynamic behavior — a prompt can include `/run <skill-name>` slash commands that claude executes. That makes the static templates extensible without inflating the runner code. Out of scope for Bundle 4.)

### Naming + ordering

Numbered prefix `NN_<purpose>.md`. Alphabetical sort = priority order. To reshuffle priority, renumber.

### Template list (Bundle 4 v1)

| File | Trigger | Class |
|---|---|---|
| `00_game_start.md` | First tick of a new game | tick-math |
| `05_pre_memory_wipe_5ticks.md` | `current_tick % wipe_interval == wipe_interval - 5` | tick-math |
| `06_pre_memory_wipe_1tick.md` | `current_tick % wipe_interval == wipe_interval - 1` | tick-math |
| `07_post_memory_wipe.md` | First tick immediately after a wipe; also late-join + recovery from gap | tick-math |
| `10_pre_winter_10ticks.md` | 10 ticks before winter starts | tick-math |
| `11_winter_started.md` | Tick winter starts | tick-math |
| `12_winter_ended.md` | Tick winter ends | tick-math |
| `20_bandits_appeared.md` | Bandit just spawned this tick | event-driven |
| `21_bandits_attacking.md` | Bandit in attack state this tick | event-driven |
| `22_post_bandit_attack.md` | Tick after a bandit resolved an attack | event-driven |
| `99_clansmen_revived_and_resources_injected.md` | Operator manually revived clansmen + injected resources (no fresh season) | event-driven |

Multiple templates can fire on the same tick. They concat in alphabetical order. Tick number always prefixes.

### Message wire format

```
tick: 537
<world_update name="05_pre_memory_wipe_5ticks">
Your memory will be reset in 5 ticks. Make sure your ancient wisdom journal is up-to-date.
</world_update>
<world_update name="10_pre_winter_10ticks">
Winter approaches. 10 ticks remain in the harvest. Stockpile food.
</world_update>
```

For most ticks, only the first line fires (no templates active).

## Admin / user message injection

Same writer table, separate trigger source.

### Convex `pendingMessages` table

```typescript
{
  _id: Id<"pendingMessages">,
  targetElderId: "elder-1" | "elder-2" | "elder-3" | "elder-4",
  text: string,
  insertedAt: number,
  source: "admin-injection" | "user-message",
  consumedBy: Optional<string>, // runner instance ID that processed this row
  consumedAt: Optional<number>,
}
```

### Runner subscription

The runner watches `pendingMessages` filtered by `targetElderId == own_id AND consumedBy == null`. When a row appears, the runner pastes immediately (does NOT wait for next tick). Marks `consumedBy` + `consumedAt` after the UserPromptSubmit hook confirms receipt.

### Admin injection flow

Dev-UI panel writes a row with `source: "admin-injection"`. Runner picks it up within poll interval (1-2 seconds), pastes into the elder's tmux pane. Same UserPromptSubmit hook records receipt to the same `tickReceiveLog` table (with `tickNumber == null` since it's not a tick message).

### Authorization

Admin injection requires `BUS_OPERATOR_SECRET`. Writes from other sources rejected at the Convex mutation level. (Survives from Bundle 2; carries forward.)

## Two-phase commit (tick delivery)

### `tickSendLog` table

```typescript
{
  _id: Id<"tickSendLog">,
  elderId: string,
  tickNumber: number,
  sentAt: number,
  messageHash: string,  // sha256 of the composed message body
}
```

Index: `by_elder_tick` on `(elderId, tickNumber DESC)`.

Runner writes one row BEFORE running `tmux paste-buffer`. If the runner crashes between write and paste, the row is a "sent but no record of receipt" → restart logic re-sends per case (e) above.

### `tickReceiveLog` table

```typescript
{
  _id: Id<"tickReceiveLog">,
  elderId: string,
  tickNumber: number | null,  // null for admin injections
  receivedAt: number,
  messagePreview: string,     // first 100 chars for operator visibility
}
```

Index: `by_elder_tick` on `(elderId, tickNumber DESC)`.

### `UserPromptSubmit` hook

Lives at `agents/shared/home-claude/hooks/user_prompt_submit.sh` (or `.py`). Triggers on every user prompt submitted to Claude. Inspects the prompt for the deterministic first-line pattern `tick: <N>`. If matched, extracts `<N>` and writes a `tickReceiveLog` row. If first line doesn't match `tick:` (admin injection), writes the row with `tickNumber: null`.

Hook authentication: passes `BUS_ELDER_SECRET_N` from env (already injected into the container via Docker secrets, available to the hook). Convex mutation rejects writes without a valid secret.

Hook failure (network blip, Convex down): logs the error to stderr + does NOT block the prompt. Next runner restart will see the missing `received` row and re-send — the double-paste is the accepted recovery cost.

## Healthcheck (three-part)

`docker-compose.yml` healthcheck for each elder container:

```yaml
healthcheck:
  test: ["CMD-SHELL", "sh /opt/clan-world/shared/runner/bin/healthcheck.sh"]
  interval: 30s
  timeout: 10s
  retries: 3
```

`healthcheck.sh` validates:

1. **Runner process alive**: `pgrep -x runner` returns one PID.
2. **Tmux session alive**: `tmux has-session -t $ELDER_ID` returns 0.
3. **Claude process alive**: `pgrep -x claude` returns exactly one PID (one-claude invariant).

Failure on any check → docker restarts the container. Compose `restart: unless-stopped` retries indefinitely until the operator intervenes.

## Liveness observability

Separate from healthcheck. The dev-UI subscribes to two tables:

- `tickReceiveLog`: last-received-per-elder is the freshest liveness signal. If an elder hasn't received a tick in N intervals while ticks are firing, alert.
- `resetEventLog`: shows reset history per elder. Useful for forensics.

No `elderHeartbeat` table from the old design. The runner doesn't self-report; the hook does the reporting.

## New + dropped Convex tables

### NEW

- `pendingMessages` — admin + user message injection queue.
- `tickSendLog` — runner-side "sent" record.
- `tickReceiveLog` — hook-side "received" record.
- `resetEventLog` — observability log for reset events.

### DROPPED (compared to Bundle 1+2+3 state)

- `agentCommands` — old command bus FSM (queued/leased/acked/completed/failed). Gone.
- `elderHeartbeat` — old supervisor self-report. Gone (replaced by `tickReceiveLog` derived liveness).
- `commandResults` — old result rows. Gone.

`crons.ts` cron `bus-sweep-stale-delivered` also dropped — no leases to sweep.

## Schema migration

Bundle 4 ships a clean break. The new tables are created, old tables are dropped. No data migration — production has no data in `agentCommands` / `elderHeartbeat` / `commandResults` worth preserving (the bus was never actually exercised; per the PR #560 super-swarm finding, the bootstrap secrets were never plumbed so the bus was non-functional on dev).

## Sub-PR planning hints

Bundle 4 likely decomposes into ~6 sub-PRs targeting `dev-phase-4-simplified-comms`:

1. **Package renames + Convex schema migration**: `packages/runner/` → `packages/heartbeat/`, `packages/elder-runtime/` → `packages/runner/`. New tables in `packages/sdk/convex/schema.ts`. Drop the old tables + cron.
2. **Runner core rewrite**: `packages/runner/src/main.ts` becomes the per-elder runner. Tick subscription + template selection + tmux send-keys + reset/recovery flow.
3. **Prompt templates**: `agents/shared/runner/prompts/*.md` per the table above.
4. **UserPromptSubmit hook**: `agents/shared/home-claude/hooks/user_prompt_submit.sh` + settings.json wiring.
5. **Cockpit UI**: ttyd-disconnect-detection overlay with "Elder memory is being reset…" animation.
6. **Admin injection UI panel**: dev-UI form for operator message injection. (Could split to follow-up if scope is tight.)

Stack them under `dev-phase-4-simplified-comms` per the ADR 0018 4-level branching pattern.

## Open items for DA round 2

The locked-in design above resolves the 2026-05-22 DA review's 7 CRITICAL findings. The remaining DA SHOULD-RESOLVE items get re-asked against the new shape:

- Poll cadence and batch semantics for the per-elder runner reading `pendingMessages`.
- Retention/TTL for `tickSendLog`, `tickReceiveLog`, `resetEventLog` (write-heavy, grow forever otherwise).
- Hook failure aggregate alerting (one elder's hook stops posting → operator knows).
- Container-restart-mid-tick orientation (which template, which session JSONL).
- Specific test plan: duplicate paste, fast-forward gap, memory-wipe-in-gap special case, hook failure, late-join.
- Naming convention nits: `tickSendLog` vs `runnerSentTicks`, etc.

Dispatch DA round 2 against this rewrite for sharper findings.

---

**Locked decisions recap** (Liam-locked 2026-05-23 PM ET, do not re-litigate):

1. Heartbeat container = dumb chain submitter, package rename `packages/runner/` → `packages/heartbeat/`.
2. Per-elder runner inside elder container, package rename `packages/elder-runtime/` → `packages/runner/`.
3. Reset = kill-tmux + spawn-fresh + `claude` no `--continue` + inject first-tick. NOT `/clear`.
4. Recovery = same flow + `claude --continue`.
5. Cockpit UI animation overlays the ttyd disconnect window during reset.
6. Per-elder branding via `/rename` + `/color` CC TUI slash commands keyed off `ELDER_ID`.
7. Game settings = read-once at boot, cached, immutable. Restart-all to change.
8. Drift detection = piggyback on per-tick read, panic on drift.
9. Runner reacts to tick number only. Queries Convex auxiliary tables per tick for event-driven template inputs (Option B — business logic in runner, not indexer).
10. Prompt templates on disk under `agents/shared/runner/prompts/`. Numbered prefix = alphabetical = priority. Concat multiple when applicable.
11. Message format = `tick: <N>` + optional `<world_update name="...">...</world_update>` wraps.
12. Two-phase commit = runner writes `tickSendLog` before paste, `UserPromptSubmit` hook writes `tickReceiveLog` after landing.
13. Restart trust = `tickReceiveLog` is authoritative. Re-send when sent-but-not-received (Option B). Double-paste harmless.
14. Memory-wipe-in-gap = SPECIAL CASE kill-tmux fresh launch with post-memory-wipe template (Option A).
15. One-claude-per-container = defensive fail-loud check at runner boot. No pgrep+pkill (Option B).
16. Tick backlog collapses into restart logic (same code path).
17. Reset event logging = observability only, never gates tick processing.
18. Admin + user message injection IS in Bundle 4 scope. Same `pendingMessages` table, separate trigger from ticks.
19. Late-join (operator brings up new elder mid-game) reuses `07_post_memory_wipe.md` template.
20. Container healthcheck = three-part: runner alive + tmux alive + exactly one claude alive.
