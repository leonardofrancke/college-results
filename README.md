# College Admissions Stats

A web app for submitting and browsing college admissions results.

**Live site:** https://admissions.francke.com/

## Stack

- **Frontend:** HTML/CSS/JS
- **Backend:** Node.js / Express
- **Database:** SQLite
- **Infrastructure:** Docker (nginx + supervisord), deployed on a home server via Portainer

## Deployment

See [DEPLOY.md](DEPLOY.md) for full deployment instructions.

Quick reference:

```bash
make deploy-dev       # deploy to dev
make deploy-staging   # deploy to staging
make deploy-prod      # deploy to prod
make promote          # promote staging → prod
```
