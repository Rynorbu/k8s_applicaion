# Deployment

## 1. Local Kubernetes (kind)

```bash
kind create cluster --name spendwise
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.0/deploy/static/provider/kind/deploy.yaml

# Build and load images into the cluster
docker compose build
for img in $(docker images --format '{{.Repository}}' | grep '^spendwise/'); do kind load docker-image "$img:dev" --name spendwise; done

helm install spendwise kubernetes/helm/spendwise -n spendwise-dev --create-namespace \
  -f kubernetes/helm/spendwise/values-dev.yaml \
  --set secrets.values.jwtPrivateKey="$(grep JWT_PRIVATE_KEY .env | cut -d= -f2)"

kubectl -n spendwise-dev get pods -w
# http://spendwise.localtest.me  (resolves to 127.0.0.1)
```

Port-forward the tooling:

```bash
kubectl -n spendwise-dev port-forward svc/spendwise-grafana 3001:3000
kubectl -n spendwise-dev port-forward svc/spendwise-jaeger 16686
kubectl -n spendwise-dev port-forward svc/spendwise-rabbitmq 15672
```

## 2. GitOps with Argo CD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.13.2/manifests/install.yaml

# Point repoURL in kubernetes/argocd/*.yaml at your fork, then:
kubectl apply -n argocd -f kubernetes/argocd/project.yaml
kubectl apply -n argocd -f kubernetes/argocd/root-app.yaml
```

* `spendwise-dev` tracks `main` with automated sync, prune and self-heal.
* `spendwise-prod` tracks `main` using `values-prod.yaml`. On every successful pipeline, the CI `gitops-update` job writes the new immutable image tag (the commit SHA) into that file. Argo CD notices the commit and rolls out. Rolling back means `git revert`.
* HPA-managed `replicas` fields are ignored in the diff to avoid sync fights.

### Production secrets

`values-prod.yaml` sets `secrets.create: false`. Create the `spendwise-secrets` Secret out-of-band (Sealed Secrets or the External Secrets Operator) with these keys:

```
internal-api-token  jwt-private-key  service-db-password  postgres-password
rabbitmq-user  rabbitmq-password  redis-password  anthropic-api-key  smtp-password
```

## 3. What the chart deploys

| Resource | Notes |
|---|---|
| 17 service Deployments + Services | Startup, liveness and readiness probes; non-root; read-only root FS; preferred pod anti-affinity; Prometheus annotations; config checksum triggers a rollout |
| HPA (autoscaling/v2) | CPU and memory targets with a scale-down stabilisation window; disabled for the volume-backed report and file services |
| PodDisruptionBudgets | `minAvailable: 1` for every horizontally scaled service |
| ConfigMap + Secret | Shared configuration and credentials, referenced by key |
| PVCs | Report and file storage; Prometheus data; StatefulSet claims for Postgres and RabbitMQ |
| Ingress | `/api` and `/docs` route to the gateway, `/` to the frontend; TLS via cert-manager; body-size and RPS limits |
| NetworkPolicies | Default-deny ingress; intra-platform traffic allowed; only the ingress controller can reach the edge |
| Optional infrastructure | Postgres (database-per-service bootstrap), RabbitMQ, Redis, Mailpit |
| Optional observability | OTel Collector, Jaeger, Prometheus (Kubernetes service discovery with RBAC), Grafana with provisioned datasources and dashboard |

## 4. Operations

* **Migrations** run automatically at startup under a Postgres advisory lock. They are safe with many replicas and forward-only.
* **Dead letters:** inspect `<service>.events.dlq` in the RabbitMQ UI. After fixing the cause, shovel the messages back to `<service>.events`; consumers are idempotent, so replays are safe.
* **Scaling:** consumers scale with replicas (competing consumers). Bump `services.<name>.hpa.maxReplicas` for hot paths.
