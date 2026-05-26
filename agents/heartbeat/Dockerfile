FROM ghcr.io/foundry-rs/foundry:v1.2.0 AS foundry

# node:22-slim (Debian, glibc) chosen over node:22-alpine (musl) so cast —
# a glibc-linked Rust binary copied from the foundry image — runs without
# musl/glibc ABI mismatch (validated 2026-05-24 self-hosted Convex cutover:
# alpine + foundry cast → "/bin/sh: cast: not found" because musl's dynamic
# loader can't resolve the glibc ELF).
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.33.2 --activate

COPY --from=foundry /usr/local/bin/cast /usr/local/bin/cast
RUN cast --version

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/clan-world-mobile/package.json apps/clan-world-mobile/package.json
COPY apps/dev-ui/package.json apps/dev-ui/package.json
COPY apps/landing/package.json apps/landing/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/orchestrator/package.json apps/orchestrator/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/agents/package.json packages/agents/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contract-types/package.json packages/contract-types/package.json
COPY packages/heartbeat/package.json packages/heartbeat/package.json
COPY packages/runner/package.json packages/runner/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

# The @clan-world/heartbeat heartbeat script invokes tsx with
# --env-file=../../.env.local from packages/heartbeat. Compose supplies runtime
# env vars, but the file path still needs to exist in the image.
RUN touch .env.local \
  && chmod +x agents/heartbeat/entrypoint.sh

RUN chown -R node:node /app
USER node

ENTRYPOINT ["./agents/heartbeat/entrypoint.sh"]
