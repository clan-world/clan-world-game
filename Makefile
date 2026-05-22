SHELL := /usr/bin/env bash

PROFILE ?= dev
CONVEX_SELF_HOSTED_ADMIN_KEY_FILE ?= agents/secrets/convex-admin.key

.PHONY: deploy-convex bootstrap-convex-admin-key import-convex-schema backup-convex check-stack-health reset-anvil

deploy-convex:
	bash bin/deploy-convex.sh

import-convex-schema:
	bash bin/import-convex-schema.sh

backup-convex:
	bash bin/backup-convex.sh

check-stack-health:
	bash bin/check-stack-health.sh

bootstrap-convex-admin-key:
	@mkdir -p "$(dir $(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE))"
	@if [[ -f "$(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE)" && "$(FORCE)" != "1" ]]; then \
	  echo "ERROR: $(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE) already exists. Use FORCE=1 to overwrite." >&2; \
	  exit 1; \
	fi
	docker compose --profile "$(PROFILE)" up -d convex-backend
	@for i in {1..30}; do \
	  if docker compose --profile "$(PROFILE)" exec -T convex-backend curl -fsS http://localhost:3210/version >/dev/null 2>&1; then \
	    break; \
	  fi; \
	  if [[ "$$i" == "30" ]]; then echo "ERROR: convex-backend did not become healthy" >&2; exit 1; fi; \
	  sleep 1; \
	done
	@if [[ "$(PROFILE)" == "dev" ]]; then \
	  docker compose --profile "$(PROFILE)" up -d convex-backend-dev-port; \
	fi
	@set -euo pipefail; \
	tmp="$$(mktemp)"; \
	trap 'rm -f "$$tmp"' EXIT; \
	docker compose --profile "$(PROFILE)" exec -T convex-backend ./generate_admin_key.sh > "$$tmp" && \
	if [[ ! -s "$$tmp" ]]; then \
	  echo "ERROR: Refused to write $(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE): generated admin key was empty" >&2; \
	  exit 1; \
	fi && \
	install -m 600 "$$tmp" "$(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE)" && \
	sha256sum "$(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE)" > "$(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE).sha256" && \
	echo "Wrote $(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE)" && \
	echo "Fingerprint: $$(awk '{print $$1}' "$(CONVEX_SELF_HOSTED_ADMIN_KEY_FILE).sha256")"

reset-anvil:
	@echo "WARNING: reset-anvil only removes clan-world_anvil_data."
	@echo "WARNING: NEVER remove clan-world_convex_data without running make backup-convex first;"
	@echo "         that volume contains the self-hosted Convex instance secret, admin-key root, and all data."
	docker compose --profile dev stop anvil-fork || true
	docker compose --profile dev rm -f anvil-fork || true
	docker volume rm clan-world_anvil_data || true
	docker compose --profile dev up -d anvil-fork
