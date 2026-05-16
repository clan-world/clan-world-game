# syntax=docker/dockerfile:1.7
#
# clan-world/agent:dev — per-elder container image
#
# Phase 1.2 of docs/plans/dockerize-elder-infra-v1.md
# Implements: GitHub issue clan-world/clan-world-game#345
#
# Layout note: the agents/shared/* tree (run.sh, home-claude/, elder-bootstrap/)
# is NOT baked into the image — it is bind-mounted at runtime at
# /opt/clan-world/shared. Only the entrypoint scripts + elder CLI stub +
# sudoers rule live in the image.

FROM node:24-slim

# Build args
ARG ELDER_UID=1000
ARG ELDER_GID=1000

# System deps — tmux for shell multiplexing, iptables/sudo for the egress
# firewall, foundry's cast prerequisites (curl/bash), tini for PID 1.
# Note: ttyd is NOT in Debian Bookworm; installed from GitHub release below.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tmux \
      ca-certificates \
      curl \
      jq \
      iptables \
      tini \
      sudo \
      bash \
      git \
      dnsutils \
      iproute2 \
      procps \
    && rm -rf /var/lib/apt/lists/*

# ttyd — Debian Bookworm has no package, pull the static x86_64 binary.
# Pinned to 1.7.7 (latest as of 2026-05-16); bump intentionally.
ARG TTYD_VERSION=1.7.7
RUN curl -fsSL -o /usr/local/bin/ttyd \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64" \
    && chmod 0755 /usr/local/bin/ttyd \
    && /usr/local/bin/ttyd --version

# Claude Code CLI + Codex CLI installed globally so every user (incl. elder UID 1000)
# can invoke them off PATH.
RUN npm install -g @anthropic-ai/claude-code @openai/codex \
    && npm cache clean --force

# Foundry (cast only — elder CLI's chain reads use it). Install into a system
# location rather than root's home so the elder user can find the binary
# without an extra PATH dance.
RUN curl -L https://foundry.paradigm.xyz | bash \
    && /root/.foundry/bin/foundryup \
    && mv /root/.foundry/bin/cast /usr/local/bin/cast \
    && mv /root/.foundry/bin/forge /usr/local/bin/forge \
    && mv /root/.foundry/bin/anvil /usr/local/bin/anvil \
    && mv /root/.foundry/bin/chisel /usr/local/bin/chisel \
    && rm -rf /root/.foundry

# Non-root user. UID 1000 keeps host file ownership sane for bind-mounted volumes.
# node:24-slim ships a `node` user/group at UID/GID 1000; we remove it and
# replace with `elder` at the same UID/GID so semantics are unchanged.
RUN userdel -r node 2>/dev/null || true \
    && groupadd -g ${ELDER_GID} elder \
    && useradd -m -u ${ELDER_UID} -g ${ELDER_GID} -s /bin/bash elder \
    && mkdir -p /home/elder/.claude /workspace /opt/clan-world \
    && chown -R elder:elder /home/elder /workspace

# Entrypoint scripts. init-firewall.sh requires CAP_NET_ADMIN; it runs via
# sudo with a strict allowlist (see /etc/sudoers.d/elder-firewall).
COPY --chmod=755 entrypoint.sh    /opt/clan-world/entrypoint.sh
COPY --chmod=755 init-firewall.sh /opt/clan-world/init-firewall.sh
COPY --chmod=755 elder            /usr/local/bin/elder

# Sudoers rule: elder may run init-firewall.sh as root, no password, no other commands.
# /etc/sudoers.d/* files must be chmod 0440.
RUN echo "elder ALL=(root) NOPASSWD: /opt/clan-world/init-firewall.sh" > /etc/sudoers.d/elder-firewall \
    && chmod 0440 /etc/sudoers.d/elder-firewall

USER elder
WORKDIR /workspace

ENV HOME=/home/elder
ENV CLAUDE_CONFIG_DIR=/home/elder/.claude
ENV PATH=/usr/local/bin:/usr/bin:/bin

# Healthcheck — tmux daemon alive AND ttyd accepting connections on 7681.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD pgrep -f tmux >/dev/null && curl -sf http://localhost:7681 >/dev/null || exit 1

# tini = PID 1; reaps zombies and forwards signals to entrypoint.sh, which
# applies the firewall and execs run.sh from the bind-mounted shared tree.
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/clan-world/entrypoint.sh"]
