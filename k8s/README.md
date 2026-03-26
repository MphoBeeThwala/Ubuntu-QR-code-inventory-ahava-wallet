# Kubernetes Deployment (Kustomize)

## Canonical entrypoints

- Dev: `k8s/overlays/dev`
- Staging: `k8s/overlays/staging`
- Prod: `k8s/overlays/prod`

Each overlay:

- Sets the namespace (`ahava-dev`, `ahava-staging`, `ahava-prod`)
- References the shared base resources in `k8s/`
- Applies environment-specific image tags
- Includes ExternalSecrets resources to populate the `ahava-secrets` Kubernetes Secret per namespace

## Notes

- Avoid name prefixes for Deployments/Services in overlays, because internal service discovery relies on stable service names.
- Ingress certificate/WAF ARNs are patched per environment via `ingress-patch.yaml`.
