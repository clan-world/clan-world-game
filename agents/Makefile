# agents/Makefile - ClanWorld Elder Infrastructure operator entrypoint
#
# Issue #355 (Phase 1.12). Codifies operator-facing lifecycle, bootstrap,
# wipe, and smoke-test targets for the dockerized elder stack. The compose
# project name is `clan-world` (declared in docker-compose.yml), so volumes
# created by compose are prefixed `clan-world_*`.
#
# PROFILE is REQUIRED on every state-mutating target. No default - fail loud.
# On the VPS, almost certainly PROFILE=prod.
#
# Run from the repo root: `make -C agents <target> PROFILE=dev|prod`
# Or `cd agents && make <target> PROFILE=...`
#
# All paths in compose-volume names + secrets files are relative to the
# REPO ROOT (the parent of this Makefile), because docker-compose.yml lives
# at the repo root and `docker compose` is invoked from there.

SHELL := /usr/bin/env bash

REPO_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/..)
COMPOSE   := docker compose
DC        := cd $(REPO_ROOT) && $(COMPOSE)

ELDERS := elder-1 elder-2 elder-3 elder-4
ELDER_NUMS := 1 2 3 4

PROFILE ?=
LEVEL ?= session

CONVEX_CLI_PINNED_VERSION ?= 1.39.1
CONVEX_SELF_HOSTED_ADMIN_KEY_FILE ?= agents/secrets/convex-admin.key
WEBHOOK_SHARED_SECRET_FILE ?= agents/secrets/webhook-shared.key
BUS_OPERATOR_SECRET_FILE ?= agents/secrets/bus-operator.key
BUS_ELDER_SECRET_FILE_1 ?= agents/secrets/bus-elder-1.key
BUS_ELDER_SECRET_FILE_2 ?= agents/secrets/bus-elder-2.key
BUS_ELDER_SECRET_FILE_3 ?= agents/secrets/bus-elder-3.key
BUS_ELDER_SECRET_FILE_4 ?= agents/secrets/bus-elder-4.key

.PHONY: help \
        check-profile confirm-banner setup \
        up down status logs \
        pause unpause \
        pause-heartbeat unpause-heartbeat \
        reset-anvil \
        link-mounts \
        bootstrap-convex-admin-key bootstrap-bus-secrets bootstrap-convex-dashboard-auth \
        oauth-bootstrap \
        smoke-test build FORCE

FORCE:

help:
	@echo "ClanWorld Elder Infrastructure - agents/Makefile"
	@echo ""
	@echo "USAGE"
	@echo "  make <target> PROFILE=dev|prod"
	@echo ""
	@echo "  PROFILE is required for compose lifecycle targets: setup, up, build,"
	@echo "  reset-anvil, and any target that starts/restarts profile-scoped services."
	@echo "  On the VPS, use PROFILE=prod unless intentionally operating dev."
	@echo ""
	@echo "LIFECYCLE"
	@echo "  setup PROFILE=...              One-time bring-up: bootstrap secrets + secret dirs"
	@echo "  up PROFILE=...                 docker compose --profile <P> up -d (with confirmation banner)"
	@echo "  down                           docker compose down (idempotent; no profile required)"
	@echo "  status                         compose ps + per-elder tmux/supervisor health"
	@echo "  logs ELDER=elder-2             tail one service"
	@echo ""
	@echo "PAUSE / RESUME"
	@echo "  pause-elder-2                  SIGSTOP elder-runtime supervisor inside elder-2"
	@echo "  unpause-elder-2                SIGCONT elder-runtime supervisor"
	@echo "  pause                          fan-out SIGSTOP across all elders"
	@echo "  unpause                        fan-out SIGCONT across all elders"
	@echo "  pause-heartbeat                stop heartbeat service (coexist window)"
	@echo "  unpause-heartbeat              start heartbeat service"
	@echo ""
	@echo "RESET / WIPE"
	@echo "  reset-elder-3                  soft reset: kill tmux session, restart container"
	@echo "  restart-elder-3                full container restart (no wipe)"
	@echo "  wipe-elder-3 LEVEL=workspace   clear /workspace/* only, keep ~/.claude"
	@echo "  wipe-elder-3 LEVEL=session     clear /workspace/* + ~/.claude/projects"
	@echo "  wipe-elder-3 LEVEL=full        destroy named volumes; oauth-bootstrap required after"
	@echo "  reset-anvil PROFILE=dev        wipe anvil fork state + restart (dev only)"
	@echo ""
	@echo "BOOTSTRAP (one-time per stack - re-run with FORCE=1 to overwrite)"
	@echo "  bootstrap-convex-admin-key     generate + persist Convex admin key (chmod 0600)"
	@echo "  bootstrap-bus-secrets          generate bus/webhook secrets and set Convex BUS_* envs"
	@echo "  bootstrap-convex-dashboard-auth generate reserved dashboard auth credentials"
	@echo "  oauth-bootstrap                walk every elder through OAuth flow"
	@echo "  oauth-bootstrap-elder-1        single-elder OAuth flow"
	@echo ""
	@echo "DEV HELPERS"
	@echo "  link-mounts                    snapshot named-volume contents into agents/.docker-mounts/"
	@echo "  smoke-test                     run end-to-end stack health check (bin/check-stack-health.sh)"
	@echo "  build                          docker compose build for the selected profile"

check-profile:
	@if [ -z "$(PROFILE)" ]; then \
		echo "ERROR: PROFILE=dev|prod required. On VPS, almost certainly PROFILE=prod." >&2; \
		exit 1; \
	fi
	@if [ "$(PROFILE)" != "dev" ] && [ "$(PROFILE)" != "prod" ]; then \
		echo "ERROR: PROFILE must be dev or prod (got: $(PROFILE))" >&2; \
		exit 1; \
	fi

confirm-banner: check-profile
	@echo "===================================="
	@echo " ClanWorld stack bring-up"
	@echo " PROFILE:        $(PROFILE)"
	@echo " CHAIN_NETWORK:  $${CHAIN_NETWORK:-<unset>}"
	@if [ "$(PROFILE)" = "dev" ]; then \
		echo " RPC URL:        $${DEV_RPC_URL:-<unset - anvil-fork will be used>}"; \
	else \
		echo " RPC URL:        $${RPC_URL_PRIMARY:-<unset - bring-up WILL fail>}"; \
	fi
	@echo " Contract:       $${CLAN_WORLD_CONTRACT_ADDRESS:-<unset>}"
	@echo " Convex:         $${CONVEX_SELF_HOSTED_URL:-http://127.0.0.1:$${CONVEX_BACKEND_HOST_PORT:-3210}}"
	@echo "===================================="

setup: check-profile
	@echo "[setup] bootstrapping ClanWorld stack for PROFILE=$(PROFILE)"
	@mkdir -p $(REPO_ROOT)/agents/secrets
	@chmod 0700 $(REPO_ROOT)/agents/secrets
	$(MAKE) bootstrap-convex-admin-key PROFILE=$(PROFILE) FORCE=$(FORCE)
	$(MAKE) bootstrap-bus-secrets PROFILE=$(PROFILE) FORCE=$(FORCE)
	@echo "[setup] done."
	@echo "[setup] Next:"
	@echo "  1. make oauth-bootstrap                  # per-elder OAuth credentials"
	@echo "  2. make up PROFILE=$(PROFILE)            # spin up the stack"
	@echo "  3. make smoke-test                       # verify all green"

up: confirm-banner
	$(DC) --profile $(PROFILE) up -d

down:
	$(DC) down

status: check-profile
	@$(DC) --profile $(PROFILE) ps
	@echo "---"
	@for e in $(ELDERS); do \
		$(DC) --profile $(PROFILE) ps $$e; \
		echo -n "$$e tmux:       "; \
		if $(DC) --profile $(PROFILE) exec -T $$e tmux has-session -t $$e 2>/dev/null; then \
			echo OK; \
		else \
			echo "WARN session missing"; \
		fi; \
		echo -n "$$e supervisor: "; \
		$(DC) --profile $(PROFILE) exec -T $$e pgrep -f 'tsx.*elder-runtime/src/main.ts' > /dev/null 2>&1 \
			&& echo OK || echo DEAD; \
	done

logs:
	@if [ -z "$(ELDER)" ]; then \
		echo "ERROR: ELDER=<service-name> required (e.g. ELDER=elder-2 or ELDER=heartbeat)" >&2; \
		exit 1; \
	fi
	$(DC) logs -f $(ELDER)

pause-elder-%: FORCE
	@PID=$$($(DC) exec -T elder-$* pgrep -f 'tsx.*elder-runtime/src/main.ts' 2>/dev/null | head -1); \
	if [ -z "$$PID" ]; then \
		echo "[pause-elder-$*] no supervisor process running - already paused or stopped"; \
	else \
		$(DC) exec -T elder-$* kill -STOP "$$PID" && echo "[pause-elder-$*] SIGSTOP sent to PID $$PID"; \
	fi

unpause-elder-%: FORCE
	@PID=$$($(DC) exec -T elder-$* pgrep -f 'tsx.*elder-runtime/src/main.ts' 2>/dev/null | head -1); \
	if [ -z "$$PID" ]; then \
		echo "[unpause-elder-$*] no supervisor process running - already unpaused or stopped"; \
	else \
		$(DC) exec -T elder-$* kill -CONT "$$PID" && echo "[unpause-elder-$*] SIGCONT sent to PID $$PID"; \
	fi

pause:
	@for n in $(ELDER_NUMS); do $(MAKE) pause-elder-$$n || true; done

unpause:
	@for n in $(ELDER_NUMS); do $(MAKE) unpause-elder-$$n || true; done

pause-heartbeat: check-profile
	$(DC) --profile $(PROFILE) stop heartbeat

unpause-heartbeat: check-profile
	$(DC) --profile $(PROFILE) start heartbeat

reset-%: FORCE check-profile
	-$(DC) exec -T $* tmux kill-session -t $* 2>/dev/null || true
	$(DC) --profile $(PROFILE) up -d --force-recreate $*

restart-%: FORCE check-profile
	$(DC) --profile $(PROFILE) restart $*

wipe-%: FORCE check-profile
	@if [ "$(LEVEL)" = "workspace" ]; then \
		echo "[wipe] $* LEVEL=workspace - clearing /workspace/*"; \
		$(DC) exec -T $* sh -c 'rm -rf /workspace/*' || exit 1; \
		$(MAKE) reset-$* PROFILE=$(PROFILE); \
	elif [ "$(LEVEL)" = "session" ]; then \
		echo "[wipe] $* LEVEL=session - clearing /workspace/* + ~/.claude/projects"; \
		$(DC) exec -T $* sh -c 'rm -rf /home/elder/.claude/projects /workspace/*' || exit 1; \
		$(DC) exec -T $* sh -c 'if [ -f /opt/clan-world/shared/elder-bootstrap/workspace-CLAUDE.md ]; then cp /opt/clan-world/shared/elder-bootstrap/workspace-CLAUDE.md /workspace/CLAUDE.md; fi' || true; \
		$(DC) exec -T $* sh -c 'if [ -f /opt/clan-world/shared/elder-bootstrap/workspace-ANCIENT_WISDOM.md ]; then cp /opt/clan-world/shared/elder-bootstrap/workspace-ANCIENT_WISDOM.md /workspace/ANCIENT_WISDOM.md; fi' || true; \
		$(MAKE) reset-$* PROFILE=$(PROFILE); \
	elif [ "$(LEVEL)" = "full" ]; then \
		echo "[wipe] $* LEVEL=full - destroying named volumes (compose project: clan-world)"; \
		$(DC) --profile $(PROFILE) stop $* || true; \
		$(DC) --profile $(PROFILE) rm -f $* || true; \
		docker volume rm clan-world_$*-home clan-world_$*-workspace 2>/dev/null || true; \
		echo "[wipe] $* FULL WIPE done."; \
		echo "[wipe] NEXT: run \`make oauth-bootstrap-$*\` BEFORE \`make up\`; volumes will be recreated empty."; \
	else \
		echo "ERROR: LEVEL must be workspace, session, or full (got: $(LEVEL))" >&2; \
		exit 1; \
	fi

reset-anvil: check-profile
	@if [ "$(PROFILE)" != "dev" ]; then \
		echo "ERROR: reset-anvil is dev-only (PROFILE=dev)" >&2; \
		exit 1; \
	fi
	$(DC) --profile dev stop anvil-fork
	-docker volume rm clan-world_anvil_data 2>/dev/null || true
	$(DC) --profile dev up -d anvil-fork

link-mounts:
	@mkdir -p $(REPO_ROOT)/agents/.docker-mounts
	@for e in $(ELDERS); do \
		echo "[link-mounts] snapshotting $$e-workspace + $$e-home"; \
		docker run --rm \
			-v clan-world_$$e-workspace:/src-workspace:ro \
			-v clan-world_$$e-home:/src-home:ro \
			-v $(REPO_ROOT)/agents/.docker-mounts:/dst \
			busybox sh -c "\
				rm -rf /dst/$$e-workspace /dst/$$e-home && \
				cp -a /src-workspace /dst/$$e-workspace && \
				cp -a /src-home /dst/$$e-home && \
				chown -R $$(id -u):$$(id -g) /dst/$$e-workspace /dst/$$e-home \
			" || echo "[link-mounts] WARN: $$e snapshot skipped (volume may not exist yet)"; \
	done
	@echo "[link-mounts] snapshots at $(REPO_ROOT)/agents/.docker-mounts/"

bootstrap-convex-admin-key: check-profile
	$(MAKE) -C $(REPO_ROOT) bootstrap-convex-admin-key PROFILE=$(PROFILE) FORCE=$(FORCE) CONVEX_SELF_HOSTED_ADMIN_KEY_FILE="$(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE)"

bootstrap-bus-secrets:
	@set -euo pipefail; \
	resolve_path() { case "$$1" in /*) printf '%s\n' "$$1";; *) printf '%s/%s\n' "$(REPO_ROOT)" "$$1";; esac; }; \
	write_secret() { \
		name="$$1"; path="$$(resolve_path "$$2")"; \
		mkdir -p "$$(dirname "$$path")"; chmod 0700 "$$(dirname "$$path")"; \
		if [ -s "$$path" ] && [ "$(FORCE)" != "1" ]; then \
			echo "[bootstrap] $$path exists; skipping. Re-run with FORCE=1 to regenerate."; \
		else \
			openssl rand -hex 32 > "$$path"; chmod 0600 "$$path"; \
			echo "[bootstrap] $$name generated at $$path"; \
		fi; \
	}; \
	write_secret bus-operator "$(BUS_OPERATOR_SECRET_FILE)"; \
	write_secret webhook-shared "$(WEBHOOK_SHARED_SECRET_FILE)"; \
	write_secret bus-elder-1 "$(BUS_ELDER_SECRET_FILE_1)"; \
	write_secret bus-elder-2 "$(BUS_ELDER_SECRET_FILE_2)"; \
	write_secret bus-elder-3 "$(BUS_ELDER_SECRET_FILE_3)"; \
	write_secret bus-elder-4 "$(BUS_ELDER_SECRET_FILE_4)"; \
	admin_key_file="$$(resolve_path "$(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE)")"; \
	if [ ! -s "$$admin_key_file" ]; then \
		echo "ERROR: $$admin_key_file not found - run bootstrap-convex-admin-key first" >&2; \
		exit 1; \
	fi; \
	export CONVEX_SELF_HOSTED_ADMIN_KEY="$$(cat "$$admin_key_file")"; \
	export CONVEX_SELF_HOSTED_URL="$${CONVEX_SELF_HOSTED_URL:-http://127.0.0.1:$${CONVEX_BACKEND_HOST_PORT:-3210}}"; \
	unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY; \
	npx -y convex@$(CONVEX_CLI_PINNED_VERSION) env set BUS_OPERATOR_SECRET "$$(cat "$$(resolve_path "$(BUS_OPERATOR_SECRET_FILE)")")"; \
	for n in 1 2 3 4; do \
		case "$$n" in \
			1) file="$(BUS_ELDER_SECRET_FILE_1)" ;; \
			2) file="$(BUS_ELDER_SECRET_FILE_2)" ;; \
			3) file="$(BUS_ELDER_SECRET_FILE_3)" ;; \
			4) file="$(BUS_ELDER_SECRET_FILE_4)" ;; \
		esac; \
		npx -y convex@$(CONVEX_CLI_PINNED_VERSION) env set BUS_ELDER_SECRET_$$n "$$(cat "$$(resolve_path "$$file")")"; \
	done; \
	npx -y convex@$(CONVEX_CLI_PINNED_VERSION) env set WEBHOOK_SHARED_SECRET "$$(cat "$$(resolve_path "$(WEBHOOK_SHARED_SECRET_FILE)")")"; \
	echo "[bootstrap] bus secrets injected into Convex env (BUS_OPERATOR_SECRET, BUS_ELDER_SECRET_1..4, WEBHOOK_SHARED_SECRET)."; \
	echo "[bootstrap] If a Convex env set failed partway through, rerun this target without FORCE=1."; \
	echo "[bootstrap] File generation is idempotent, and Convex env sets are independent."; \
	echo "[bootstrap] Verify all BUS_* and WEBHOOK_SHARED_SECRET values with: npx convex@$(CONVEX_CLI_PINNED_VERSION) env list"

# No current compose/Caddy consumer reads this JSON; it is reserved for future
# dashboard-local auth wiring. Do not pass password_sha512crypt to Caddy
# basicauth; Caddy would require a bcrypt hash from `caddy hash-password`.
bootstrap-convex-dashboard-auth:
	@mkdir -p $(REPO_ROOT)/agents/secrets
	@chmod 0700 $(REPO_ROOT)/agents/secrets
	@DEST=$(REPO_ROOT)/agents/secrets/convex-dashboard-auth.json; \
	if [ -s "$$DEST" ] && [ "$(FORCE)" != "1" ]; then \
		echo "[bootstrap] $$DEST exists; skipping. Re-run with FORCE=1 to regenerate."; \
		exit 0; \
	fi; \
	printf "Username: " >&2; \
	read u; \
	printf "Password: " >&2; \
	stty -echo 2>/dev/null || true; \
	read p; \
	stty echo 2>/dev/null || true; \
	echo >&2; \
	if [ -z "$$u" ] || [ -z "$$p" ]; then \
		echo "ERROR: username + password required" >&2; \
		exit 1; \
	fi; \
	SALT="$$(openssl rand -base64 16)"; \
	HASH=$$(printf '%s\n' "$$p" | openssl passwd -6 -stdin -salt "$$SALT" 2>/dev/null) || { echo "ERROR: openssl passwd -6 failed (LibreSSL not supported; install GNU openssl)" >&2; exit 1; }; \
	if [ -z "$$HASH" ]; then echo "ERROR: openssl passwd -6 returned empty hash" >&2; exit 1; fi; \
	printf '{"username":"%s","password_sha512crypt":"%s"}\n' "$$u" "$$HASH" > "$$DEST"; \
	chmod 0600 "$$DEST"; \
	echo "[bootstrap] convex-dashboard-auth.json saved to $$DEST"

oauth-bootstrap:
	@for n in 1 2 3 4; do $(MAKE) oauth-bootstrap-elder-$$n; done

oauth-bootstrap-%: FORCE
	@mkdir -p $(REPO_ROOT)/agents/$*
	@DEST=$(REPO_ROOT)/agents/$*/.env; \
	if [ -s "$$DEST" ] && [ "$(FORCE)" != "1" ]; then \
		echo "[oauth] $$DEST already populated; skipping. Re-run with FORCE=1 to overwrite."; \
		exit 0; \
	fi; \
	echo "[oauth] $* - paste CLAUDE_CODE_OAUTH_TOKEN (input hidden):" >&2; \
	stty -echo 2>/dev/null || true; \
	read token; \
	stty echo 2>/dev/null || true; \
	echo >&2; \
	if [ -z "$$token" ]; then \
		echo "ERROR: empty token" >&2; \
		exit 1; \
	fi; \
	CLAN_ID=$$(echo "$*" | sed 's/elder-//'); \
	{ \
		echo "# Generated by \`make oauth-bootstrap-$*\` - do not commit."; \
		echo "CLAUDE_CODE_OAUTH_TOKEN=$$token"; \
		echo "ELDER_ID=$*"; \
		echo "CLAN_ID=$$CLAN_ID"; \
	} > "$$DEST"; \
	chmod 0600 "$$DEST"; \
	echo "[oauth] $* credentials saved to $$DEST"

build: check-profile
	$(DC) --profile $(PROFILE) build

smoke-test:
	bash $(REPO_ROOT)/bin/check-stack-health.sh
