# `agents/shared/caddy.conf` — host caddy subroute snippet

This file is the canonical Caddy config snippet for routing
`app.clan-world.com` to the per-elder ttyd ports and the web frontend.
It is **owned by this repo** and imported into the **host caddy** at
`/etc/caddy/Caddyfile`. The host caddy remains the single TLS terminator
and the single cloudflared peer — there is no docker caddy container in
Phase 1.5.

## How it integrates

The host `/etc/caddy/Caddyfile` gets ONE additional line at the
top level:

```caddy
import /home/claude/code/clan-world/clan-world-game/agents/shared/caddy.conf
```

(Adjust the path if the repo lives elsewhere on the host.) The
`bin/install-caddy-snippet.sh` script in this repo idempotently adds
that line, validates the resulting config, and reloads caddy.

## Subroute layout (Phase 1.5)

| Path           | Upstream                                  | Notes                                   |
|----------------|-------------------------------------------|-----------------------------------------|
| `/`            | `$CLAN_WORLD_WEB_UPSTREAM` (Vercel today) | Cockpit. Phase 2 cutover swaps to local docker web container. |
| `/map*`        | `$CLAN_WORLD_WEB_UPSTREAM`                | Same as `/` until #354 URL rename ships separately. |
| `/elder-1/*`   | `127.0.0.1:$ELDER_1_TTYD_PORT` (7681)     | ttyd via HTTP/1.1; `/elder-1` prefix is stripped. |
| `/elder-2/*`   | `127.0.0.1:$ELDER_2_TTYD_PORT` (7682)     | "                                       |
| `/elder-3/*`   | `127.0.0.1:$ELDER_3_TTYD_PORT` (7683)     | "                                       |
| `/elder-4/*`   | `127.0.0.1:$ELDER_4_TTYD_PORT` (7684)     | "                                       |
| `/elder-N`     | 301 → `/elder-N/`                         | Browser-relative-URL safety.            |

## Environment variables

The snippet reads these env vars (with safe defaults). Provide them via
`/etc/default/caddy` or a systemd drop-in:

```
# /etc/systemd/system/caddy.service.d/clan-world.conf
[Service]
Environment="CLAN_WORLD_DOMAIN=clan-world.com"
Environment="TLD_APP_SUBDOMAIN=app"
Environment="ELDER_1_TTYD_PORT=7681"
Environment="ELDER_2_TTYD_PORT=7682"
Environment="ELDER_3_TTYD_PORT=7683"
Environment="ELDER_4_TTYD_PORT=7684"
Environment="CLAN_WORLD_WEB_UPSTREAM=https://clan-world-game.vercel.app"
```

After dropping in the unit, `sudo systemctl daemon-reload && sudo
systemctl restart caddy`. Or just `sudo systemctl reload caddy` if env
already loaded.

## Host-global timeouts for ttyd

ttyd terminal sessions are long-lived; the host caddy's GLOBAL options
block needs the timeout overrides below to prevent mid-session WS
disconnects. This is host-global, not site-level — it cannot live in
this snippet.

In `/etc/caddy/Caddyfile`, ensure the global block contains:

```caddy
{
    servers {
        timeouts {
            read_body 30s
            read_header 10s
            write 0
            idle 1h
        }
    }
}
```

`write 0` disables the write timeout (ttyd streams continuously).
`idle 1h` keeps connections alive across short user pauses.

## Change workflow

1. Edit `agents/shared/caddy.conf` in this repo.
2. Validate: `caddy validate --config agents/shared/caddy.conf --adapter caddyfile`.
3. PR + merge.
4. On the host, after pulling: `caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

No host file edits required after the initial install — the host caddy
re-reads the imported snippet at every reload.

## Coexistence with existing host caddy routes

This snippet introduces `app.clan-world.com` as a NEW top-level site
block. It does NOT touch the existing `*.clan-world.com` wildcard block
or any of the other tunneled services (pm-dobot, narrator, cockpit,
gstack, etc.). The pre-existing `cockpit.clan-world.com` block with its
`/elder-N-tty/` routes proxying to ports 38790-38793 is the legacy
phase-5 mirror — it remains untouched and continues to serve that
hostname during the coexist window.

## Limitations / known v1 caveats

- Ports `7681-7684` are hardcoded. A later issue will dynamically
  allocate these via the `port-for` system.
- `CLAN_WORLD_WEB_UPSTREAM` defaults to a Vercel hostname; verify the
  real production URL before relying on the default in prod.
- The snippet does NOT include the convex dashboard basic-auth proxy
  (`/convex-admin`) — that arrives in a later issue once the dashboard
  is exposed on the host.
- TLS is handled by the host caddy's existing cert/cloudflared
  arrangement, NOT by this snippet. The site block as written assumes
  Caddy will auto-provision TLS via the global cert path; if the host
  uses a different TLS strategy for `*.clan-world.com`, the snippet may
  need a `tls` directive added.
