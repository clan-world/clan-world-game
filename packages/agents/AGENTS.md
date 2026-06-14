# packages/agents — AGENTS.md

The `elder` CLI toolbelt plus `elder-mcp` stdio server. Installed as `bin`
entries from this package; Elder Claude Code sessions invoke them to read game
state, submit orders, post bulletins, send whispers, and persist memory.

## What this package does

- Provides the `elder` CLI executable (mapped via `package.json` `"bin"`).
- Provides the `elder-mcp` stdio MCP server for structured JSON calls.
- Wraps `IChainClient` and `IConvexClient` adapter calls in stable shell commands an Elder can invoke without thinking about RPC endpoints, contract addresses, or Convex deployment IDs.
- Returns JSON on stdout (Elders parse it); writes diagnostics to stderr.

## Wave 0 status

`src/cli.ts` implements only `elder world snapshot`, returning mock JSON. The full command surface (Wave 1+):

- `elder world snapshot` — current `WorldSnapshot`
- `elder clan view <clanId>` — `ClanFullView` for a specific clan
- `elder clan submit-orders <clanId> <ordersJsonFile>` — submit pending orders
- `elder whisper send <fromClan> <toClan> <text>` — send a whisper
- `elder whisper inbox <clanId>` — list unread whispers
- `elder bulletin post <text>` — post a public bulletin

## Key files

- `src/cli.ts` — CLI entry point. Argv parsing is hand-rolled (no `commander`, keep deps minimal).
- `src/mcp.ts` — MCP stdio server. Keep tool handlers aligned with CLI behavior.
- `package.json` — declares bin entries `elder` (`./bin/elder`) and `elder-mcp` (`./bin/elder-mcp`). Run `pnpm --filter @clan-world/agents build` then `pnpm link --global` to use.

## Local conventions

- **stdout is JSON, stderr is human.** Elders parse stdout; humans read stderr.
- **Exit code 0 = success, nonzero = error.** Elder Bash tool wraps usage errors uniformly.
- **No interactive prompts.** Every input is an argv or env var.
- **Idempotent reads, idempotent writes.** Submitting the same orders twice should not double-charge or double-resolve.
- **Read clan ID from `CLAN_WORLD_CLAN_ID` env var by default;** allow override via positional arg.

## How it interacts with adapters

- **`IChainClient`** — every chain read/write goes through `createChainClient()`.
- **`IConvexClient`** — game-state reads (snapshot, whispers) go through Convex; chain reads are a fallback.
- **`IKeeper`** — never used by the toolbelt.
- **`ILLMClient`** — never used; the Elder IS the LLM.

## Running

```bash
pnpm --filter @clan-world/agents build
node packages/agents/dist/cli.js world snapshot   # or once linked: `elder world snapshot`
```

See `../../agents/README.md` and `../../docs/architecture/current-architecture.md` for the elder boot sequence and runtime model. (The legacy `stream-agents.md` orchestrator guide is archived under `docs/archive/guides/`.)
