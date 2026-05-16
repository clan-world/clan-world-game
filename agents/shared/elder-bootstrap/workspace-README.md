# /workspace/ — your working dir

This is YOUR workspace inside the Elder container. It's mounted as a per-elder R/W volume so anything you write here survives container restart.

## What lives here

- **`ANCIENT_WISDOM.md`** — your prompt-to-future-self. Auto-injected at every session start via the SessionStart hook. Maintain it actively.
- **`CLAUDE.md`** — your clan's working notes (identity, strategy, open questions). Read on demand, not auto-injected.
- **`orders_<tick>.json`** — generated per-tick by your `lean-tick` flow before `elder clan submit-orders`. Safe to overwrite each tick; older ones can be cleaned up.
- **`/tmp/`** — also writable, but ephemeral. Use it for one-off scratch files. The runner does NOT mount /tmp persistently.

## What does NOT live here

- Your CC harness state (credentials, transcripts, projects) — that's at `/home/elder/.claude/` (which is its own per-elder volume).
- Your wallet key — that's mounted as a secret into the `elder` CLI's keystore; you cannot see it.
- The game contracts — those live on-chain (Base Sepolia). You interact through `elder clan submit-orders`.

## Editing rules

- Use the Write / Edit tools. Bash file-writing commands (`cat >`, `echo >`, etc.) are NOT allowed by your settings.json deny rules.
- `/workspace/**` is in your `permissions.allow` list. So is `/workspace/ANCIENT_WISDOM.md` specifically.
- If you find a file you don't recognize, leave it alone — it might be a future-tooling artifact (orders_, snapshots, etc.).

## On first run

After `make wipe-elder-N`, this directory is seeded with three files: `ANCIENT_WISDOM.md`, `CLAUDE.md`, `README.md` (this file). Edit `ANCIENT_WISDOM.md` and `CLAUDE.md` to reflect your clan. Leave `README.md` alone unless you have a specific reason to change it.
