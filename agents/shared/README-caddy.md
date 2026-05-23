# Docker Caddy Routing

ClanWorld's public app router lives inside the compose stack as the `caddy`
service. It reads `agents/shared/caddy.conf`, publishes one loopback port on the
host, and routes to Docker-internal services such as `elder-1:7681`.

## Prod VPS

Set `CADDY_HOST_PORT=58731` unless the operator intentionally chooses another
free loopback port. The default `CLAN_WORLD_WEB_UPSTREAM` in the Caddyfile is
`https://clan-world-game.vercel.app`.

Cloudflare Access is the production auth gate for `app.clan-world.com`. The
ttyd terminals are read-only; operators send commands through the Convex command
bus, not through the browser terminal.

### Cloudflared Ingress

Warning: restarting cloudflared briefly drops ALL tunnels, usually for about 5
seconds. Choose an operator-approved time.

Pre-check for duplicate ingress entries:

```bash
if sudo grep -q "hostname: *app.clan-world.com" /etc/cloudflared/config.yml; then
  echo "ERROR: app.clan-world.com already exists in cloudflared config -- abort + update existing entry instead of adding"
  exit 1
fi
```

Back up the current config:

```bash
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak-$(date +%Y%m%d%H%M%S)
```

Edit `/etc/cloudflared/config.yml` and insert the `app.clan-world.com` ingress
entry BEFORE the final `http_status:404` catch-all rule. The port in
`config.yml` is literal: if you change `CADDY_HOST_PORT` from the `58731`
default, update this literal port to match.

```yaml
- hostname: app.clan-world.com
  service: http://127.0.0.1:58731
  originRequest:
    httpHostHeader: app.clan-world.com
```

Validate and restart:

```bash
EXPECTED_PORT=${CADDY_HOST_PORT:-58731}
CURRENT_CLOUDFLARED_PORT=$(sudo grep -A1 'app.clan-world.com' /etc/cloudflared/config.yml | grep -oE 'localhost:[0-9]+|127.0.0.1:[0-9]+' | grep -oE '[0-9]+' | head -1)
if [ "$EXPECTED_PORT" != "$CURRENT_CLOUDFLARED_PORT" ]; then
  echo "ERROR: CADDY_HOST_PORT=$EXPECTED_PORT but cloudflared routes to port $CURRENT_CLOUDFLARED_PORT"
  exit 1
fi
sudo cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
sudo systemctl restart cloudflared
```

Verify the new route and one existing tunnel:

```bash
curl -fsS https://app.clan-world.com/healthz | grep -q "^ok$" || { echo "ERROR: healthz did not return ok"; exit 1; }
curl -fsS -o /dev/null https://cockpit.clan-world.com
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
curl -fsS "http://127.0.0.1:${CADDY_HOST_PORT:-58731}/healthz" | grep -q "^ok$" || { echo "ERROR: healthz did not return ok"; exit 1; }
curl -fsS -o /dev/null "http://127.0.0.1:${CADDY_HOST_PORT:-58731}/elder-1/"
```

These checks prove Caddy is reachable and can attempt an elder route. Full ttyd
validation requires the full stack up and a follow-up Playwright or `websocat`
smoke that verifies the WebSocket upgrade and terminal output.

### Healthcheck Scope

The compose `caddy` healthcheck only proves that Caddy itself responds on
`/healthz`. It does not prove that `CLAN_WORLD_WEB_UPSTREAM` is reachable, that
the elder services are running, or that ttyd WebSocket upgrades work. Operators
must run the smoke commands after compose up for route-level validation.
