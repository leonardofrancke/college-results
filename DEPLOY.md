# Deployment Guide

## Environments

| Env | Makefile Target | Container | Port |
|-----|----------------|-----------|------|
| Dev | `make deploy-dev` | `leo-app-dev` | 48392 |
| Staging | `make deploy-staging` | `leo-app-staging` | 58293 |
| Prod | `make deploy-prod` | `leo-app` | 37461 |

**Live site:** https://admissions.francke.com/
**Server:** `apps.jacksol.francke.com` (SSH passwordless via ed25519 key)

## Normal Deploy (code changes only)

```bash
make deploy-dev       # push to dev
make deploy-staging   # push to staging
make deploy-prod      # push to prod
```

Rsyncs source to the env directory on the server (excluding `db/`, `node_modules/`, `.git/`, `deploy/`), then restarts the container.

## After Dockerfile Changes

```bash
make up-dev
make up-staging
make up-prod
```

Rebuilds the Docker image and recreates the container.

## Promote Staging → Prod

```bash
make promote
```

## Server Paths

| Path | Purpose |
|------|---------|
| `~/projects/admission-stats/` | Source / git repo on server |
| `/var/local/docker/leo-app/{env}/html/` | Served HTML |
| `/var/local/docker/leo-app/{env}/api/server.js` | API |
| `/var/local/docker/leo-app/{env}/db/leo.db` | SQLite database |
| `/var/local/docker/leo-app/{env}/db/backups/` | DB backups (cron every 5 min) |

## Stack

- **Backend:** Node.js / Express (port 3001 inside container)
- **Proxy:** nginx
- **Process manager:** supervisord
- **Database:** SQLite
- **Container:** Single Docker image (managed via Portainer)
