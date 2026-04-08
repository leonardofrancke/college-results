DEPLOY_DIR = $(HOME)/deploy/leo-app
CONTAINER  = leo-app

.PHONY: install restart pull

install: ## Copy source to deploy dir and restart container
	rsync -av --exclude='db/' --exclude='node_modules/' --exclude='.git/' . $(DEPLOY_DIR)/
	sudo docker restart $(CONTAINER)

restart: ## Restart container only
	sudo docker restart $(CONTAINER)

pull: ## Pull latest from git, then deploy
	git pull
	$(MAKE) install
