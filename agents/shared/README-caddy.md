# Docker Caddy Routing

ClanWorld's public app router lives inside the compose stack as the `caddy`
service. It reads `agents/shared/caddy.conf`, publishes one loopback port on the
host, and routes to Docker-internal services such as `elder-1:7681`.

## Prod VPS

Set `CADDY_HOST_PORT=18081` unless the operator intentionally chooses another
free loopback port. The default `CLAN_WORLD_WEB_UPSTREAM` in the Caddyfile is
`https://clan-world-game.vercel.app`.

Cloudflare Access is the production auth gate for `app.clan-world.com`. The
ttyd terminals are read-only; operators send commands through the Convex command
bus, not through the browser terminal.

### Cloudflared Ingress

Warning: restarting cloudflared briefly drops ALL tunnels, usually for about 5
seconds. Choose an operator-approved time.

Back up the current config:

```bash
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak-$(date +%Y%m%d%H%M%S)
```

Edit `/etc/cloudflared/config.yml` and insert the `app.clan-world.com` ingress
entry BEFORE the final `http_status:404` catch-all rule:

```yaml
- hostname: app.clan-world.com
  service: http://127.0.0.1:18081
  originRequest:
    httpHostHeader: app.clan-world.com
```

Validate and restart:

```bash
sudo cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
sudo systemctl restart cloudflared
```

Verify the new route and one existing tunnel:

```bash
curl -I https://app.clan-world.com/healthz
curl -I https://cockpit.clan-world.com
```

Rollback uses the timestamped backup from the first command:

```bash
sudo cp /etc/cloudflared/config.yml.bak-YYYYMMDDHHMMSS /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```

## Local Dev

Set `CADDY_HOST_PORT=8080` or any other free loopback port, then open:

```text
http://127.0.0.1:8080
```

No host Caddy or cloudflared setup is required for local development. Local dev
has no Caddy auth layer; bind the port to `127.0.0.1` only.

By default, Caddy proxies `/` and `/map` to
`https://clan-world-game.vercel.app`. To use a host-run local frontend instead,
set `CLAN_WORLD_WEB_UPSTREAM`, for example:

```dotenv
CLAN_WORLD_WEB_UPSTREAM=http://host.docker.internal:58740
```

The compose `caddy` service includes
`host.docker.internal:host-gateway`, so this works on Linux Docker too. If a
developer points at a frontend container instead, use that service name on the
Docker network instead of `host.docker.internal`.

## Smoke Checks

```bash
docker compose --profile dev up -d caddy
curl -sf "http://127.0.0.1:${CADDY_HOST_PORT:-18081}/healthz"
curl -I "http://127.0.0.1:${CADDY_HOST_PORT:-18081}/elder-1/"
```

These checks prove Caddy is reachable and can attempt an elder route. Full ttyd
validation requires the full stack up and a follow-up Playwright or `websocat`
smoke that verifies the WebSocket upgrade and terminal output.
