## Summary
<!-- Describe the purpose of this PR and what it changes. -->

## Checklist
### ✅ Code Quality
- [ ] Code compiles cleanly (`npm run build` / `turbo run build`)
- [ ] All unit tests pass (`npm run test` / `npm run test:coverage`)
- [ ] No new TypeScript errors or lint violations

### 🔐 Security & Secrets
- [ ] No secrets or credentials added to source (check `.env`, `secrets/`, `*.pem`, etc.)
- [ ] Git history was not polluted with secrets (run local secret scan if needed)
- [ ] CI secret scanners (Gitleaks + TruffleHog) pass on this branch

### 🧪 Testing / Behavior
- [ ] Core flows tested manually (e.g., register/login, create payment, etc.)
- [ ] Regression tests added (when applicable)

### 🧱 Deploy readiness
- [ ] Changes do not break deploy workflows for `develop` / `staging` / `main`
- [ ] Docker images build and push as expected (if applicable)

### 📄 Docs & Notes
- [ ] Relevant documentation updated (README, architecture docs, etc.)
- [ ] Any required environment variables / secrets documented (NOT committed)

---
> ⚠️ If you’re unsure whether a change might expose secrets, run `git log --stat` and/or use `gitleaks`/`trufflehog` locally before merging.
