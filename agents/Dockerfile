# syntax=docker/dockerfile:1.7
#
# clan-world/agent:dev — per-elder container image
#
# Phase 1.2 of docs/plans/dockerize-elder-infra-v1.md
# Implements: GitHub issue clan-world/clan-world-game#345
#
# Layout note: the agents/shared/* tree (run.sh, home-claude/, elder-bootstrap/)
# is NOT baked into the image — it is bind-mounted at runtime at
# /opt/clan-world/shared. Entrypoint scripts, the real elder CLI workspace, and
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

# Claude Code CLI + Codex CLI + tsx installed globally so every user (incl. elder UID 1000)
# can invoke them off PATH. tsx is required by elder-runtime (Phase 1.9, issue #352).
RUN npm install -g @anthropic-ai/claude-code @openai/codex tsx \
    && npm cache clean --force

# MemWal MCP server — Walrus episodic memory (issue #692, follow-up to PR1 #666).
# Pinned to 0.0.5 (the version proven in the mainnet round-trip). The package's
# "bin" field exposes `memwal-mcp` (dist/bin/memwal-mcp.js); the global install
# drops it on PATH at $(npm bin -g). Symlink into /usr/local/bin/memwal-mcp so it
# matches the path that agents/shared/elder-mcp.json + run.sh's env-guard expect.
# The Elder runtime only launches it when MEMWAL_MCP_ENABLED=true AND this binary
# is executable (see agents/shared/run.sh), so a build that ever skipped this
# layer still boots cleanly via the elder-only MCP config.
RUN npm install -g @mysten-incubation/memwal-mcp@0.0.5 \
    && ln -sf "$(npm root -g)/@mysten-incubation/memwal-mcp/dist/bin/memwal-mcp.js" /usr/local/bin/memwal-mcp \
    && chmod 0755 /usr/local/bin/memwal-mcp \
    && test -x /usr/local/bin/memwal-mcp \
    && npm cache clean --force

# pnpm workspace support for the real @clan-world/agents CLI. Keep pnpm pinned
# to the root packageManager version so lockfile installs are reproducible.
RUN corepack enable \
    && corepack prepare pnpm@10.33.2 --activate

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
    && mkdir -p /home/elder/.claude \
      /home/elder/.runner-state \
      /home/elder/.world/clanworld-runner/state/peer-inbox \
      /workspace \
      /opt/clan-world \
      /opt/clan-world-cli \
    && chown -R elder:elder /home/elder /workspace

# Real elder CLI + MCP server. This package intentionally runs TypeScript
# source through tsx at runtime; package build is a no-op.
COPY --chown=root:root package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json /opt/clan-world-cli/
COPY --chown=root:root packages/agents/         /opt/clan-world-cli/packages/agents/
COPY --chown=root:root packages/shared/         /opt/clan-world-cli/packages/shared/
COPY --chown=root:root packages/sdk/            /opt/clan-world-cli/packages/sdk/
COPY --chown=root:root packages/contract-types/ /opt/clan-world-cli/packages/contract-types/
COPY --chown=root:root packages/contracts/      /opt/clan-world-cli/packages/contracts/
RUN cd /opt/clan-world-cli \
    && pnpm install --prod --filter @clan-world/agents... --frozen-lockfile \
    && pnpm store prune \
    && chown -R elder:elder /opt/clan-world-cli

# Entrypoint scripts. init-firewall.sh requires CAP_NET_ADMIN; it runs via
# sudo with a strict allowlist (see /etc/sudoers.d/elder-firewall).
COPY --chmod=755 agents/entrypoint.sh    /opt/clan-world/entrypoint.sh
COPY --chmod=755 agents/init-firewall.sh /opt/clan-world/init-firewall.sh
COPY --chmod=755 agents/elder-cli-wrapper /usr/local/bin/elder
COPY --chmod=755 agents/elder-mcp-wrapper /usr/local/bin/elder-mcp

# Sudoers rule: elder may run init-firewall.sh as root, no password, no other commands.
# /etc/sudoers.d/* files must be chmod 0440.
RUN echo "elder ALL=(root) NOPASSWD: /opt/clan-world/init-firewall.sh" > /etc/sudoers.d/elder-firewall \
    && chmod 0440 /etc/sudoers.d/elder-firewall

# elder-runtime supervisor (Phase 1.9, issue #352).
# Copy source + install deps as root so node_modules land in /opt/elder-runtime/node_modules
# and are readable by the elder user. tsx resolves imports from this directory at runtime.
COPY --chown=root:root packages/runner/ /opt/elder-runtime/
RUN cd /opt/elder-runtime && npm install --omit=dev \
    && chown -R elder:elder /opt/elder-runtime

# Python hook deps. We own this container's Python environment, so
# --break-system-packages is acceptable as the Debian PEP 668 workaround.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
    && rm -rf /var/lib/apt/lists/*
COPY agents/shared/home-claude/hooks/requirements.txt /tmp/hook-requirements.txt
RUN pip install --no-cache-dir --require-hashes --break-system-packages -r /tmp/hook-requirements.txt

USER elder
WORKDIR /workspace

ENV HOME=/home/elder
ENV CLAUDE_CONFIG_DIR=/home/elder/.claude
ENV CLAN_WORLD_REPO=/opt/clan-world-cli
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Healthcheck — v1 elder claude process alive. entrypoint.sh / run.sh also
# start ttyd, tmux, and the elder-runtime supervisor; compose-level healthchecks
# on each elder-N service verify those process/port details.
#
# `pgrep claude` (without -f) matches by comm name only, so the healthcheck's
# own shell command line doesn't self-match — `pgrep -f 'claude --'` would
# false-positive because the pattern appears in /bin/sh -c "pgrep -f 'claude --'..."
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD pgrep -x claude >/dev/null || exit 1

# tini = PID 1; reaps zombies and forwards signals to entrypoint.sh, which
# applies the firewall and execs run.sh from the bind-mounted shared tree.
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/clan-world/entrypoint.sh"]
