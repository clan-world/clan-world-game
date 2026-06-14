# Walrus Memory — Docker-build hand-off (PR1)

PR1 stands up per-Elder **Walrus Memory (MemWal)** identities + the runner-side wiring. Two container-image
changes remain, which live in the **docker-build session's lane** (`Dockerfile` + `docker-compose.yml`) — listed
here so they can land there without me touching those hot files.

## What PR1 already shipped (this PR)
- `scripts/walrus/provision-elders.mjs` — idempotent provisioning. Already RUN on **mainnet**: 4 Elder owner
  accounts (fresh Ed25519 Sui keys) + Ed25519 delegates created; per-Elder `credentials.json` written. Isolation
  proven (Elder 2 cannot read Elder 1's memory).
- `agents/shared/elder-mcp.json` — added the `memwal` stdio MCP server entry (`/usr/local/bin/memwal-mcp`).
- `agents/shared/APPENDED_SYSTEM_PROMPT.md` — Elders are told about `memwal_remember`/`memwal_recall` + the
  KV-vs-reflection split + the post-wipe "recall both, verify vs world_snapshot" behavior.

## What the docker-build session needs to add (2 changes)

### 1. Install the `memwal-mcp` binary in the Elder image
The `elder-mcp.json` entry points at `/usr/local/bin/memwal-mcp`. The Elder Dockerfile must provide it, e.g.:
```dockerfile
RUN npm install -g @mysten-incubation/memwal-mcp \
 && ln -sf "$(npm root -g)/@mysten-incubation/memwal-mcp/dist/cli.js" /usr/local/bin/memwal-mcp \
 || true   # confirm the actual bin path from the package's "bin" field
```
(Verify the package's `bin` name; the global install should drop a `memwal-mcp` on PATH — symlink into
`/usr/local/bin` to match the `elder-mcp` convention.)

### 2. Mount each Elder's credentials into its container
The MemWal MCP reads `~/.memwal/credentials.json` (→ `/home/elder/.memwal/credentials.json`). Each Elder needs
**its own** file. Source files on the host:
```
~/.secrets/clanworld-elder-walrus/elder-1/credentials.json   → elder-1 container :/home/elder/.memwal/credentials.json
~/.secrets/clanworld-elder-walrus/elder-2/credentials.json   → elder-2 container :…
~/.secrets/clanworld-elder-walrus/elder-3/credentials.json   → elder-3 …
~/.secrets/clanworld-elder-walrus/elder-4/credentials.json   → elder-4 …
```
Wire as a per-Elder docker secret / bind mount, mirroring the existing `ELDER_WALLET_KEY_PATH` pattern
(`elder-wallet-N` secret → `/run/secrets/elder-wallet-N`). Mount read-only is fine — creds are pre-provisioned.
**Do NOT** copy `owner.key` into containers (provisioning/rotation only; keep it host-side).

## Verify (per Elder container)
1. `memwal-mcp` resolves on PATH; `/home/elder/.memwal/credentials.json` present + matches that Elder's `accountId`.
2. In the Elder Claude session, `mcp__memwal__*` tools appear.
3. `memwal_remember("smoke test")` → `memwal_recall("smoke")` returns it.

## Notes
- The `@mysten/sui` version compat wrapper (`SuiJsonRpcClient` vs old `waitForTransaction`) only affects the
  **host-side provisioning script**, not the MCP runtime in the container.
- Relayer: `https://relayer.memory.walrus.xyz`. Mainnet pkg `0xcee7a6fd…a24c6`, registry `0x0da982ce…7edd`.
- Per-Elder account/delegate addresses are in the provisioning run output (host `~/.secrets/clanworld-elder-walrus/`).
