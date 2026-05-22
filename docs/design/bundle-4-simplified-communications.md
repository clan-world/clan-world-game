# Bundle 4 — Simplified Communications Architecture

Design doc capturing the runner/elder/supervisor refactor that follows Bundle 2 + 3 dockerize migration. Replaces the over-engineered command bus with a thin message-injection layer plus hook-based liveness plus tick-driven resets.

**Status:** Draft for review (2026-05-22 ~15:10 ET). Source of design points: Liam voice messages 16646 through 16720.

## Motivation

The current command bus (Bundle 2 PR #542 + Bundle 3 PR #549) ships a distributed-durable-queue design with lease management, ack/complete/fail state machines, sweep crons, and retry semantics. It was built assuming elders are unreliable and might die mid-command.

Liam's design intent is the opposite: elders are responsible for their own resilience, resets are intentionally jarring, and the runner uses fire-and-forget messaging into elder tmux sessions. The Claude Code harness already queues stdin properly so we don't need a separate queue layer.

Bundle 4 strips the queue/lease/retry/sweep machinery and replaces it with the simpler shape below.

## Communications taxonomy — eight categories

Every cross-process interaction in the system falls into one of these:

1. **Game state read** — elder calls Convex queries or chain reads to learn world state (vault, clansmen, missions, world tick).
2. **Game state write** — elder submits orders to the contract via their own private key. On-chain transaction.
3. **Communications read** — elder reads private whispers from other elders + public bulletin board entries. Convex queries.
4. **Communications write** — elder writes whispers to specific elders + posts to bulletin board. Convex mutations.
5. **Owner whispers** — Liam (or whoever owns the agent) injects arbitrary text into a specific elder's context. Goes through the admin-inject path.
6. **Runner world messages** — per-tick world snapshot, memory-wipe-incoming warnings (no longer requires ack), post-reset re-orientation. Injected by runner.
7. **Control plane** — process-level control: reset, restart-supervisor, kill-and-recreate. Not user-visible to elder. Tick-driven for reset; supervisor-managed for restarts.
8. **Liveness/observability** — `PostToolUse` hook posts to Convex on every Claude tool call. Elder is unaware. Operator/dashboard queries the resulting log for "last activity" + "tool-use rate per tick" signals.

Categories 1-4 go through the elder CLI (already exists). Categories 5-6 go through a new thin message-injection layer described below. Category 7 is process control (no user-visible API). Category 8 is hooks-only.

## The message-injection layer

**Single operation:** "inject text into elder N's tmux session."

Two writers: the runner (during tick injection) and the admin dev-UI (for R&D experimentation).

### Convex table

```typescript
// pendingMessages
{
  _id: Id<"pendingMessages">,
  targetElderId: "elder-1" | "elder-2" | "elder-3" | "elder-4",
  text: string,
  insertedAt: number,
  source: "runner" | "admin-injection",
}
```

That's the whole schema. No status, no lease, no retry count.

### Runner-side write

Per tick, runner calls a Convex mutation `enqueueElderMessage` with the tick's world snapshot text targeted at each living elder. One row per (elder, tick).

For the mod-N reset tick, the runner instead writes a structured reset payload (see "Reset workflow" below).

### Admin dev-UI write

Dev-UI calls the same `enqueueElderMessage` mutation with `source: "admin-injection"` and an operator-supplied text. Selects target elders via checkbox or per-elder field.

### Supervisor-side read

Inside each elder container, the supervisor polls `pendingMessages` filtered by its own elder ID. For each pending row, in `insertedAt` ASC order:

1. Read the row.
2. Paste the text into the local tmux session targeting the Claude pane.
3. Delete the row.

No lease. No ack. No retry. If the supervisor crashes between read and paste, the row sits in the table until the supervisor restarts and picks it up. If the supervisor pastes successfully but crashes before delete, the next poll will paste the same row again — operator should design messages to be safely idempotent at the elder layer (typically a no-op since the elder reads world state fresh each turn anyway).

### What this discards from Bundle 2 + 3

- `agentCommands` table (replaced by `pendingMessages`)
- `claimNext` / `ackCommand` / `completeCommand` / `failCommand` mutations
- `sweepStaleDelivered` cron
- `LEASE_MS`, `COMPLETION_GRACE_MS` constants
- Bracketed-paste nonce protocol + supervisor scrollback grep
- Control-verb priority pass in claimNext (reset is now process-level, not message-level)
- `elderHeartbeat` table writes from the supervisor (replaced by hook-based liveness)
- `elder ack-clear` CLI subcommand and the runner's await-ack flow (issue #555)

### What this keeps from Bundle 2 + 3

- Supervisor process inside each elder container (slimmed to a thin watchdog)
- Tmux + ttyd lifecycle management
- Bus secret per elder for authenticating the supervisor's Convex calls
- Healthcheck infrastructure (Caddy + per-elder process supervision)
- All the elder CLI surface (game read/write, comm read/write)

## Liveness — PostToolUse hook

Configure a `PostToolUse` hook in `agents/shared/home-claude/settings.json`. The hook fires after every Claude tool call. The hook script:

1. Read tool-call metadata (tool name, timestamp) from hook stdin.
2. Curl POST to a Convex action `recordToolUse` with `{ elderId, toolName, ts }`.
3. Exit cleanly. Hook errors are silenced — elder must not be aware of liveness machinery.

### Convex table

```typescript
// elderActivity
{
  _id: Id<"elderActivity">,
  elderId: string,
  toolName: string,
  ts: number,
}
```

### Liveness query

```typescript
// "is elder-N alive?"
const lastActivity = await ctx.db
  .query("elderActivity")
  .withIndex("by_elder_ts", q => q.eq("elderId", "elder-1"))
  .order("desc")
  .first();

const isAlive = lastActivity && (Date.now() - lastActivity.ts) < ALIVENESS_THRESHOLD_MS;
```

### Dashboard signals

The same `elderActivity` table powers richer signals:

- Tool-use frequency per elder (idle vs active)
- Tool-type distribution (which tools are getting used)
- Per-tick activity (how many tool calls between two `UserPromptSubmit` events from the runner's tick injection)

## Reset workflow — tick-driven

### Configuration

A new Convex table `gameSettings` holds the reset-cadence knob.

```typescript
// gameSettings
{
  _id: Id<"gameSettings">,
  resetEveryNTicks: 50, // default
  // future: maxTick, tickIntervalMs, etc.
}
```

### Trigger condition

On each tick `T`, the runner queries `gameSettings.resetEveryNTicks` (call it `N`). If `T % N === 0`, the next tick injection becomes a reset workflow instead of a normal tick injection.

### Reset workflow (per-elder, parallel)

For each elder:

1. **Issue Claude `/clear`** — write `/clear` into the elder's tmux pane via the supervisor. (Open question: paste as text vs send-keys. `/clear` is a Claude Code REPL command, not a tmux primitive — pasting it as text should work if the Claude pane is foreground.)
2. **Wait for `/clear` to land** — supervisor watches session JSONL for the `system: cleared` marker or equivalent. Configurable timeout, default 10 seconds.
3. **If `/clear` doesn't land in timeout** — supervisor escalates: kill the Claude process inside tmux, restart Claude via `claude` (no `--continue`), which gives a fresh context. Tmux session itself stays alive — ttyd terminal UX preserved, no flicker.
4. **If kill-restart also fails** — supervisor escalates further: `exit 1` from the supervisor process, container exits, docker compose `restart: unless-stopped` brings up a fresh container.
5. **After Claude is fresh** — runner injects the rename + color seed message, then injects the reorientation prompt: "You're in the middle of a game on tick N out of TOTAL_TICKS. Check world snapshot, recall memories, resume play."

### What's NOT in the reset workflow

- No graceful drain of pending messages. Any `pendingMessages` rows targeted at the elder at reset moment are LOST. Intentional — by design, the elder has to deal with the gap.
- No elder-side ack. Runner doesn't wait for elder to confirm. Reset happens unconditionally.
- No reset-warning message. The 60-second warning (if we keep it) is embedded as a field in the regular world-snapshot tick message: `ticksUntilWipe: 1` or similar. Elder reads it or doesn't.

### Open question — does the runner inject reset directly or via supervisor?

Option A: Runner has docker exec access to each elder container, writes the `/clear` itself.
Option B: Runner writes a structured reset row to `pendingMessages` with `source: "reset"`, supervisor recognizes and executes the workflow locally.

Option B is consistent with the rest of the architecture (everything routes through `pendingMessages`) but introduces a marshalled "reset" type that breaks the "just text injection" simplicity. Option A keeps `pendingMessages` purely text but requires the runner to have docker control access.

**Recommended:** Option A. Runner can do `docker exec elder-N tmux send-keys ...` directly. Keeps `pendingMessages` simple. Reset is process control, separate from message injection.

## Supervisor — thin watchdog

Two-layer recovery:

1. **Layer 1 — Claude restart inside tmux.** Supervisor monitors the Claude process. If Claude exits or hangs, supervisor kills it and restarts `claude` inside the same tmux session. Ttyd terminal UX preserved.
2. **Layer 2 — Container restart fallback.** If Layer 1 fails N times within M minutes (e.g. 3 failures in 5 minutes), supervisor exits 1 → docker compose `restart: unless-stopped` recreates the entire container. Fresh tmux, fresh ttyd, fresh everything. Ttyd briefly disappears from the dev UI.

Configurable thresholds via env vars.

Beyond watchdog, the supervisor also:

- Polls `pendingMessages` for its elder ID and pastes them into tmux.
- Optionally captures snapshot scrollback on operator demand (for debugging).

That's it. No bus polling, no state machine, no liveness reporting, no nonce verification.

## Admin dev-UI injection

A new dev-UI panel allows the operator to:

- Select target elders (checkboxes for elder-1..N or "all")
- Write arbitrary text in a textarea
- Click "Inject" — fires a Convex mutation `enqueueElderMessage` with `source: "admin-injection"` per selected elder

Use cases: R&D experimentation, prompting an elder with a specific scenario while watching gameplay, sending "you are now in a debug session" cues during dev.

## What goes to issue trackers

Bundle 4 PR will include:

- `apps/server/convex/commandBus.ts` — strip queue/lease/sweep code, leave only `enqueueElderMessage` mutation + `recordToolUse` action + liveness query helpers
- `apps/server/convex/schema.ts` — drop `agentCommands`, add `pendingMessages` + `elderActivity` + `gameSettings`
- `packages/elder-runtime/` — strip bus polling logic, slim to watchdog + paste loop
- `agents/shared/home-claude/settings.json` — add PostToolUse hook config
- `agents/shared/home-claude/hooks/post-tool-use.sh` — new hook script
- `packages/runner/` — add tick-driven reset trigger, replace user-message dispatch with `enqueueElderMessage`
- Reset workflow — runner-side docker-exec dispatch (Option A)
- `agents/shared/home-claude/CLAUDE.md` — remove ack-clear cheat-sheet entry, simplify memory-wipe cycle docs
- `agents/shared/APPENDED_SYSTEM_PROMPT.md` — same
- Tests — full review for tech debt; existing tests on the queue machinery get deleted, new tests on the simpler shape get added

Separate (after Bundle 4):

- Issue #555 — remove `elder ack-clear` from elder CLI in `packages/agents/`
- Dev UI panel for admin injection (separate PR in `apps/web/`)

## Open questions

1. **Two pending messages for one elder — batch-paste or serialize?** Recommend serialize (one-at-a-time in insertedAt order) because Claude Code already handles stdin queuing properly. Batching would just inject extra `--- next message ---` separators that are noise.
2. **Admin-inject rate limiting?** Probably not needed in v1. Operator is the only authorized writer to that source, and abuse from operator is operator's problem.
3. **Liveness threshold default?** Recommend 5 minutes — elders take long Claude turns occasionally (especially during complex strategy planning), so a 30-second threshold would false-positive. 5 minutes catches dead elders without flapping.
4. **Hook failure handling?** PostToolUse hook posts to Convex via curl. If Convex is down, the hook should fail silent so elder is unaware. Worst-case effect: liveness signal drops until Convex returns. Acceptable.
5. **Bundle 4 vs separate ack-clear PR ordering?** Bundle 4 can land first; ack-clear is in a different package (`packages/agents/`) outside the dockerize migration scope. Sequence: Bundle 4 → ack-clear PR.

## Release plan

**Option A (preferred):** Ship Bundle 2 + Bundle 3 release PRs to dev as they are. Open Bundle 4 immediately on top of dev. Pros: ships working code now, no rebase pain. Cons: dev briefly contains the over-engineered queue before Bundle 4 strips it.

**Option B:** Hold Bundle 2 release PR, rewrite the queue parts of PR #542 on the new shape, ship Bundle 2 with the simpler design from the start. Pros: never ships the over-engineered version. Cons: significant rework of Bundle 2 PR #542's design, weeks of delay.

Liam's call (voice 16713): Option A. Watch closely for tech debt in the test files during Bundle 4 — the queue-machinery tests need to be deleted cleanly, not left as dead helpers.

## Verification before Bundle 4 lands

- Codex DA round on this design doc to catch architectural gaps before code lands
- 3-tier swarm review on the Bundle 4 PR
- Manual smoke test once stack is up: admin-inject a message, see it land in elder tmux, see the elder respond, see the PostToolUse hook fire and record activity in Convex
- Reset workflow smoke: force a tick to be `T % N === 0`, observe `/clear` landing, observe reorientation message, observe elder picking up

## Mental model summary

The system becomes: "elders play the game by themselves; the only inbound channel from the operator is text injection; the only outbound signal the operator can read is the hook-driven tool-use log; the runner manages tick + reset cadence deterministically from world tick number."

Elders are autonomous, harshly time-bound, and have to be strategic about their own state preservation. The infrastructure is dumb fire-and-forget plumbing.
