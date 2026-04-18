# Deployment Runbook

This repo deploys via GitHub Actions using AWS OIDC (recommended) and AWS Secrets Manager.

## Prerequisites

- AWS account with EKS/ECR/IAM set up
- GitHub repo admin access to configure Secrets and (optional) Environments
- Terraform applied for the target environment (staging / production)

## Required GitHub Secrets

Set these in GitHub: Settings → Secrets and variables → Actions → Secrets.

- `AWS_ACCOUNT_ID`
- `AWS_REGION`
- `AWS_ROLE_ARN` (OIDC role for staging deploys)
- `AWS_PROD_DEPLOY_ROLE_ARN` (OIDC role for production deploys)
- `CODECOV_TOKEN` (optional)
- `SNYK_TOKEN` (optional)
- `GITLEAKS_LICENSE` (optional)
- `SLACK_ENGINEERING_WEBHOOK` (optional)

## AWS Secrets Manager

Create secrets per environment:

- `/ahava/staging/jwt-private-key`
- `/ahava/staging/jwt-public-key`
- `/ahava/staging/pii-encryption-key`
- `/ahava/staging/hash-salt`
- `/ahava/production/jwt-private-key`
- `/ahava/production/jwt-public-key`
- `/ahava/production/pii-encryption-key`
- `/ahava/production/hash-salt`

## GitHub Environments (Optional)

If you want manual approvals:

- Create environments: `staging`, `production`
- Add required reviewers for `production`

## Deployment Flow

### Staging

- Push to branch: `staging`
- GitHub Actions runs build + tests + deploy jobs

### Production

- Push to branch: `main`
- GitHub Actions runs build + tests + deploy jobs

## Local Pre-Deploy Checks

From `repo-main`:

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

Integration smoke (Docker):

```bash
npm run integration:up
npm run dev
npm run integration:smoke
npm run integration:down
```
