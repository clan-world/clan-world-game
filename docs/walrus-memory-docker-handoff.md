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

## What the docker-build session needs to add (3 changes — do #0 FIRST)

### 0. 🚨 Egress allow-list — the #1 demo-day risk (de-risk this BEFORE anything else)
Elders run **network-sandboxed** (per `APPENDED_SYSTEM_PROMPT.md`: `api.anthropic.com`, `claude.ai`, DNS, internal
docker net only). The MemWal MCP must reach the **public** relayer **`relayer.memory.walrus.xyz`** over HTTPS.
If it's not in the egress allow-list, `remember`/`recall` **fail silently inside the container** even though they
work perfectly on the host (where provisioning was proven). Add `relayer.memory.walrus.xyz` (+ its DNS/TLS path) to
the Elder egress allow-list. **Verify with the dumbest possible check from inside an Elder container first:**
```bash
docker compose exec elder-1 curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 https://relayer.memory.walrus.xyz/health
# non-000 = reachable. 000 = egress blocked → fix the allow-list before proceeding.
```

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
Run the bundled smoke script inside each Elder container — it checks binary-on-PATH, per-Elder creds + accountId,
and (critically) egress to the relayer:
```bash
docker compose exec elder-1 /opt/clan-world/shared/scripts/walrus/smoke-elder-memwal.sh
```
Then the manual check: in the Elder Claude session, `mcp__memwal__*` tools appear and
`memwal_remember("smoke")` → `memwal_recall("smoke")` round-trips.

⚠️ **Confirm `accountId` is DISTINCT per container.** Identical creds across the 4 Elders collapses them into one
MemWal identity (the 2nd-biggest risk after egress). The smoke script prints each container's accountId — eyeball
that elder-1..4 differ.

## Observability for demo day (recommended)
Before recording, stand up a tiny visible proof trail per Elder — `accountId`, last remembered tag, last recall
result + timestamp — so a failed recall at 5:40am is debuggable at a glance rather than guesswork. The cockpit
Agent panel (PR3) is the natural home; until it lands, the smoke script + `~/.secrets/clanworld-elder-walrus/`
addresses suffice.

## Notes
- The `@mysten/sui` version compat wrapper (`SuiJsonRpcClient` vs old `waitForTransaction`) only affects the
  **host-side provisioning script**, not the MCP runtime in the container.
- Relayer: `https://relayer.memory.walrus.xyz`. Mainnet pkg `0xcee7a6fd…a24c6`, registry `0x0da982ce…7edd`.
- Per-Elder account/delegate addresses are in the provisioning run output (host `~/.secrets/clanworld-elder-walrus/`).
