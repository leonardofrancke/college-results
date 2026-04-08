PROD_DIR     = /var/local/docker/leo-app/prod
STAGING_DIR  = /var/local/docker/leo-app/staging
DEV_DIR      = /var/local/docker/leo-app/dev
RSYNC_OPTS   = -av --exclude='db/' --exclude='node_modules/' --exclude='.git/' --exclude='deploy/'

.PHONY: deploy-prod deploy-staging deploy-dev up-prod up-staging up-dev install promote

deploy-prod:
	rsync $(RSYNC_OPTS) . $(PROD_DIR)/
	cd deploy/prod && sudo docker compose restart

deploy-staging:
	rsync $(RSYNC_OPTS) . $(STAGING_DIR)/
	cd deploy/staging && sudo docker compose restart

deploy-dev:
	rsync $(RSYNC_OPTS) . $(DEV_DIR)/
	cd deploy/dev && sudo docker compose restart

up-prod:
	mkdir -p $(PROD_DIR)/db
	rsync $(RSYNC_OPTS) . $(PROD_DIR)/
	cd deploy/prod && sudo docker compose up -d --build

up-staging:
	mkdir -p $(STAGING_DIR)/db
	rsync $(RSYNC_OPTS) . $(STAGING_DIR)/
	cd deploy/staging && sudo docker compose up -d --build

up-dev:
	mkdir -p $(DEV_DIR)/db
	rsync $(RSYNC_OPTS) . $(DEV_DIR)/
	cd deploy/dev && sudo docker compose up -d --build

promote:
	@echo "Promoting staging → prod..."
	@echo "  Copying staging data to prod..."
	sudo cp -r $(STAGING_DIR)/db/* $(PROD_DIR)/db/ 2>/dev/null || true
	@echo "  Stopping and removing old containers..."
	sudo docker stop leo-app 2>/dev/null || true
	sudo docker stop leo-app-staging 2>/dev/null || true
	sudo docker rm -f leo-app 2>/dev/null || true
	sudo docker rm -f leo-app-staging 2>/dev/null || true
	@echo "  Recreating prod container with staging code..."
	cd deploy/prod && sudo docker compose up -d --build
	@echo "✓ Staging promoted to prod (port 37461)"

install: deploy-prod
