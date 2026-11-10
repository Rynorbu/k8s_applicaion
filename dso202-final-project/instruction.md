# SpendWise on Kubernetes: DSO202 Final Project Instructions

**Project:** Expense Tracker on Kubernetes (DSO202 Final Project)
**Group:** Ranjung Yeshi Norbu · Namgay Wangchuk · Khem Raj Ghalley · Yonten Kinley Tenzin
**Tutor:** Mr. Saroj Sanyasi

This guide takes the SpendWise microservices application from source code to a GitOps-managed, self-healing, auto-scaling, monitored deployment on a local **kind** cluster. Work through it from top to bottom. Every phase ends with a **✅ Check**, and those check outputs are your evidence for the report and the presentation.

| Assignment requirement | Where it is done |
|---|---|
| a. Helm charts | [Phase 4](#phase-4--understand-and-validate-the-helm-charts) · `charts/microservice`, `charts/platform`, `charts/monitoring-extras` |
| b. GitOps with Argo CD | [Phases 6–7](#phase-6--install-argo-cd) and [Phase 10](#phase-10--gitops-demonstrations) · `argocd/` |
| c. Monitoring (Prometheus, Grafana) | [Phase 11](#phase-11--monitoring-with-prometheus-and-grafana) · `monitoring/` |
| d. Auto-scaling on custom metrics | [Phase 12](#phase-12--auto-scaling-on-custom-metrics) · `monitoring/prometheus-adapter.values.yaml`, HPAs in `values/services/` |
| e. Application and infrastructure dashboards | [Phase 11.3](#113-the-three-spendwise-dashboards) · `charts/monitoring-extras/dashboards/` |
| High availability and capacity plan | [Section 13](#13-high-availability-and-capacity-plan) |

> **Out of scope, as agreed:** OpenTelemetry tracing and ELK/Loki logging. Tracing is switched off with `OTEL_SDK_DISABLED=true` in the shared ConfigMap. Use `kubectl logs` for logs.

---

## Contents

1. [Architecture](#1-architecture)
2. [How this matches the proposal](#2-how-this-matches-the-proposal)
3. [Folder layout](#3-folder-layout)
4. [Prerequisites](#4-prerequisites)
5. Phases 0–12: build, deploy, demonstrate
6. [High availability and capacity plan](#13-high-availability-and-capacity-plan)
7. [Troubleshooting](#14-troubleshooting)
8. [Presentation demo script](#15-presentation-demo-script-1012-minutes)
9. [Evidence checklist](#16-evidence-checklist-for-the-report)
10. [Clean-up](#17-clean-up)

---

## 1. Architecture

```text
                        Browser  http://spendwise.localtest.me:8000
                                   │
                    ┌──────────────▼──────────────┐  kind cluster "spendwise"
                    │  NGINX Ingress (control-plane│  1 control-plane + 2 workers
                    │  node, host port 8000 → 80)  │
                    └───────┬──────────────┬───────┘
                     /      │              │ /api
              ┌─────────────▼───┐   ┌──────▼──────────┐   HPA: CPU + http_requests_per_second
              │ frontend (x2)   │   │ api-gateway (x2-6)│◄──────────────────────────────┐
              └─────────────────┘   └──────┬──────────┘                                │
                                           │ REST (ClusterIP DNS)                       │
   ┌────────────┬────────────┬─────────────┼──────────────┬─────────────┬────────────┐ │
   ▼            ▼            ▼             ▼              ▼             ▼            ▼ │
 auth(x2)  user  expense(x2-8) income  category(x2)  budget  recurring  goal  analytics(x1-5)
 notification  report  search  currency  audit  ai  file          (17 Deployments in total)
   │                │                                     ▲        ▲ HPA: RabbitMQ queue depth
   │  each service owns ONE database      events          │        │
   ▼                                  ┌───────────────────┴──┐     │
 ┌──────────────────────────────┐     │ RabbitMQ StatefulSet │─────┘
 │ PostgreSQL StatefulSet + PVC │     │ + PVC (topic exchange │
 │ 16 databases, 16 login roles │     │  retries, DLQs)       │
 └──────────────────────────────┘     └──────────────────────┘   Redis · Mailpit

 ┌───────────────────────── namespace: monitoring ───────────────────────────┐
 │ Prometheus ◄── ServiceMonitors (17 services, postgres-exporter, rabbitmq)  │
 │     │           kube-state-metrics, node-exporter, kubelet/cAdvisor        │
 │     ├──► Grafana (3 SpendWise dashboards + built-in Kubernetes dashboards) │
 │     └──► prometheus-adapter ──► custom.metrics.k8s.io / external.metrics   │
 │                                         └──► HorizontalPodAutoscalers      │
 │ metrics-server (kube-system) ──► metrics.k8s.io (CPU/memory) ──► HPAs     │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌──────────── namespace: argocd ────────────┐
 │ spendwise-root (App of Apps)              │   GitHub repo (single source of truth)
 │  ├─ metrics-server        wave -3         │◄── dso202-final-project/argocd/apps/*.yaml
 │  ├─ monitoring (kube-prometheus-stack) -2 │◄── dso202-final-project/monitoring/*.values.yaml
 │  ├─ prometheus-adapter    wave -1         │
 │  ├─ monitoring-extras     wave -1         │◄── charts/monitoring-extras
 │  ├─ platform              wave  0         │◄── charts/platform + values/platform.yaml
 │  └─ spendwise-services (ApplicationSet) 1 │◄── charts/microservice + values/services/*.yaml
 │       └─ 18 Applications (17 services + frontend)
 └───────────────────────────────────────────┘
```

**How a request flows.** The browser calls the Ingress. `/api/...` goes to **api-gateway**, which checks the JWT, applies rate limits and forwards the call to the owning service, for example **expense-service**. That service writes to *its own* database and stores an `ExpenseCreated` event in an outbox table. The outbox relay publishes the event to **RabbitMQ**, which fans it out to budget, analytics, notification, ai and audit. Each consumer has its own queue with retries and a dead-letter queue.

---

## 2. How this matches the proposal

| Proposal objective | Implementation | Status |
|---|---|---|
| O1: each microservice runs as a Deployment | 17 microservices plus the frontend, each a Deployment from the shared chart | ✅ |
| O2: database with stable storage | PostgreSQL **StatefulSet** with `volumeClaimTemplates` (`data-postgres-0`), a headless Service, and the `Retain` retention policy. RabbitMQ is also a StatefulSet. | ✅ |
| O3: single entry point with path routing | NGINX Ingress: `/api` → api-gateway, `/` → frontend | ✅ |
| O4: one reusable chart with per-service values | `charts/microservice` plus **one values file per service** in `values/services/` | ✅ |
| O5: deploy every service automatically from Git | Argo CD **ApplicationSet** (git files generator) plus App of Apps | ✅ |
| O6: health checks and scaling | startup, liveness and readiness probes on every pod; HPAs | ✅ (improved, see below) |
| O7: metrics and dashboards | kube-prometheus-stack plus 3 custom Grafana dashboards and alert rules | ✅ |

**Changes from the proposal.** Mention these in the presentation and update the slides.

1. **17 microservices, not 16.** The application has 16 back-end services plus the API Gateway, which is also a Node.js microservice, and the React frontend. That makes 18 Deployments in total. Update the slides to say "17 microservices + frontend".
2. **The HPA uses custom metrics, not only CPU.** The assignment (requirement d) asks for custom metrics. The HPAs therefore use:
   - `http_requests_per_second` per pod, for **api-gateway** and **expense-service**. This is a custom metric served by prometheus-adapter.
   - `rabbitmq_queue_messages_ready` for **analytics-service**: an external metric for queue depth.
   - CPU as well, through metrics-server.
3. **The report service is not autoscaled.** The proposal listed "Expense and Report". Report-service stores generated PDF/XLSX files on a `ReadWriteOnce` volume, which only one node can mount. A second replica on the other worker could not read the files. It therefore runs one replica, and **api-gateway** and **analytics-service** are autoscaled instead. [Section 13](#13-high-availability-and-capacity-plan) explains how to make it scalable (object storage).
4. **New:** PodDisruptionBudgets, topology spread across the two workers, a Prometheus alert-rule pack, a postgres-exporter sidecar and a k6 load-test Job.

---

## 3. Folder layout

Everything for the project lives in `spendwise/dso202-final-project/`. The application source code is untouched in `services/`, `frontend/` and `shared/`.

```text
dso202-final-project/
├── instruction.md                     ← this guide
├── cluster/kind-cluster.yaml          ← 1 control-plane + 2 workers, Ingress ports
├── charts/
│   ├── microservice/                  ← ONE reusable chart for all 18 workloads
│   │   ├── Chart.yaml  values.yaml  values.schema.json
│   │   └── templates/ deployment, service, hpa, pdb, pvc, servicemonitor, NOTES.txt, tests/
│   ├── platform/                      ← PostgreSQL & RabbitMQ StatefulSets, Redis, Mailpit,
│   │   ├── files/01-create-databases.sh     ConfigMap, Ingress, exporters
│   │   └── templates/
│   └── monitoring-extras/             ← 3 Grafana dashboards (ConfigMaps) + PrometheusRule
│       └── dashboards/*.json
├── values/
│   ├── platform.yaml                  ← environment values for the platform chart
│   └── services/<name>.yaml           ← 18 files: one per service (the ApplicationSet reads these)
├── monitoring/
│   ├── kube-prometheus-stack.values.yaml
│   ├── prometheus-adapter.values.yaml ← custom-metric rules
│   └── metrics-server.values.yaml
├── argocd/
│   ├── project.yaml                   ← AppProject (allowed repos and namespaces)
│   ├── root-app.yaml                  ← App of Apps: the only thing you kubectl apply
│   └── apps/                          ← child Applications + the ApplicationSet
├── loadtest/k6-job.yaml               ← in-cluster load generator for the HPA demo
└── scripts/
    ├── create-secrets.sh              ← Secrets are created here, never committed to Git
    ├── load-images.sh                 ← build and side-load images into kind
    ├── release.sh                     ← GitOps CD: build → load → bump tag → git push
    ├── set-repo-url.sh                ← put your GitHub URL into the Argo CD manifests
    └── build-dashboards.mjs           ← regenerates the dashboard JSON
```

---

## 4. Prerequisites

| Tool | Version tested | Check |
|---|---|---|
| Docker Desktop (WSL 2 backend on Windows) | 29.x | `docker version` |
| kind | v0.32.0 | `kind version` |
| kubectl | v1.36 | `kubectl version --client` |
| Helm | v3.18+ or v4.x (the module uses Helm 4; both work) | `helm version` |
| Git and a **GitHub account** | any | `git --version` |
| Node.js | 22+ (used by the secret and dashboard scripts) | `node --version` |

**Resources.** The full stack (about 45 pods) needs roughly **5 GB of RAM** in Docker. In Docker Desktop, go to **Settings → Resources** and give Docker at least **8 GB of memory and 4 CPUs**. **Stop other kind or k3d clusters** before you start:

```bash
docker ps --format '{{.Names}}'          # list running clusters
docker stop <other-cluster-containers>   # e.g. ingress-control-plane ingress-worker ...
```

Run all commands from **Git Bash** (Windows) or a Linux/macOS terminal, inside `spendwise/dso202-final-project/` unless the step says otherwise.

```bash
cd spendwise/dso202-final-project
```

---

## Phase 0: Put the repository on GitHub

Argo CD **pulls** the desired state from Git, so the repository must be on GitHub.

1. On GitHub, create a **public** repository named `spendwise`, without a README.
2. Point the Argo CD manifests at it:

   ```bash
   bash scripts/set-repo-url.sh https://github.com/<your-username>/spendwise.git
   grep -r "github.com" argocd/ | head      # every repoURL now shows your URL
   ```

3. Commit and push from the **repository root** (`spendwise/`):

   ```bash
   cd ..                                    # spendwise/
   git add .
   git commit -m "DSO202 final project: Helm charts, Argo CD, monitoring, autoscaling"
   git branch -M main
   git remote add origin https://github.com/<your-username>/spendwise.git
   git push -u origin main
   cd dso202-final-project
   ```

> **Private repository?** Register it with Argo CD after Phase 6:
> `kubectl -n argocd create secret generic repo-spendwise --from-literal=type=git --from-literal=url=https://github.com/<user>/spendwise.git --from-literal=username=<user> --from-literal=password=<GitHub PAT with repo:read>`
> then `kubectl -n argocd label secret repo-spendwise argocd.argoproj.io/secret-type=repository`.

✅ **Check:** the repository page on GitHub shows the `dso202-final-project/` folder.

---

## Phase 1: Create the kind cluster

```bash
kind create cluster --config cluster/kind-cluster.yaml
kubectl config current-context           # kind-spendwise
kubectl get nodes -o wide
```

The control-plane node is labelled `ingress-ready=true` and maps container ports 80/443 to **host ports 8000/8443**. 80/443 are often already taken on student laptops. If yours are free, you may change `hostPort` to 80 and 443 and drop `:8000` from every URL below.

✅ **Check:** three nodes are `Ready`: `spendwise-control-plane`, `spendwise-worker` and `spendwise-worker2`.

---

## Phase 2: Build the images and load them into kind

kind cannot see the images in your local Docker engine. `kind load` copies each image into every node, and the charts use `imagePullPolicy: IfNotPresent`, so no registry is needed.

```bash
BUILD=1 bash scripts/load-images.sh      # first time: docker compose build, then load all 18 images
# later, if the images already exist:   bash scripts/load-images.sh
```

✅ **Check:** `docker exec spendwise-worker crictl images | grep spendwise` lists 18 images.

---

## Phase 3: Install the NGINX Ingress controller

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/kind/deploy.yaml
kubectl wait -n ingress-nginx --for=condition=Ready pod \
  -l app.kubernetes.io/component=controller --timeout=180s
```

> Unit II notes that ingress-nginx is in maintenance mode, with the Gateway API as its successor. It is still the simplest controller on kind. Mention the Gateway API as future work.

✅ **Check:** `kubectl -n ingress-nginx get pods` shows the controller as `1/1 Running`.

---

## Phase 4: Understand and validate the Helm charts

The project has three charts:

| Chart | Purpose | Installed as |
|---|---|---|
| `charts/microservice` | **One shared chart** for every service: Deployment, Service, HPA, PDB, PVC, ServiceMonitor and a `helm test` Pod | 18 releases, one per `values/services/*.yaml` |
| `charts/platform` | PostgreSQL and RabbitMQ StatefulSets, Redis, Mailpit, shared ConfigMap, Ingress, exporters | 1 release |
| `charts/monitoring-extras` | Grafana dashboards (ConfigMaps) and a PrometheusRule | 1 release |

### 4.1 Key design points (explain these in the presentation)

- **One chart, many values files.** `values/services/expense-service.yaml` contains only what differs: image, port, database, replicas and autoscaling. Adding a service means adding one values file.
- **Database-per-service.** The `database:` value makes the chart build `DATABASE_URL=postgres://<db>_svc:…@postgres:5432/<db>`. The init script in `charts/platform/files/` creates 16 databases and 16 login roles, and revokes `CONNECT` from `PUBLIC`. No service can open another service's database.
- **Probes.** Every container has all three probe types.
  - The `startupProbe` gives up to 2 minutes for first-start migrations.
  - The `livenessProbe` (`/health/live`) restarts a hung process.
  - The `readinessProbe` (`/health/ready`) checks the database, broker and Redis, and removes the pod from the Service while they are down.
- **Init container.** `wait-for-dependencies` waits for `postgres:5432`, `rabbitmq:5672` and `redis:6379`, so a fresh install converges without CrashLoopBackOff.
- **Zero-downtime rollout.** `maxSurge: 1` and `maxUnavailable: 0`.
- **Config changes.** The ConfigMap is shared and Argo CD syncs every change. Restart the services to pick up a new value (`kubectl rollout restart`).
- **Security.** Pods run as non-root with a read-only root filesystem, all Linux capabilities dropped, a seccomp profile, and `automountServiceAccountToken: false`. Secrets come from a Kubernetes Secret that is never in Git.
- **Values schema.** `values.schema.json` rejects wrong types, such as `replicaCount: "two"` or `port: 99999`, at lint, template and install time. This is the lesson from Unit III, 3.2 Stage 5.

### 4.2 Validate the charts (evidence for "configuration requirements")

```bash
# 1. Lint every service values file against the shared chart (schema validation included)
for f in values/services/*.yaml; do
  helm lint charts/microservice -f "$f" --strict >/dev/null && echo "ok  $(basename "$f")" || echo "FAIL $f"
done
helm lint --strict charts/platform -f values/platform.yaml
helm lint --strict charts/monitoring-extras

# 2. Render one service and read it
helm template expense-service charts/microservice -f values/services/expense-service.yaml -n spendwise | less

# 3. Prove the schema works: this must FAIL with a schema error
helm template bad charts/microservice -f values/services/expense-service.yaml --set replicaCount=50
```

You run the server-side check (`helm template | kubectl apply --dry-run=server`), which also catches misspelled fields, in Phase 7 once the CRDs exist.

✅ **Check:** 18 × `ok`, plus `0 chart(s) failed` for both other charts. Step 3 fails with `values don't meet the specifications of the schema(s)` … `at '/replicaCount': maximum: got 50, want 10`.

---

## Phase 5: Create the Secrets (outside Git)

Committing a Secret, even base64-encoded, would publish the passwords. Base64 is encoding, not encryption. The script generates random passwords, a 2048-bit RSA key for signing JWTs, and the Grafana admin login.

```bash
bash scripts/create-secrets.sh
```

It creates `spendwise/spendwise-secrets` and `monitoring/grafana-admin`, and prints the Grafana password. Save it.

> **Optional:** `ANTHROPIC_API_KEY=sk-ant-... bash scripts/create-secrets.sh` enables Claude-written AI insights. Without a key, the AI service uses its built-in template summary.
>
> **Production note:** use **Sealed Secrets** or the **External Secrets Operator** so that encrypted secrets *can* live in Git. This was listed as a next step in the GitOps lab.

✅ **Check:** `kubectl -n spendwise get secret spendwise-secrets` shows `DATA 9`.

---

## Phase 6: Install Argo CD

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.6/manifests/install.yaml
kubectl wait -n argocd --for=condition=Ready pods --all --timeout=300s
```

> `--server-side` is required for Argo CD 3.x. Its ApplicationSet CRD is too large for the `last-applied-configuration` annotation that client-side apply writes. The lab used `stable`; here it is pinned to `v3.5.6` so everyone in the group gets the same version.

Log in to the UI:

```bash
# initial admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
# in a SECOND terminal (leave it running)
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

Open **https://localhost:8080**, accept the self-signed certificate, and log in as `admin`.

✅ **Check:** the Argo CD UI loads with no applications.

---

## Phase 7: Bootstrap GitOps (App of Apps + ApplicationSet)

This is the **only** `kubectl apply` of application objects you will ever do. From now on, Git drives everything.

```bash
kubectl apply -f argocd/project.yaml
kubectl apply -f argocd/root-app.yaml
```

What happens next takes about 5–10 minutes on the first run while images download:

1. `spendwise-root` syncs `argocd/apps/` and creates 5 Applications and 1 ApplicationSet.
2. **Sync waves** order them:
   - −3: metrics-server
   - −2: kube-prometheus-stack, which installs the CRDs `ServiceMonitor` and `PrometheusRule`
   - −1: prometheus-adapter and monitoring-extras
   - 0: platform
   - 1: services
3. The **ApplicationSet** reads `values/services/*.yaml` and generates **18 Applications** (`api-gateway`, `auth-service`, … `frontend`), each an independent Helm release of `charts/microservice`.
4. `SkipDryRunOnMissingResource` and the retry settings let the platform and services Applications sync even if they briefly run before the Prometheus CRDs exist.

Watch progress:

```bash
kubectl -n argocd get applications -w            # Ctrl-C to stop
kubectl -n spendwise get pods -w
```

Once the CRDs exist, run the server-side validation from Phase 4:

```bash
helm template expense-service charts/microservice -f values/services/expense-service.yaml -n spendwise \
  | kubectl apply --dry-run=server -f -          # "created (server dry run)" for every object
```

✅ **Check:**
- `kubectl -n argocd get applications` lists **24** applications (root + 5 + 18), all `Synced` and `Healthy`.
- `kubectl -n spendwise get pods` shows every pod Running and Ready, with `postgres-0` at `2/2`.
- Screenshot the Argo CD **Applications** tile view and the `spendwise-root` tree view.

---

## Phase 8: Open the application and tools

`*.localtest.me` is a public DNS name that always resolves to `127.0.0.1`, so you don't need to edit the hosts file.

| What | URL | Login |
|---|---|---|
| **SpendWise app** | http://spendwise.localtest.me:8000 | register a new account |
| API docs (Swagger, all 17 services) | http://spendwise.localtest.me:8000/docs | n/a |
| **Grafana** | http://grafana.localtest.me:8000 | `admin` / password from Phase 5 |
| **Prometheus** | http://prometheus.localtest.me:8000 | n/a |
| Mailpit (e-mails sent by the app) | http://mail.localtest.me:8000 | n/a |
| **Argo CD** | https://localhost:8080 (port-forward) | `admin` / initial password |

Create some data so the dashboards have something to show: register, then add a few incomes, expenses, a budget and a goal.

✅ **Check:** the dashboard page loads, and you receive a welcome e-mail in Mailpit (event flow: auth → RabbitMQ → notification-service).

---

## Phase 9: Verify self-healing (probes and controllers)

```bash
# 1. Kill a pod: the Deployment controller replaces it, and the Service keeps serving
kubectl -n spendwise delete pod -l app.kubernetes.io/name=expense-service --wait=false
kubectl -n spendwise get pods -l app.kubernetes.io/name=expense-service -w

# 2. Readiness + StatefulSet storage: delete the database pod
kubectl -n spendwise delete pod postgres-0
kubectl -n spendwise get pods -w   # a few services drop to READY 0/1 (readiness fails) and
                                   # some restart once; postgres-0 returns with the SAME name
kubectl -n spendwise get pvc data-postgres-0     # same PVC, still Bound
kubectl -n spendwise exec postgres-0 -c postgres -- psql -U postgres -d expenses -tAc "select count(*) from expenses"
# log in to the app again: your data is still there
```

**Observed on the test cluster:**
- `postgres-0` was Ready again about 15 s after deletion.
- 3 pods were briefly NotReady.
- 3 services (auth, user, recurring) exited cleanly when their database connections were cut, and the kubelet restarted them once.
- All 24,066 expense rows were still there.

Both mechanisms are self-healing: *readiness* keeps traffic away from a pod that can't serve, and the *restart policy* brings back a process that exits.

✅ **Check:** each pod comes back on its own, and data written before is still in the app.

---

## Phase 10: GitOps demonstrations

Each demo is a `git commit` and `git push` from the repository root. Argo CD polls every **3 minutes**. Click **Refresh** in the UI to sync immediately.

### 10.1 Continuous deployment of a new version

```bash
# make a visible change, e.g. edit a string in services/expense-service/src/...
bash scripts/release.sh expense-service v1.0.1
```

`release.sh` builds `spendwise/expense-service:v1.0.1`, loads it into kind, changes `tag:` in `values/services/expense-service.yaml`, then commits and pushes. **Nothing calls the cluster to deploy.** Argo CD sees the commit, marks `expense-service` *OutOfSync*, and syncs. The Deployment then rolls one pod at a time with zero downtime.

```bash
kubectl -n spendwise rollout status deploy/expense-service
kubectl -n spendwise get deploy expense-service -o jsonpath='{.spec.template.spec.containers[0].image}'; echo
```

> **With CI:** the repository's `.github/workflows/ci-cd.yml` does the same thing in GitHub Actions. It builds, scans and pushes to GHCR, then commits the new tag. To use it, set `image.repository: ghcr.io/<user>/spendwise/<service>` in the values files and make the GHCR packages public.

### 10.2 Scale through Git

Edit `values/services/category-service.yaml`, change `replicaCount: 2` to `3`, commit and push. Argo CD adds the pod. (Services that have an HPA ignore `replicaCount`.)

### 10.3 Self-heal (drift correction)

```bash
kubectl -n spendwise scale deploy category-service --replicas=1
kubectl -n spendwise get deploy category-service -w     # Argo CD restores 3 within seconds
```

### 10.4 Rollback

The GitOps way is to revert the commit:

```bash
git revert HEAD --no-edit && git push            # expense-service returns to the previous tag
```

> In the Argo CD UI, *History and Rollback* also works for a quick fix. Auto-sync is paused while you are rolled back, and the next Git commit wins again. Git stays the source of truth.

### 10.5 Prune

Delete `values/services/ai-service.yaml`, commit and push. The ApplicationSet removes the `ai-service` Application, and its finalizer deletes the Deployment, Service and ServiceMonitor. Restore it with `git revert HEAD && git push`.

✅ **Check:** screenshot the Argo CD app *History* showing the commits, and the OutOfSync → Synced transition.

---

## Phase 11: Monitoring with Prometheus and Grafana

### 11.1 What is collected

| Source | How it is scraped | Examples |
|---|---|---|
| 17 SpendWise services | `ServiceMonitor` per service, rendered by the shared chart (`GET /metrics`, every 15 s) | `http_request_duration_seconds_*`, `events_published_total`, `events_consumed_total{outcome}`, `outbox_pending_events`, `spendwise_business_events_total`, Node.js heap and event-loop lag |
| PostgreSQL | postgres-exporter sidecar plus a ServiceMonitor | `pg_up`, `pg_stat_database_numbackends`, `pg_database_size_bytes` |
| RabbitMQ | built-in Prometheus plugin (:15692) plus a ServiceMonitor | `rabbitmq_detailed_queue_messages_ready{queue}`, `rabbitmq_connections` |
| Kubernetes objects | kube-state-metrics | `kube_pod_status_phase`, `kube_horizontalpodautoscaler_*` |
| Nodes and containers | node-exporter, kubelet/cAdvisor | `node_cpu_seconds_total`, `container_memory_working_set_bytes` |

The Prometheus values set `serviceMonitorSelectorNilUsesHelmValues: false`, so Prometheus picks up **every** ServiceMonitor in the cluster, not just those from its own Helm release.

### 11.2 Verify Prometheus

Open http://prometheus.localtest.me:8000 → **Status → Targets**. All `spendwise/*` targets should be **UP**: 17 services, postgres and 2 × rabbitmq. Try these queries in **Graph**:

```promql
sum by (service) (rate(http_request_duration_seconds_count{namespace="spendwise"}[1m]))   # req/s per service
histogram_quantile(0.95, sum by (service, le) (rate(http_request_duration_seconds_bucket[5m])))  # p95
sum by (queue) (rabbitmq_detailed_queue_messages_ready{namespace="spendwise"})              # queue depth
```

**Alerts tab:** the `spendwise.*` rule groups from `charts/monitoring-extras/templates/prometheusrule.yaml` are listed:
- `SpendWiseServiceDown`
- `SpendWiseDeploymentUnavailable`
- `SpendWiseHighErrorRate`
- `SpendWiseHighLatency`
- `SpendWiseDeadLetteredEvents`
- `SpendWiseOutboxBacklog`
- `SpendWiseHPAAtMaxReplicas`
- `SpendWisePVCAlmostFull`
- `SpendWisePodCrashLooping`

To see an alert fire, you must stop Argo CD from fixing the problem first, because self-heal would undo it within seconds:

1. In the Argo CD UI, open **user-service** → **Details** → **Disable Auto-Sync**.
2. Run `kubectl -n spendwise scale deploy user-service --replicas=0`. Argo CD now shows the app as **OutOfSync** (drift detected, not corrected).
3. After 2 minutes, **SpendWiseDeploymentUnavailable** turns *Firing* in Prometheus → Alerts.
4. Re-enable Auto-Sync. Argo CD restores the replica and the alert resolves.

### 11.3 The three SpendWise dashboards

Open Grafana → **Dashboards → SpendWise** folder. The Grafana sidecar loads them automatically from the ConfigMaps labelled `grafana_dashboard: "1"`.

| Dashboard | Purpose | Panels |
|---|---|---|
| **SpendWise · Application** | Golden signals per microservice | Services up, total req/s, 5xx error rate, p95 latency, outbox backlog, dead-lettered events, request rate by service, p95 by service, 4xx/5xx by service, busiest routes table, events published/consumed/processing time, business events, Node.js heap, event-loop lag. Filters: namespace, service. |
| **SpendWise · Autoscaling** | Proves the custom-metric HPA works | Current vs desired replicas per HPA, max replicas, **req/s per pod with the HPA target line**, RabbitMQ queue depth, events processed per pod, CPU used vs requested |
| **SpendWise · Infrastructure** | Cluster and stateful components | Nodes ready, pods running/not ready, restarts, cluster CPU/memory, CPU and memory by node, top-10 pods by CPU and memory, network I/O, **PVC sizes**, PostgreSQL (up, connections by DB, DB size, transactions/s), RabbitMQ (queue depth, message rates, connections, DLQ depth) |

kube-prometheus-stack also ships about 20 built-in dashboards. Show these too:
- *Kubernetes / Compute Resources / Namespace (Pods)*: select `spendwise`.
- *Node Exporter / Nodes*.
- *Kubernetes / Persistent Volumes*.

> To change a dashboard, edit `scripts/build-dashboards.mjs`, run `node scripts/build-dashboards.mjs`, then commit and push. Argo CD updates the ConfigMaps and Grafana reloads them. Dashboards are managed through GitOps too.

Example screenshots from the test run are in `docs/screenshots/` (`grafana-application.png`, `grafana-autoscaling.png`, `grafana-infrastructure.png`). Take your own from your cluster for the report.

✅ **Check:** screenshots of all three dashboards with data (light theme is clearer on slides).

---

## Phase 12: Auto-scaling on custom metrics

### 12.1 How the pipeline works

```text
 service pod ──/metrics──► Prometheus ──PromQL──► prometheus-adapter ──► custom.metrics.k8s.io
                                                                       └► external.metrics.k8s.io
 kubelet ─────────────────► metrics-server ────────────────────────────► metrics.k8s.io
                                                                              │
                                    HorizontalPodAutoscaler (every 15 s) ◄────┘
                                    desired = ceil(current × currentValue / target)
                                    → picks the HIGHEST of all its metrics
```

The adapter rules in `monitoring/prometheus-adapter.values.yaml` are:

| Kubernetes metric | Type | PromQL behind it | Used by |
|---|---|---|---|
| `http_requests_per_second` | Pods (custom) | `sum(rate(http_request_duration_seconds_count[1m])) by (pod)` | api-gateway (target 10/pod), expense-service (5/pod) |
| `events_processed_per_second` | Pods (custom) | `sum(rate(events_consumed_total[1m])) by (pod)` | available for consumers |
| `rabbitmq_queue_messages_ready` | External | `sum(rabbitmq_detailed_queue_messages_ready) by (queue)` | analytics-service (20 waiting messages per pod) |

The HPA definitions live in the values files. For example, `values/services/expense-service.yaml` contains:

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 8
  cpu: { enabled: true, averageUtilization: 80 }   # safety net
  podsMetrics:
    - name: http_requests_per_second
      averageValue: "5"                            # main signal: one pod per 5 req/s
```

**Why the targets are set this way.** The HPA calculates a replica count for *every* metric and uses the largest. In the first test run, the CPU request was only 25m, so CPU utilisation hit 200–280% and CPU, not the custom metric, drove the scaling. The tuned values are a 100m CPU request with an 80% target, and request-rate targets of 10 (gateway) and 5 (expense) per pod. With these, CPU stays at 40–65% under load and **the request rate is the metric that scales the service**. Run `kubectl describe hpa expense-service` to see the current value of each metric.

Analytics-service deliberately has **no** HTTP-rate metric. It receives almost no HTTP traffic, so the metric would report `<unknown>`. While any metric is unknown, the HPA refuses to scale *down*, and the service would stay at its peak replica count.

`behavior` in `charts/microservice/values.yaml` lets the HPA add up to 2 pods every 30 s, and removes only 1 pod per minute after a 2-minute stabilisation window. This avoids flapping.

### 12.2 Verify the metrics APIs

```bash
kubectl get apiservices | grep metrics           # all three: True
kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1/namespaces/spendwise/pods/*/http_requests_per_second" | head -c 600; echo
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/spendwise/rabbitmq_queue_messages_ready?labelSelector=queue%3Danalytics-service.events"; echo
kubectl -n spendwise get hpa
```

> `http_requests_per_second` only appears after a service has received at least one request. Open the app, or start the load test.

### 12.3 Demo 1: request-rate autoscaling (api-gateway and expense-service)

Open Grafana **SpendWise · Autoscaling** in one window and a terminal in another.

```bash
kubectl apply -f loadtest/k6-job.yaml            # 8 min: ramp to 80 req/s, hold, ramp down
kubectl -n spendwise get hpa -w                  # watch TARGETS and REPLICAS change
kubectl -n spendwise logs -f job/loadtest        # k6 progress
```

What you will see. These are the `kubectl get hpa` readings from the test run, sampled every 30 s:

| Time | api-gateway: `TARGETS` → replicas | expense-service: `TARGETS` → replicas |
|---|---|---|
| t+0 s | `cpu: 7%/80%, 0/10` → **2** | `cpu: 45%/80%, 0/5` → **2** |
| t+61 s | `cpu: 93%/80%, 10352m/10` → 2 | `cpu: 84%/80%, 9849m/5` → 2 |
| t+91 s | `cpu: 98%/80%, 12953m/10` → 3 | `cpu: 92%/80%, 9626m/5` → 4 |
| t+152 s | `cpu: 73%/80%, 12969m/10` → 5 | `cpu: 59%/80%, 10407m/5` → **8 (max)** |
| t+183 s → t+458 s (hold) | `cpu: 57–70%/80%, ~12700m/10` → **6 (max)** | `cpu: 46–60%/80%, ~9500m/5` → 8 |
| t+580 s (load over) | `0/10` → 6 | `0/5` → 8 |
| t+610 s → t+792 s | −1 pod per minute → **2** | −1 pod per minute → 7, 6, … |
| t+944 s | 2 | **2** |

`12953m` means 12.95 req/s per pod, written in Kubernetes milli-units.

- During the first minute of the ramp, both CPU and request rate were above target.
- Once the extra pods were Ready, **CPU stayed below its 80% target (46–73%) while request rate stayed above it**. From then on, the custom metric alone held the Deployments at their maximum.
- k6 sent **28,842 requests (57 req/s average) with 0.49% failures**. The *HTTP 4xx / 5xx by service* panel shows them as HTTP 500s from expense-service (about 0.4 req/s) at the peak, while the HPA was still adding pods. Point this out in the presentation: it is a good example of the monitoring catching a real issue.

Scale-down follows the configured `behavior`: a 2-minute stabilisation window, then 1 pod per minute. While both HPAs sit at max, the `SpendWiseHPAAtMaxReplicas` alert fires after 10 minutes. That is your cue in the capacity plan to raise `maxReplicas` or add nodes.

### 12.4 Demo 2: queue-depth autoscaling (analytics-service)

```bash
# 1. Pause the consumer (replicas=0 also pauses its HPA), then create a backlog
kubectl -n spendwise scale deploy analytics-service --replicas=0
kubectl apply -f loadtest/k6-job.yaml            # or add expenses in the UI
#    Grafana: "RabbitMQ messages waiting" climbs for analytics-service.events

# 2. Resume: the HPA sees e.g. 300 waiting / 20 per pod → wants 15 → capped at maxReplicas 5
kubectl -n spendwise scale deploy analytics-service --replicas=1
kubectl -n spendwise get hpa analytics-service -w
```

**Measured on the test cluster:**
1. With the consumer paused for 6 minutes, `analytics-service.events` grew to **about 6,000 waiting messages**.
2. Thirty seconds after scaling back to 1, the HPA showed `1461334m/20 (avg)`, which is about 1,461 messages per pod against a target of 20, and scaled to **3 pods**. That is the scale-up policy limit of +2 pods per 30 s.
3. The backlog dropped to **0 within about one minute**.
4. After the 2-minute stabilisation window, the HPA scaled back to 1.

**This is the strongest custom-metric demo:** CPU alone would never notice that work is piling up in a queue.

Clean up the load test with `kubectl -n spendwise delete job loadtest`.

✅ **Check:** screenshots of `kubectl get hpa` during the peak, and the Autoscaling dashboard showing replicas rising together with req/s per pod.

---

## 13. High availability and capacity plan

### 13.1 High-availability measures

| Failure | Protection in this project |
|---|---|
| A pod crashes or hangs | Deployment controller recreates it. The liveness probe restarts hung containers. |
| A pod is not ready (database down, start-up) | The readiness probe removes it from Service endpoints, so no traffic reaches it. |
| A worker node fails or is drained | Critical services run **2+ replicas**, spread across both workers with `topologySpreadConstraints`. **PodDisruptionBudgets** (`minAvailable: 1`) stop `kubectl drain` from evicting the last replica. |
| Bad deployment | Rolling update (`maxUnavailable: 0`). The readiness gate stops a broken version from receiving traffic. `git revert` rolls back. |
| Configuration drift or manual changes | Argo CD `selfHeal: true` restores the Git state. |
| Load spike | HPAs on custom metrics plus CPU. |
| Message-consumer failure | RabbitMQ queues are durable on a PVC. Events wait until the consumer is back, with retries and a DLQ. The outbox keeps events even while RabbitMQ is down. |
| Database pod restart | StatefulSet with a stable PVC (`data-postgres-0`) and the `Retain` retention policy. Data survives pod deletion and re-creation. |

**Replica plan (local cluster):**

| Workload | Replicas | Why |
|---|---|---|
| api-gateway | 2–6 (HPA) | Single entry point: must never be one pod |
| expense-service | 2–8 (HPA) | Busiest write path |
| analytics-service | 1–5 (HPA on queue depth) | Asynchronous: a backlog is acceptable, then it scales out |
| auth-service, category-service, frontend | 2 | Every request depends on them (login, category lookup, UI) |
| the other 11 services | 1 | Low traffic on a laptop. Raise to 2 in production (same file, one line). |
| report-service, file-service | 1 | ReadWriteOnce volume (see limitations) |
| postgres, rabbitmq | 1 (StatefulSet) | See limitations |

**Node-failure test (do this in the demo):**

```bash
kubectl drain spendwise-worker2 --ignore-daemonsets --delete-emptydir-data
#   the PDBs keep >= 1 replica of every multi-replica service running; the app keeps working
kubectl -n spendwise get pods -o wide             # everything rescheduled on spendwise-worker
kubectl uncordon spendwise-worker2
```

> PostgreSQL, RabbitMQ and the report and file services use local-path volumes tied to one node. They are therefore pinned to worker 1 (`nodeSelector: spendwise/node-index: "1"`), and worker 2 holds only stateless pods. That is why the demo drains worker 2. If worker 1 were drained, the stateful pods would wait (Pending) until it is uncordoned. This is an honest limitation of a kind cluster. On a cloud cluster with network storage (EBS or Persistent Disk), the volume follows the pod to another node.

**Known single points of failure, and the production fix:**

| Component | Local | Production |
|---|---|---|
| PostgreSQL | 1-pod StatefulSet | **CloudNativePG** operator: 3 instances with streaming replication and automatic failover (the Operators topic, Unit II 2.4), or a managed database (RDS or Cloud SQL) |
| RabbitMQ | 1 pod | RabbitMQ Cluster Operator: 3 nodes with **quorum queues** |
| report and file storage | RWO local volume | S3 or MinIO object storage, so they can scale horizontally |
| Control plane | 1 node | 3 control-plane nodes (managed EKS, GKE or AKS) |
| Ingress | 1 controller | 2+ controller replicas behind a cloud load balancer |

### 13.2 Capacity plan

**Measured on the test cluster** (`kubectl top`, OpenTelemetry disabled):
- Each Node.js microservice uses about **40 MiB** of memory and 5–60 m CPU (idle to ~10 req/s per pod).
- PostgreSQL uses about 175 MiB and RabbitMQ about 120 MiB.

**Requests and limits** (what the scheduler reserves):

| Group | Pods | CPU request | Memory request | Memory limit |
|---|---|---|---|---|
| 17 services + frontend (baseline replicas) | 23 | ~1.25 cores | ~2.2 GiB | ~7.5 GiB |
| Extra pods at HPA max (gateway +4, expense +6, analytics +4) | +14 | +1.2 cores | +1.3 GiB | +4.4 GiB |
| Platform (PostgreSQL + exporter, RabbitMQ, Redis, Mailpit) | 4 | 0.24 cores | 0.6 GiB | 2.1 GiB |
| Monitoring (Prometheus, Grafana, operator, kube-state-metrics, 3 × node-exporter, adapter, metrics-server) | 9 | 0.26 cores | 0.85 GiB | 3.2 GiB |
| Argo CD (7 pods, no requests set) | 7 | n/a | ~0.5 GiB actual | n/a |
| Ingress controller + kube-system | ~12 | ~0.9 cores | ~0.6 GiB | n/a |
| **Total at peak** | **~69** | **~3.9 cores** | **~6 GiB** | n/a |

Memory requests (96 MiB) are about 2.4× the measured usage of a service (~40 MiB). CPU requests are 50m, or 100m for the two request-scaled services, so that CPU percentages are meaningful to the HPA. On kind, every node reports the whole laptop's CPUs as its capacity, so these requests always schedule. The *real* limit is the measured usage: about **1.4 cores and 3.2 GiB at peak load** for the services, platform and monitoring on the test cluster.

**Sizing rules:**
- **Laptop (this project):** 4 CPUs and 8 GB for Docker runs everything, including the HPA peaks. Three nodes share the same machine, so "node" capacity is logical.
- **Throughput per pod:** the HPA targets are 5 req/s per expense pod and 10 per gateway pod. These are deliberately conservative. In the test, each pod handled about 9.5–13 req/s at 50–60% of a 100m CPU request. At max replicas (8 expense, 6 gateway), the measured load of about 75–80 req/s was served with 0.5% errors. Scaled to the targets, that is about 40 req/s of expense traffic and 60 req/s at the gateway before the HPAs reach their maximum. That is enough for about 500 active users at 5–6 actions per minute. Raise `maxReplicas` (and nodes) for more.
- **Storage:**

  | Volume | Size | Usage |
  |---|---|---|
  | PostgreSQL | 5 Gi | about 2 KB per transaction row, so millions of rows fit |
  | RabbitMQ | 2 Gi | n/a |
  | Prometheus | 5 Gi | 3-day retention; about 60 targets × 1,500 series ≈ 100k series ≈ 1.5 GB per 3 days |
  | Reports | 2 Gi | n/a |
  | Files | 2 Gi | n/a |
  | Grafana | 1 Gi | n/a |

  On kind, the local-path volumes do not report usage, so watch the *Database size* panel. On cloud block storage, the kubelet reports `kubelet_volume_stats_*`, and the `SpendWisePVCAlmostFull` alert (85%) tells you when to grow a volume.
- **Scaling triggers:** `SpendWiseHPAAtMaxReplicas` firing for more than 10 minutes means you should raise `maxReplicas`, if nodes have room. Node CPU above 70% or memory above 75% on the Infrastructure dashboard means add a node (in kind, add `- role: worker` and recreate the cluster).
- **Production estimate (3 × 4 vCPU / 16 GB nodes):**
  - 2 replicas of every service: about 4.5 GiB of requests.
  - HPA headroom ×3 on the hot paths.
  - A 3-instance database and a 3-node broker.
  - This fits with N+1 redundancy, so one node can be lost.

---

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Pods `ErrImagePull` / `ImagePullBackOff` for `spendwise/*` | Image not loaded into kind, or tag changed | `bash scripts/load-images.sh` (use `TAG=v1.0.1` for a released tag) |
| Pods stuck at `Init:0/1` | `wait-for-dependencies` is waiting for PostgreSQL or RabbitMQ | `kubectl -n spendwise get pods postgres-0 rabbitmq-0`, then check their logs |
| `CreateContainerConfigError` | Secret missing | `bash scripts/create-secrets.sh` |
| Argo CD app `ComparisonError` / "repository not found" | Wrong `repoURL`, or private repo without credentials | `scripts/set-repo-url.sh`, push, or add a repo Secret (Phase 0) |
| `platform` app: "no matches for kind ServiceMonitor" | It synced before kube-prometheus-stack | It retries automatically; or click Sync once `monitoring` is Healthy |
| `monitoring` app OutOfSync: "metadata.annotations: Too long" | Client-side apply of large CRDs | `ServerSideApply=true` is already set; click Sync |
| HPA target `<unknown>` | No traffic yet (custom metric), or adapter or metrics-server not ready | Send requests; run `kubectl get apiservices \| grep metrics` |
| `kubectl top` "Metrics API not available" | metrics-server still starting | Wait 1 minute; `kubectl -n kube-system logs deploy/metrics-server` |
| Grafana dashboards empty | Wrong time range, or no traffic | Set *Last 30 minutes*, use the app or the load test |
| node-exporter CrashLoop on Docker Desktop | Root-filesystem mount propagation | Already disabled with `hostRootFsMount.enabled: false` |
| `http://spendwise.localtest.me:8000` not reachable | Port mapping, or another cluster using the port | `docker ps` should show `127.0.0.1:8000->80/tcp` on `spendwise-control-plane` |
| Image pulls very slow (registry.k8s.io, quay.io) | Campus network | Pre-pull on the host: `docker pull <image>`, then `kind load docker-image <image> --name spendwise` |
| Login fails right after auth-service restarts | n/a | Can't happen here: the RSA key comes from the Secret, so all auth replicas sign with the same key |

Useful commands:

```bash
kubectl -n spendwise get pods,svc,hpa,pdb,pvc,ingress
kubectl -n spendwise describe pod <pod>              # Events show probe failures, scheduling problems
kubectl -n spendwise logs deploy/expense-service --tail=50
kubectl -n argocd get applications
kubectl get events -n spendwise --sort-by=.lastTimestamp | tail -20
```

---

## 15. Presentation demo script (10–12 minutes)

Prepare before presenting: cluster running, all apps Synced and Healthy, some data in the app, Grafana and Argo CD logged in, and two terminals open.

| # | Minutes | Show | Say |
|---|---|---|---|
| 1 | 1 | Architecture diagram (Section 1) | 17 microservices + frontend, database-per-service, event-driven |
| 2 | 1.5 | `charts/microservice` + one values file; `helm lint` loop | One reusable chart, 18 values files, schema validation |
| 3 | 1.5 | Argo CD tree of `spendwise-root` and the ApplicationSet's 18 apps | App of Apps, sync waves, ApplicationSet; Git is the source of truth |
| 4 | 1.5 | `scripts/release.sh expense-service v1.0.1`, then the Argo CD sync and rolling update | CD with no `kubectl apply` |
| 5 | 0.5 | `kubectl scale … --replicas=1`, then Argo CD reverts it | Self-heal |
| 6 | 1 | Delete a pod; drain a worker | Probes, PDBs, topology spread = HA |
| 7 | 1.5 | Grafana: Application + Infrastructure dashboards; Prometheus targets and alerts | Monitoring stack |
| 8 | 2.5 | Start `loadtest/k6-job.yaml`; `kubectl get hpa -w` and the Autoscaling dashboard | Custom metrics → adapter → HPA |
| 9 | 1 | Capacity table (Section 13.2) | Measured usage, limits, production plan |

---

## 16. Evidence checklist (for the report)

Create an `evidence/` folder and capture:

- [ ] `kubectl get nodes -o wide`
- [ ] `helm lint` loop output (18 × ok) and the failed schema test
- [ ] `kubectl -n argocd get applications` (24 apps, Synced/Healthy) and Argo CD UI screenshots
- [ ] Git commit from `release.sh`, and the Argo CD history showing that commit deployed
- [ ] Self-heal: before and after `kubectl scale`
- [ ] `kubectl -n spendwise get pods,svc,ingress,pvc,hpa,pdb`
- [ ] Prometheus **Targets** page (spendwise targets UP) and **Alerts** page
- [ ] Grafana: SpendWise · Application, · Autoscaling (during load), · Infrastructure
- [ ] `kubectl get --raw` output of a custom metric and the external metric
- [ ] `kubectl get hpa` at peak load (replicas above min) and after scale-down
- [ ] Drain test: `kubectl get pods -o wide` before and after
- [ ] `kubectl top nodes` and `kubectl top pods -n spendwise` (capacity numbers)

---

## 17. Clean-up

```bash
kubectl -n spendwise delete job loadtest --ignore-not-found
kind delete cluster --name spendwise           # removes everything, including volumes
```

PVCs that use the `Retain` policy, and Helm `resource-policy: keep` objects, are deleted with the cluster because kind's volumes live inside the node containers.

---

## Appendix A: Version matrix

| Component | Version | Source |
|---|---|---|
| Kubernetes (kind node) | v1.36 (kind v0.32.0 default) | `cluster/kind-cluster.yaml` |
| ingress-nginx | controller-v1.15.1 | kind provider manifest |
| Argo CD | v3.5.6 | `install.yaml` |
| kube-prometheus-stack | 92.17.1 (Prometheus Operator v0.94.2) | `argocd/apps/monitoring.yaml` |
| prometheus-adapter | 5.4.0 (v0.12.0) | `argocd/apps/prometheus-adapter.yaml` |
| metrics-server | 3.14.0 (v0.9.0) | `argocd/apps/metrics-server.yaml` |
| PostgreSQL | 16-alpine + postgres-exporter v0.16.0 | `charts/platform/values.yaml` |
| RabbitMQ | 3.13-management-alpine | `charts/platform/values.yaml` |
| Redis | 7-alpine | `charts/platform/values.yaml` |
| k6 | 1.3.0 | `loadtest/k6-job.yaml` |

## Appendix B: Installing without Argo CD (quick local test)

Use this only to debug a chart quickly. The graded deployment is the Argo CD one.

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo update
bash scripts/create-secrets.sh
helm upgrade --install metrics-server metrics-server/metrics-server --version 3.14.0 -n kube-system -f monitoring/metrics-server.values.yaml
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack --version 92.17.1 -n monitoring -f monitoring/kube-prometheus-stack.values.yaml --wait --timeout 10m
helm upgrade --install prometheus-adapter prometheus-community/prometheus-adapter --version 5.4.0 -n monitoring -f monitoring/prometheus-adapter.values.yaml
helm upgrade --install monitoring-extras charts/monitoring-extras -n monitoring
helm upgrade --install platform charts/platform -n spendwise -f values/platform.yaml
for f in values/services/*.yaml; do
  n=$(basename "$f" .yaml)
  helm upgrade --install "$n" charts/microservice -n spendwise -f "$f"
done
helm test expense-service -n spendwise          # runs templates/tests/test-health.yaml
```
