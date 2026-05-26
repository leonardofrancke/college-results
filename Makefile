PROD_DIR     = /var/local/docker/leo-app
STAGING_DIR  = /var/local/docker/leo-app-staging
RSYNC_OPTS   = -av --exclude='db/' --exclude='node_modules/' --exclude='.git/' --exclude='deploy/'

.PHONY: deploy-prod deploy-staging up-prod up-staging install

deploy-prod: ## Rsync source to prod and restart container
	rsync $(RSYNC_OPTS) . $(PROD_DIR)/
	cd deploy/prod && sudo docker compose restart

deploy-staging: ## Rsync source to staging and restart container
	rsync $(RSYNC_OPTS) . $(STAGING_DIR)/
	cd deploy/staging && sudo docker compose restart

up-prod: ## Build image and launch prod (first run or after Dockerfile changes)
	mkdir -p $(PROD_DIR)/html $(PROD_DIR)/api $(PROD_DIR)/db
	rsync $(RSYNC_OPTS) . $(PROD_DIR)/
	cd deploy/prod && sudo docker compose up -d --build

up-staging: ## Build image and launch staging (first run or after Dockerfile changes)
	mkdir -p $(STAGING_DIR)/html $(STAGING_DIR)/api $(STAGING_DIR)/db
	rsync $(RSYNC_OPTS) . $(STAGING_DIR)/
	cd deploy/staging && sudo docker compose up -d --build

install: deploy-prod ## Alias for deploy-prod (backwards compat)

# Dev environment
up-dev: ## Build image and launch dev (first run or after Dockerfile changes)
	mkdir -p /var/local/docker/leo-app/dev/db
	rsync $(RSYNC_OPTS) . /var/local/docker/leo-app/
	cd deploy/dev && sudo docker compose up -d --build

deploy-dev: ## Rsync source to dev and restart container
	rsync $(RSYNC_OPTS) . /var/local/docker/leo-app/
	cd deploy/dev && sudo docker compose restart

# Promote staging → prod (blue/green cutover)
promote: ## Move staging container to prod
	@echo "Promoting staging → prod..."
	sudo docker compose -f deploy/staging/docker-compose.yml stop leo-app-staging || true
	sudo docker compose -f deploy/prod/docker-compose.yml stop leo-app || true
	sudo docker rename leo-app-staging leo-app
	sudo docker compose -f deploy/prod/docker-compose.yml up -d
	@echo "✓ Staging promoted to prod"

.PHONY: up-dev deploy-dev promote
