# Bundle 4 — Simplified Communications Architecture

Locked design for the elder agent infrastructure refactor following Bundle 1 + 2 + 3 dockerize migration. Strips the over-engineered command bus and replaces it with a thin message-injection layer, hook-based liveness, kill-tmux resets, per-elder runners co-located with each elder container, and a small set of operational hardening invariants.

**Status:** Locked design (2026-05-23 PM/PM ET — final pass after 12 CRITICAL + 16 SHOULD-RESOLVE DA round-2 findings were triaged). Ready for sub-PR breakdown + implementation.

## Why this rewrite

The DA round-1 review (2026-05-22) found 7 CRITICAL ambiguities, most about who owns which control surface. The 2026-05-23 design conversation collapsed those ambiguities by reframing the process layout — per-elder runner inside each container, dumb heartbeat singleton, kill-tmux reset, two-phase commit on every tick delivery.

DA round 2 (2026-05-23 PM, against this rewrite's first pass) found 12 CRITICAL + 16 SHOULD-RESOLVE concerns. The 2026-05-23 evening triage walked each finding under an "over-engineering filter" — accepting real correctness work, rejecting LLM-default-defensive complexity that re-introduced the queue/lease/sweep machinery Bundle 4 exists to strip.

This document is the result.

## Process model

Five processes total in production:

| Process | Cardinality | Container | Responsibility |
|---|---|---|---|
| `heartbeat` | 1 | `heartbeat` container | Submit on-chain heartbeat tx on schedule. Nothing else. |
| `runner` | 4 (one per elder) | `elder-N` container, alongside tmux | Subscribe to ticks, derive templates, send-keys into local tmux pane, manage tmux lifecycle, watch the local Claude process, two-phase commit on every paste. |
| `tmux` | 4 (one per elder) | `elder-N` container | Hosts the elder's claude process so ttyd can attach. |
| `claude` | 4 (one per elder) | `elder-N` container, inside tmux | The actual LLM doing the agent work. |
| `ttyd` | 4 (one per elder) | `elder-N` container | Read-only web terminal exposing the tmux pane to the operator cockpit. |

What we previously called "supervisor" is now "runner". What we previously called "runner" (the heartbeat-only package) is renamed "heartbeat".

## Package renames

| Before | After | Why |
|---|---|---|
| `packages/runner/` | `packages/heartbeat/` | Reflects the dumb-singleton role — only owns heartbeat tx submission. |
| `packages/elder-runtime/` | `packages/runner/` | Reflects the new role — runner is now the per-elder process. |

Codex handles the rename across the monorepo (tsconfig paths, pnpm workspaces, Docker `COPY` targets, server convex import paths). Lands as a standalone PR1 — mechanical churn with no behavior change.

## Runner lifecycle

### Startup (per elder container boot)

1. **Acquire local `flock`** on `/var/run/elder-runner.lock`. Kernel-managed exclusive lock — second runner in same container fails immediately, exits non-zero. Defense in depth alongside the one-claude check at step 3.
2. **Read game settings** from Convex once. Cache in memory. Settings include heartbeat interval, ticks-between-memory-resets, winter timing, season length, current diamond address. If Convex unreachable: retry with exponential backoff (1s → 2s → 4s → cap at 60s). Don't exit. Log prominently. (Per item 7: separate "Convex outage" from "elder unhealthy".)
3. **Check one-claude-per-container invariant.** `pgrep claude` should return zero (cold boot) or one (warm restart). Multiple → fail loud + exit non-zero. NO pgrep+pkill recovery — discovery beats silent fixup for R&D.
4. **Check tmux session state**: no session → fresh launch; session + claude alive → warm restart; session + no claude → recovery.
5. **Look up last-received tick** from Convex (see Two-phase commit below). Compare to current tick. Branch into the 5-case restart decision table.
6. **Subscribe to tick updates**. Begin normal tick-handling loop.

### Normal tick handling (per tick)

1. Wake on new tick number from Convex subscription.
2. Per-tick auxiliary query — pulls current tickClock + game settings + any auxiliary tables (banditView, chainEvents) needed for event-driven template selection. **This single query also re-reads game settings — drift check piggybacks here. If any cached setting differs from current, panic + exit non-zero.** Operator must restart all elder containers to pick up new settings.
3. **Template selection** — compute which templates apply:
   - **Pure tick-math** (computed locally from tick number + game settings): `00_game_start.md`, `05_pre_memory_wipe_5ticks.md`, `06_pre_memory_wipe_1tick.md`, `07_post_memory_wipe.md`, `10_pre_winter_10ticks.md`, `11_winter_started.md`, `12_winter_ended.md`.
   - **Event-driven** (uses auxiliary query results): `20_bandits_appeared.md`, `21_bandits_attacking.md`, `22_post_bandit_attack.md`. Per Liam Q1: business logic in the runner, not the indexer — the runner inspects banditView + chainEvents from this tick to decide.
4. **Compose message** using the section-based format (see Message format).
5. **Two-phase commit pre-paste**: write `tickSendLog` row to Convex `{elderId, tickNumber, sentAt, messageHash, resetMetadata?}`.
6. **Paste verification layer (pre-paste)**: capture tmux pane, confirm Claude is at empty input prompt — not mid-tool-call, not at shell, not at auth prompt. If not ready: wait + retry up to N times. If still not ready after retry budget: log failure, skip this tick, don't paste (next tick wakes runner again).
7. `tmux load-buffer` + `tmux paste-buffer` + `tmux send-keys Enter`.
8. **Paste verification layer (post-paste)**: capture tmux pane, confirm input box is empty (= message was submitted). If text still in input box: re-send Enter, retry up to 3 times. If still stuck: log + give up.
9. The `UserPromptSubmit` hook fires when Claude actually receives the message; writes `tickReceiveLog` row.
10. **Resend cap (item 4)**: if a tick has been pasted 3 times without ever getting a `tickReceiveLog` row → write `HOOK_FAILURE` alert to runner events table + stop resending that tick. Continue processing new ticks. Operator sees the alert + investigates hook.

### Restart 5-case decision table

Given `current_tick` (from Convex), `last_received` (highest tickNumber in tickReceiveLog for this elder), `sent[current]` (sendLog row for current tick exists?), and `gap = current_tick - last_received`:

| Case | Condition | Action |
|---|---|---|
| A | `gap == 0` | No-op. Wait for next tick. |
| B | `gap == 1 AND !sent[current]` | Fresh send for current tick. |
| C | `gap == 1 AND sent[current]` | Re-send (trust receive log). Double-paste accepted as harmless. |
| D | `gap > 1 AND memory_wipe_tick ∈ (last_received, current_tick]` | **Special case**: kill-tmux + spawn-fresh + `claude` no-`--continue` + inject `07_post_memory_wipe.md`. The elder's memory was wiped during the runner outage. |
| E | `gap > 1 AND no memory-wipe in gap` | Inject fast-forward prefix `"Fast-forwarding from tick X to tick Y"` + normal current-tick message. Prefix is grep-able for R&D anomaly hunting. |

### Reset (tick-driven hard wipe)

When `current_tick % ticks_between_memory_resets == 0` (and `current_tick > 0` — tick 0 is excluded; that's the game_start path not memory wipe):

1. **Write `last_wipe_tick` marker** to local disk at `/var/run/elder-runner-last-wipe`. Atomic write — `/var/run/elder-runner-last-wipe.tmp` then `os.rename`. Prevents `claude --continue` from resurrecting pre-wipe memory if the runner crashes mid-reset.
2. **Log reset start** to `resetEventLog`: `{elderId, resetTick, startedAt, reason: "scheduled"}`.
3. **Kill the existing tmux session**: `tmux kill-session -t elder-N`. This disconnects ttyd; cockpit detects the disconnect, cross-references `resetEventLog` to confirm intent, and overlays the "Elder memory is being reset…" animation in place of ttyd's default reconnect screen.
4. **Spawn a fresh tmux session**: `tmux new-session -d -s elder-N -c /workspace`.
5. **Paste verification: pre-paste readiness probe** waits for Claude to launch + be ready at empty input prompt.
6. **Launch claude WITHOUT `--continue`**: `tmux send-keys -t elder-N "claude" Enter`. Fresh session id, fresh JSONL. Memory is gone.
7. **Brand the session**: send-keys `/rename Ælder Crimson` + Enter + Enter + `/color red` + Enter + Enter. Branding values keyed off `ELDER_ID` env var. (Mapping in `agents/shared/runner/elder-config.json`: Crimson/red, Azure/blue, Verdant/green, Amber/yellow.)
8. **Two-phase commit for first-tick**: write `tickSendLog` with `resetMetadata: {resetTick, resetReason, resetEventId}`. Paste `tick: <current_tick>` + `07_post_memory_wipe.md` template body. Verify post-paste.
9. **Log reset complete** to `resetEventLog`.
10. Resume normal tick handling.

The reset-event log is **observability only**. Does NOT gate tick processing.

### Recovery / resume

Per the 5-case table — case A (`gap==0`) means warm restart with no work. Cases B and C handle within-one-tick restarts via fresh send or re-send. The `last_wipe_tick` marker on disk is checked at every runner boot:

- If `last_wipe_tick == current_tick` → memory wipe in progress, refuse `claude --continue`, treat as case D.
- If `last_wipe_tick < current_tick` and case D applies (memory-wipe in gap) → same.
- Otherwise → `claude --continue` is safe, picks up prior session JSONL.

### Late-join (operator brings up new elder mid-game)

Reuse the reset flow with `07_post_memory_wipe.md`. The elder wakes with no memory in a running game; same semantic as post-wipe.

## Game settings — immutable for game duration

Read-once at runner startup. Cached in memory. Drift-checked on every per-tick query (zero extra Convex reads — piggybacks on the auxiliary query). If a cached value diverges from Convex on the per-tick re-fetch, panic and exit non-zero.

**Operational rule (capture in runbook):** To change ANY value in `gameSettings`, restart every elder container. There is no live-update path. The drift-check is a defensive trip-wire for the operator-forgot-to-restart case.

## Message format

Section-based, `---` separator between sections, prefix header per section, UID is the first line after the prefix.

```
---
tick: 12345
[zero or more concatenated prompt template bodies]
---
whisper: silent-screams-beneath-bedrock-7f3a
<1000 char message from clan owner>
---
special-msg: winter-mealworms-fluttering-calls-9a4c
<any length admin debug message>
```

Replaces the earlier `<world_update>` XML wrapping. Cleaner — no risk of stray closing tags in template bodies breaking the envelope, easier for Claude to parse visually, multiple distinct sections chain naturally in one paste.

The `tick:` section is always first. `whisper:` and `special-msg:` sections only appear when there's a corresponding `pendingMessages` row to deliver.

## Thematic UUIDs

For every message ID (tickSendLog `messageHash`-companion, whisper UUID, special-msg UUID, pendingMessages `_id`), generate a 4-segment slug.

**Six themed generators in a shared pool. Random selection per ID — generator chosen uniformly at random regardless of message type.** Variety of themes makes IDs visually interesting for log-grepping without baking semantic info into the UID (message type is distinguished via DB column + envelope prefix).

Generator templates:
1. `<volume>-<speech>-<direction>-<location>` — e.g. `booming-whisper-northward-thicket`
2. `<time>-<animal>-<action>-<utterance>` — e.g. `morning-lark-swooping-sigh`
3. `<weather>-<creature>-<motion>-<sound>` — e.g. `stormbound-fox-creeping-whisper`
4. `<season>-<terrain>-<creature>-<action>` — e.g. `autumn-marsh-otter-summoning`
5. `<mood>-<celestial>-<creature>-<call>` — e.g. `wistful-moonlit-stoat-summons`
6. `<color>-<material>-<creature>-<vocalization>` — e.g. `crimson-quartz-magpie-warning`

Each word slot has 50-100 candidates. Total combinatorial space per generator: ~25M-100M. Plus a 4-hex suffix appended (`-7f3a`) for true collision-free uniqueness: total space ~10 billion per generator × 6 generators.

Mutation does an exact `(slug, hex)` collision check pre-commit. If collision found, regenerate.

## UserPromptSubmit hook

### Implementation

Python 3.11+ script at `agents/shared/home-claude/hooks/user_prompt_submit.py`. Wired in via `agents/shared/home-claude/settings.json`.

### Dependencies

Pinned in `agents/shared/home-claude/hooks/requirements.txt`:

```
convex==0.7.0
```

That's the only dep. Convex Python SDK provides the mutation client with built-in retry, backoff, and timeout. We use it instead of hand-rolling around `urllib.request` so that:

- The pattern of "pinned PyPI deps in requirements.txt + Dependabot scanning" is established explicitly in the repo from day one.
- Future agents working in `agents/shared/home-claude/hooks/` follow the example instead of inventing a new dep solution.
- We don't reinvent retry/backoff/timeout that the SDK already handles.

`.github/dependabot.yml` adds an entry watching this requirements.txt with weekly cadence.

The Dockerfile copies + `pip install --no-cache-dir -r requirements.txt --require-hashes` (hashes generated via `pip-compile --generate-hashes requirements.in`).

### Behavior — positive filter

Hook acts as an **allowlist**, not a denylist. Only writes a `tickReceiveLog` row if the first line of the prompt starts with one of:

- `tick:` → tick message receipt, parses tick number for the receive log
- `whisper:` → admin/user whisper receipt, parses UUID
- `special-msg:` → admin debug message receipt, parses UUID

Everything else (including `/rename`, `/color`, free-form text typed by an operator via ttyd if it were writable) is ignored. Hook returns immediately, no Convex write.

Future allowlist additions are explicit code edits — keeps the surface scrutinized.

### Failure mode

Hook errors are logged to stderr but do NOT block the prompt — Claude still processes the message normally. The runner's resend-cap-3 with HOOK_FAILURE alert catches the case where the hook stops writing entirely.

## Convex schema

### NEW tables

```typescript
// agentCommands etc. dropped — see "Dropped" below

pendingMessages: defineTable({
  targetElderId: v.string(),
  text: v.string(),
  source: v.union(v.literal("admin-injection"), v.literal("user-message")),
  insertedAt: v.number(),
  consumedAt: v.optional(v.number()),
}).index("by_target_unconsumed", ["targetElderId", "consumedAt"]),

tickSendLog: defineTable({
  elderId: v.string(),
  tickNumber: v.number(),
  sentAt: v.number(),
  messageHash: v.string(),
  resetMetadata: v.optional(v.object({
    resetTick: v.number(),
    resetReason: v.union(
      v.literal("scheduled"),
      v.literal("manual"),
      v.literal("memory_wipe_gap"),
      v.literal("late_join"),
    ),
    resetEventId: v.id("resetEventLog"),
  })),
}).index("by_elder_tick", ["elderId", "tickNumber"]),

tickReceiveLog: defineTable({
  elderId: v.string(),
  receivedAt: v.number(),
  prefix: v.union(v.literal("tick"), v.literal("whisper"), v.literal("special-msg")),
  // Exactly one of these is set based on `prefix`:
  tickNumber: v.optional(v.number()),
  whisperUid: v.optional(v.string()),
  specialMsgUid: v.optional(v.string()),
  messagePreview: v.string(),  // first 100 chars (redacted for secrets in messagePreview redaction pass — follow-up)
}).index("by_elder_tick", ["elderId", "tickNumber"])
  .index("by_elder_received", ["elderId", "receivedAt"]),

resetEventLog: defineTable({
  elderId: v.string(),
  resetTick: v.number(),
  reason: v.union(
    v.literal("scheduled"),
    v.literal("manual"),
    v.literal("memory_wipe_gap"),
    v.literal("late_join"),
  ),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
}).index("by_elder_started", ["elderId", "startedAt"]),

runnerEvents: defineTable({
  elderId: v.string(),
  kind: v.union(
    v.literal("hook_failure"),
    v.literal("convex_outage_recovery"),
    v.literal("settings_drift_panic"),
    v.literal("invariant_violation"),
    v.literal("ready_probe_timeout"),
  ),
  message: v.string(),
  at: v.number(),
}).index("by_elder_at", ["elderId", "at"]),
```

### DROPPED tables

- `agentCommands` — old command bus FSM.
- `elderHeartbeat` — old supervisor self-report (replaced by `tickReceiveLog`-derived liveness).
- `commandResults` — old result rows.

### DROPPED cron

- `bus-sweep-stale-delivered` — no leases to sweep.

### Migration

Clean break. Production never exercised the old bus (per the PR #560 super-swarm finding — bootstrap-bus-secrets was never plumbed correctly, so bus auth always rejected). Drop the old tables in the schema migration; no data preservation needed.

## Admin & user message injection

### Server endpoint

Per Liam Q4 lock: new `/api/admin/` route namespace in the dev-UI server-side. Clerk authentication. Never ship `BUS_OPERATOR_SECRET` to client code.

`POST /api/admin/inject-message` accepts `{targetElderId, text, source: "admin-injection"}`. Server-side Clerk middleware verifies session. Server then writes `pendingMessages` row via Convex with `BUS_OPERATOR_SECRET` (server-side env var, never client-visible).

This becomes the auth pattern for ALL future admin features. Avoid hand-rolled auth anywhere in the system.

### Runner subscription

Each runner subscribes to `pendingMessages` filtered by `targetElderId == own_id AND consumedAt == null`. New row → paste immediately (don't wait for next tick). Same paste verification + UserPromptSubmit hook receipt as ticks. After hook records receipt, runner marks `consumedAt`.

Note: no atomic claim mutation. Admin messages are rare debug pings — double-paste under a runner restart race is acceptable (Liam directive: "no locking bullshit, we are clearly over-engineering").

## Hooks language + dep management

All Claude Code hooks inside elder containers are Python 3.11+. Pinned dependencies in `agents/shared/home-claude/hooks/requirements.txt`. Dependabot watches the file. Initial dep: `convex==0.7.0`.

Pattern for future hooks: edit `requirements.in` → run `pip-compile --generate-hashes` to regenerate `requirements.txt` with pinned hashes. Don't hand-edit requirements.txt. Don't use pyproject.toml (we're shipping scripts, not packages).

## Invariants + operational guards

1. **Local flock** at runner startup (`/var/run/elder-runner.lock`).
2. **One-claude-per-container** check at runner startup (defense in depth alongside flock).
3. **Drift check** of game settings on every per-tick query (zero-cost piggyback).
4. **Container healthcheck** = LOCAL ONLY: runner alive + tmux alive + claude alive. Does NOT check Convex.
5. **Convex outage handling** = retry with backoff + log loudly. NEVER exit non-zero on Convex error.
6. **Resend cap** = 3 attempts per tick → HOOK_FAILURE alert + stop resending that tick (continue with new ticks).
7. **Paste verification** = pre-paste readiness + post-paste stuck-input detection.
8. **`last_wipe_tick` marker** = local disk file prevents `claude --continue` from resurrecting pre-wipe memory if runner crashes mid-reset.

## Prompt templates

On disk at `agents/shared/runner/prompts/`. Numbered prefix = alphabetical = priority. Concat multiple in alphabetical order when several apply.

| File | Trigger | Class |
|---|---|---|
| `00_game_start.md` | Tick 0 of new game season | tick-math |
| `05_pre_memory_wipe_5ticks.md` | 5 ticks before wipe | tick-math |
| `06_pre_memory_wipe_1tick.md` | 1 tick before wipe | tick-math |
| `07_post_memory_wipe.md` | Memory wipe tick (fires FIRST template that tick) + late-join + memory-wipe-in-gap recovery | tick-math |
| `10_pre_winter_10ticks.md` | 10 ticks before winter | tick-math |
| `11_winter_started.md` | First winter tick | tick-math |
| `12_winter_ended.md` | First post-winter tick | tick-math |
| `20_bandits_appeared.md` | Bandit spawned this tick | event-driven |
| `21_bandits_attacking.md` | Bandit in attack state this tick | event-driven |
| `22_post_bandit_attack.md` | Tick after bandit resolved an attack | event-driven |
| `99_clansmen_revived_and_resources_injected.md` | Manual operator recovery | event-driven |

Skills (future extensibility): templates can include `/run <skill>` slash commands that Claude executes. Out of scope for Bundle 4 v1, but the design allows for it.

## Cockpit UI overlay

`apps/web` cockpit detects ttyd WebSocket disconnect AND cross-references `resetEventLog` to confirm it's a deliberate reset event (vs a transient network blip). When confirmed:

- Overlay "Elder memory is being reset…" with a branded animation in place of ttyd's default reconnect screen.
- Fade out on ttyd reconnect.

This turns the worst UX moment (ttyd disconnect during reset) into a visible deliberate event.

## Sub-PR plan

Bundle 4 decomposes into 6 sub-PRs targeting `dev-phase-4-simplified-comms`. Each PR is small enough to be locally reviewable + tied to a single GitHub issue. Issues filed in order so dependencies are clear.

### PR1: Foundation — package renames + Convex schema migration

**One GitHub issue.** Mechanical churn, no behavior change. Lands first.

- Rename `packages/runner/` → `packages/heartbeat/` (codex handles import paths across monorepo).
- Rename `packages/elder-runtime/` → `packages/runner/`.
- Update tsconfig paths, pnpm-workspace.yaml, Docker `COPY` targets, server convex imports, mobile imports.
- New Convex tables: `pendingMessages`, `tickSendLog`, `tickReceiveLog`, `resetEventLog`, `runnerEvents`.
- Drop `agentCommands`, `elderHeartbeat`, `commandResults`. Drop `bus-sweep-stale-delivered` cron.

CI must stay green after this PR — typecheck, contract types, all sub-package builds.

### PR2: Runner core rewrite

**One GitHub issue.** Replaces the old elder-runtime supervisor with the new per-elder runner.

- Rewrite `packages/runner/src/main.ts` with the locked lifecycle.
- Tick subscription via Convex.
- Per-tick auxiliary query (settings drift check + event-driven template inputs).
- Two-phase commit (tickSendLog → paste → hook fires → tickReceiveLog).
- Resend cap 3 + HOOK_FAILURE alert.
- One-claude invariant + local flock at boot.
- Game settings cache + drift-panic.
- Reset flow: kill-tmux + spawn-fresh + `claude` no-continue + branding + first-tick paste.
- Recovery flow: `claude --continue` with `last_wipe_tick` marker check.
- 5-case restart decision table.
- Convex retry+backoff for outages.
- Thematic UUID generator utility (6 generators + collision check).

### PR3: Hook + templates

**One GitHub issue.** Lands the Python UserPromptSubmit hook + prompt template library.

- `agents/shared/home-claude/hooks/user_prompt_submit.py` (positive-filter allowlist).
- `agents/shared/home-claude/hooks/requirements.txt` with `convex==0.7.0` pinned + hashes.
- `agents/shared/home-claude/hooks/requirements.in` source file.
- `agents/shared/home-claude/settings.json` wires the hook to UserPromptSubmit.
- Dockerfile installs `pip install --no-cache-dir -r requirements.txt --require-hashes`.
- `.github/dependabot.yml` entry watching the requirements file (weekly).
- 11 prompt templates at `agents/shared/runner/prompts/00_game_start.md` through `99_clansmen_revived.md` (Bundle 4 v1 set per the table above).

### PR4: Paste verification layer

**One GitHub issue.** Adds the pre-paste readiness probe + post-paste stuck-input detection to the runner. Could fold into PR2 if scope is comfortable, but separated for independent review.

- Pre-paste readiness probe: `tmux capture-pane` + regex match against input-box region.
- Post-paste submit verification: re-capture + retry Enter if input box still has text.
- Configurable retry budget + timeouts.

### PR5: Cockpit UI reset overlay

**One GitHub issue.** Frontend-only — uses existing Convex subscription pattern.

- Detect ttyd WebSocket disconnect in cockpit elder-pane component.
- Subscribe to `resetEventLog` filtered by `elderId == focused_elder`.
- If recent reset event spans the disconnect window, render the "memory is being reset" overlay; otherwise show standard reconnect message.
- Fade out animation on reconnect.

### PR6: Admin endpoint + UI panel

**One GitHub issue.** Server-side `/api/admin/` namespace + Clerk auth wrapper + dev-UI form.

- Add Clerk dependency to dev-UI app (server-side auth middleware).
- New route group `apps/web/src/api/admin/` with Clerk-protected middleware.
- `POST /api/admin/inject-message` writes `pendingMessages` row via server-side Convex client.
- Dev-UI panel component: dropdown for target elder + textarea for message + submit button.
- Sets the pattern for ALL future admin features — never hand-roll auth, always go through `/api/admin/*` + Clerk.

### Stack + merge order

Branch hierarchy per ADR 0018:

```
dev
  └── dev-phase-4-simplified-comms        (integration branch)
        ├── feat/issue-XXX-pr1-renames        (lands first)
        ├── feat/issue-XXX-pr2-runner-core    (depends on PR1)
        ├── feat/issue-XXX-pr3-hook-templates (depends on PR1)
        ├── feat/issue-XXX-pr4-paste-verify   (depends on PR2)
        ├── feat/issue-XXX-pr5-cockpit-overlay(depends on PR1)
        └── feat/issue-XXX-pr6-admin-api      (depends on PR1)
```

PR1 lands first. Then PR3 + PR5 + PR6 can land in parallel (they depend on PR1 only). PR2 lands next (uses PR1's schema). PR4 lands last (uses PR2's paste path).

Each PR goes through the local 3-tier swarm review per `swarm-pr-review.md`. The phase release PR (`dev-phase-4-simplified-comms → dev`) runs the 6-model super-swarm before merging to dev. Then the next dev→main release picks up Bundle 4 alongside any other Bundle 1/2/3 polish.

## Test coverage

Per DA r2 SHOULD-RESOLVE list — test plan for the highest-risk behaviors:

- Duplicate runner lock (flock catches second runner).
- Hook missing / misinstalled (resend cap fires HOOK_FAILURE after 3 attempts).
- Reset first tick lands via two-phase commit (tickSendLog with reset metadata).
- Convex outage at boot (retry with backoff, eventual success).
- Memory-wipe-in-gap (kill-tmux fresh launch with post-wipe template, `last_wipe_tick` marker prevents `--continue`).
- Tick 0 → game-start template (NOT post-memory-wipe).
- Fast-forward across gap with skipped event templates (current-tick state only — event-driven templates between gap and current are NOT replayed).
- Stuck-input detection (Enter not submitted → re-Enter retry).
- Game settings drift panic.

## Operational rules captured in runbook

- **Change ANY game setting → restart every elder container.** No live update path. Drift-panic catches operator forgetfulness.
- **Convex outage → wait it out.** Runners retry with backoff. Don't restart containers.
- **Hook failure (HOOK_FAILURE alerts in runnerEvents) → SSH into elder container, check hook script + auth.** Restart container after fixing.
- **Manual reset of a specific elder** → write admin message `RESET` (or kill+restart docker compose elder-N).
- **Late-join (new elder mid-game)** → just bring up the container; runner detects no prior state + uses post-memory-wipe template automatically.

---

## Locked decisions recap

Liam-locked from 2026-05-23 design conversation + DA r2 fix-round triage. Do not re-litigate.

**Architecture (20 from session 1):**

1. Heartbeat container = dumb chain submitter, `packages/runner/` → `packages/heartbeat/`.
2. Per-elder runner inside elder container, `packages/elder-runtime/` → `packages/runner/`.
3. Reset = kill-tmux + spawn-fresh + `claude` no-`--continue` + inject first-tick template.
4. Recovery = same + `claude --continue`.
5. Cockpit UI animation during ttyd disconnect window.
6. Per-elder branding via `/rename` + `/color` CC TUI slash commands keyed off `ELDER_ID`.
7. Game settings = read-once at boot, cached, immutable, restart-all to change.
8. Drift detection = piggyback on per-tick read, panic on drift.
9. Runner reacts to tick number only, queries Convex auxiliary tables per tick (Option B — business logic in runner).
10. Prompt templates on disk at `agents/shared/runner/prompts/`, numbered prefix alphabetical, concat multiple.
11. Message format = `tick: N` + section-based with `---` separators (replaces XML wrap).
12. Two-phase commit = runner writes `tickSendLog` before paste, hook writes `tickReceiveLog` after landing.
13. Restart trust = `tickReceiveLog` is authoritative. Re-send when sent-but-not-received.
14. Memory-wipe-in-gap = special-case kill-tmux fresh launch + post-memory-wipe template.
15. One-claude-per-container = defensive fail-loud check at runner boot.
16. Tick backlog collapses into restart logic.
17. Reset event logging = observability only, never gates tick processing.
18. Admin + user message injection in Bundle 4 scope via `pendingMessages` table.
19. Late-join reuses `07_post_memory_wipe.md` template.
20. Container healthcheck = three-part: runner + tmux + claude alive.

**DA r2 fix-round decisions (session 2):**

21. Thematic UUIDs: 6 generators in shared pool, random selection per ID, 3 themed words + 4-hex suffix, collision-check before commit. Message type via DB column + envelope prefix, not via UID pattern.
22. Reset two-phase commit: reset injection uses same `tickSendLog`/`tickReceiveLog` pipeline + reset metadata fields.
23. Restart 5-case state table: A no-op, B fresh send, C re-send, D kill-tmux post-wipe special case, E fast-forward.
24. `00_game_start.md` separate from `07_post_memory_wipe.md`. Tick 0 = game start. Memory-wipe tick = post-wipe template fires first.
25. `/api/admin/` route namespace + Clerk auth for dev-UI. Never ship BUS_OPERATOR_SECRET to client.
26. `last_wipe_tick` marker on disk prevents `claude --continue` from resurrecting pre-wipe memory.
27. Local `flock` at runner startup (`/var/run/elder-runner.lock`), defense in depth alongside one-claude check.
28. NO pendingMessages atomic claim (rejected — over-engineering). Double-paste on admin messages accepted.
29. NO unique key on tickSendLog/tickReceiveLog (rejected — forensic concern, not correctness).
30. Resend cap 3 with HOOK_FAILURE alert (replaces active hook self-test).
31. Paste verification layer: pre-paste readiness probe + post-paste stuck-input detection with Enter retry.
32. UserPromptSubmit hook = POSITIVE filter (allowlist). Only writes for `tick:`/`whisper:`/`special-msg:` prefixes.
33. Convex outage handling: separate from elder health. Retry with backoff in runner. Healthcheck local-only. Don't exit on Convex error.
34. Hooks language = Python 3.11+. Pinned deps in `requirements.txt`. Dependabot scanning. Include `convex==0.7.0` as the first dep to set the example for future agents.

## Open items for DA round 3 (light pass)

Most concerns from DA r2 are now addressed. The DA r3 dispatch should focus on:

- Verify the 6 sub-PR boundaries are clean (no cross-PR dependencies missed).
- Check the runnerEvents kind enum is comprehensive.
- Validate the `last_wipe_tick` marker placement (`/var/run/` is tmpfs; need persistent volume? Or accept that mid-reset crash = fresh wipe anyway is OK?).
- Audit Clerk integration assumption (does the dev-UI already have a Clerk account/setup, or is this Bundle-4 net-new?).
- Test plan completeness against the 9 listed scenarios.

DA r3 is expected to be a SHOULD-RESOLVE-level pass — no CRITICAL findings expected.
