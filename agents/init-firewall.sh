#!/usr/bin/env bash
# Egress firewall for clan-world/agent:dev.
#
# Phase 1.2 of docs/plans/dockerize-elder-infra-v1.md.
# Modeled on https://github.com/anthropics/claude-code/blob/main/.devcontainer/init-firewall.sh
#
# Policy (round 3 / round 4 spec):
#   - Default DROP for OUTPUT and INPUT
#   - ACCEPT loopback
#   - ACCEPT ESTABLISHED, RELATED
#   - ACCEPT outbound to the Docker bridge networks (so we can reach
#     convex-backend, anvil-fork, caddy, heartbeat without per-IP rules)
#   - ACCEPT outbound DNS to /etc/resolv.conf nameservers + Docker embedded DNS
#   - ACCEPT outbound HTTPS (443) to the resolved IPs of:
#         api.anthropic.com, claude.ai, accounts.anthropic.com,
#         statsig.anthropic.com, sentry.io  (telemetry endpoints CC may hit)
#   - DROP everything else
#
# Runs as root via sudo NOPASSWD entry in /etc/sudoers.d/elder-firewall.

set -euo pipefail

log() { echo "[init-firewall] $*"; }

# Sanity: must run as root (sudo guarantees this; double-check).
if [[ "$(id -u)" -ne 0 ]]; then
  echo "[init-firewall] FATAL: must run as root" >&2
  exit 1
fi

# --- Flush existing rules and chains ----------------------------------------
log "flushing existing rules"
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X

# --- Default policy: DROP ----------------------------------------------------
log "setting default policy DROP"
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# --- Loopback ----------------------------------------------------------------
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# --- Established / Related --------------------------------------------------
iptables -A INPUT  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# --- Docker bridge networks (internal compose traffic) ----------------------
# Docker's user-defined networks live in 172.16.0.0/12 by default;
# user-defined bridges may also use 10.0.0.0/8. Allow both.
log "allowing Docker bridge networks (172.16.0.0/12, 10.0.0.0/8)"
iptables -A OUTPUT -d 172.16.0.0/12 -j ACCEPT
iptables -A OUTPUT -d 10.0.0.0/8    -j ACCEPT
iptables -A INPUT  -s 172.16.0.0/12 -j ACCEPT
iptables -A INPUT  -s 10.0.0.0/8    -j ACCEPT

# --- DNS ---------------------------------------------------------------------
# Docker embedded DNS lives at 127.0.0.11 (special — already covered by lo
# allow above, but be explicit). Plus resolv.conf nameservers.
log "allowing DNS"
iptables -A OUTPUT -p udp -d 127.0.0.11 --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp -d 127.0.0.11 --dport 53 -j ACCEPT

if [[ -r /etc/resolv.conf ]]; then
  while read -r ns; do
    [[ -z "$ns" ]] && continue
    log "  allowing DNS nameserver $ns"
    iptables -A OUTPUT -p udp -d "$ns" --dport 53 -j ACCEPT
    iptables -A OUTPUT -p tcp -d "$ns" --dport 53 -j ACCEPT
  done < <(awk '/^nameserver/ {print $2}' /etc/resolv.conf)
fi

# --- Allowed external hosts (HTTPS only) ------------------------------------
ALLOWED_HOSTS=(
  api.anthropic.com
  claude.ai
  console.anthropic.com
  accounts.anthropic.com
  statsig.anthropic.com
  sentry.io
)

log "resolving and allowing HTTPS to allowed hosts"
for host in "${ALLOWED_HOSTS[@]}"; do
  # `getent ahosts` returns both A and AAAA; we only handle IPv4 for now
  # (Docker default networks are v4-only). Multiple A records iterate.
  if ! ips=$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u); then
    log "  WARN: failed to resolve $host — skipping"
    continue
  fi
  if [[ -z "$ips" ]]; then
    log "  WARN: no A records for $host — skipping"
    continue
  fi
  while read -r ip; do
    [[ -z "$ip" ]] && continue
    log "  allow https://$host ($ip)"
    iptables -A OUTPUT -p tcp -d "$ip" --dport 443 -j ACCEPT
  done <<< "$ips"
done

# --- Final state ------------------------------------------------------------
log "firewall applied. Active OUTPUT rules:"
iptables -L OUTPUT -n -v --line-numbers

log "done"
