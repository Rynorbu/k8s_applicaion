# SpendWise on Kubernetes: Concepts, Design and Presentation Guide

**DSO202 Final Project: Expense Tracker on Kubernetes**
Ranjung Yeshi Norbu · Namgay Wangchuk · Khem Raj Ghalley · Yonten Kinley Tenzin · Tutor: Mr. Saroj Sanyasi

This document explains **what we built, what each technology is, why we used it, and how it works in our project**. Use it to prepare the presentation and to answer the tutor's questions.

| File | Use it for |
|---|---|
| `step-by-step.md` | Doing the work and taking screenshots |
| `instruction.md` | Reference manual and troubleshooting |
| `concept.md` (this file) | Understanding and explaining it |

---

## Contents

1. [Project summary](#1-project-summary)
2. [The application we deployed](#2-the-application-we-deployed)
3. [Kubernetes building blocks we used](#3-kubernetes-building-blocks-we-used)
4. [Helm: packaging the application (requirement a)](#4-helm-packaging-the-application-requirement-a)
5. [GitOps with Argo CD (requirement b)](#5-gitops-with-argo-cd-requirement-b)
6. [Monitoring with Prometheus and Grafana (requirement c)](#6-monitoring-with-prometheus-and-grafana-requirement-c)
7. [Auto-scaling on custom metrics (requirement d)](#7-auto-scaling-on-custom-metrics-requirement-d)
8. [Dashboards (requirement e)](#8-dashboards-requirement-e)
9. [High availability and capacity plan](#9-high-availability-and-capacity-plan)
10. [End-to-end flows](#10-end-to-end-flows-tell-these-as-stories)
11. [Security practices](#11-security-practices)
12. [Changes from the proposal](#12-changes-from-the-proposal-and-why)
13. [Presentation plan](#13-presentation-plan-slide-by-slide)
14. [Questions the tutor may ask](#14-questions-the-tutor-may-ask-with-answers)
15. [Glossary](#15-glossary)

---

## 1. Project summary

**Aim.** Deploy a 17-microservice expense tracker on Kubernetes so that it:
- is **delivered from Git**,
- **heals and scales itself**, and
- is **monitored in real time**.

**What we did, in one paragraph.** We run a local 3-node Kubernetes cluster (kind). The application is packaged with **Helm**: one reusable chart deploys all 17 microservices and the frontend, each with its own values file, and a second chart runs PostgreSQL and RabbitMQ as **StatefulSets** with persistent volumes. **Argo CD** watches our GitHub repository and continuously makes the cluster match it. An **ApplicationSet** creates one Argo CD application per service automatically. **Prometheus** collects metrics from every service, the database, the message broker and the cluster itself. **Grafana** shows them on three custom dashboards. **Horizontal Pod Autoscalers** add and remove pods based on **custom application metrics** (requests per second per pod, and the number of messages waiting in a RabbitMQ queue), not only CPU.

**Mapping to the assignment:**

| Requirement | What we built | Main files |
|---|---|---|
| a. Helm charts | 3 charts: `microservice` (shared), `platform`, `monitoring-extras` | `charts/` and `values/` |
| b. GitOps with Argo CD | App of Apps, plus an ApplicationSet generating 18 apps, plus sync waves; CD by `git push` | `argocd/`, `scripts/release.sh` |
| c. Monitoring | kube-prometheus-stack (Prometheus, Grafana, exporters), ServiceMonitors, alert rules | `monitoring/`, `charts/monitoring-extras` |
| d. Custom-metric autoscaling | prometheus-adapter plus HPAs on `http_requests_per_second` and `rabbitmq_queue_messages_ready` | `monitoring/prometheus-adapter.values.yaml`, `values/services/*.yaml` |
| e. Dashboards | SpendWise · Application, · Autoscaling, · Infrastructure, plus built-in Kubernetes dashboards | `charts/monitoring-extras/dashboards/` |

---

## 2. The application we deployed

**SpendWise** is a personal-finance web app: users record income and expenses, set budgets and goals, and see analytics. It is built as **microservices**, which means many small, independent programs instead of one big program.

| # | Service | Port | Own database | Role |
|---|---|---|---|---|
| 1 | api-gateway | 8080 | none | Single entry point: checks the JWT, applies rate limits, routes `/api/v1/*` to the right service |
| 2 | auth-service | 4001 | auth | Register, login, access and refresh tokens (RS256 JWT) |
| 3 | user-service | 4002 | users | Profile, settings, base currency |
| 4 | expense-service | 4003 | expenses | Create, list, update and delete expenses (the busiest service) |
| 5 | income-service | 4004 | incomes | Income records |
| 6 | category-service | 4005 | categories | Categories and auto-categorisation |
| 7 | budget-service | 4006 | budgets | Budgets; raises BudgetWarning and BudgetExceeded |
| 8 | recurring-service | 4007 | recurring | Scheduled recurring transactions |
| 9 | goal-service | 4008 | goals | Savings goals and milestones |
| 10 | analytics-service | 4009 | analytics | Dashboard numbers, built from events |
| 11 | notification-service | 4010 | notifications | In-app notifications and e-mails |
| 12 | report-service | 4011 | reports | PDF, CSV and XLSX reports (stored on a volume) |
| 13 | search-service | 4012 | search | Full-text search |
| 14 | currency-service | 4013 | currency | Exchange rates |
| 15 | audit-service | 4014 | audit | Append-only audit log |
| 16 | ai-service | 4015 | ai | Insights, anomalies, forecasts |
| 17 | file-service | 4016 | files | CSV and Excel import (stored on a volume) |
| | frontend | 8080 | none | React single-page app served by nginx |

**Platform components:**
- **PostgreSQL**: one server holding 16 databases, one per service.
- **RabbitMQ**: the message broker.
- **Redis**: cache, rate limits and token revocation.
- **Mailpit**: a fake e-mail server for testing.

**Two architecture rules that matter for Kubernetes:**

1. **Database-per-service.** Each service owns its database and has its own login role. No service can read another service's data. They talk only through APIs or events.
2. **Event-driven.** When something happens (for example, an expense is created), the service saves it, writes an event to an **outbox** table in the same transaction, and publishes it to RabbitMQ. Interested services each have their own queue. Failed events are retried (5 s, 30 s, 2 min) and finally moved to a **dead-letter queue (DLQ)**.

> Why mention this? It explains why we need StatefulSets (database and broker), why queue depth is a meaningful autoscaling metric, and what our dashboards show.

---

## 3. Kubernetes building blocks we used

For each object: **what it is**, then **how we use it**.

### 3.1 Cluster and nodes: kind

- **What it is.** *kind* ("Kubernetes IN Docker") runs each Kubernetes node as a Docker container, so a whole multi-node cluster runs on a laptop.
- **How we use it.** `cluster/kind-cluster.yaml` defines:
  - **1 control-plane and 2 worker nodes**, the same layout as the practicals.
  - The control-plane is labelled `ingress-ready=true`. Its ports 80/443 are mapped to host ports **8000/8443**, so the browser reaches the Ingress at `http://spendwise.localtest.me:8000`.
  - Workers are labelled `spendwise/node-index=1` and `=2`. We use this to pin the stateful tier to worker 1 (see 3.10).

### 3.2 Namespace

- **What it is.** A virtual partition inside the cluster: names, quotas and access rules are scoped to it.
- **How we use it:**

  | Namespace | Contents |
  |---|---|
  | `spendwise` | The application |
  | `monitoring` | Prometheus, Grafana, adapter |
  | `argocd` | GitOps controller |
  | `ingress-nginx` | Ingress controller |
  | `kube-system` | metrics-server |

### 3.3 Pod, ReplicaSet, Deployment

- **Pod.** The smallest unit: one or more containers that share network and storage.
- **ReplicaSet.** Keeps N identical pods running and replaces any that die.
- **Deployment.** Manages ReplicaSets so you can change versions with a **rolling update** and roll back.
- **How we use it.** Each of the **18 stateless workloads** is a Deployment. Our rolling update settings are `maxSurge: 1` and `maxUnavailable: 0`: Kubernetes first starts one new pod, waits until it is *Ready*, then stops one old pod. This gives zero-downtime releases. During a release you can see **two ReplicaSets** (old and new) in Argo CD.

### 3.4 Service (ClusterIP) and DNS

- **What it is.** A stable virtual IP and DNS name in front of a changing set of pods, selected by labels. Traffic is load-balanced across the **Ready** pods only.
- **How we use it.** Each service gets a Service with the same name. For example, expense-service is reachable inside the cluster at `http://expense-service:4003`. The shared ConfigMap gives every service the URLs of the others (`EXPENSE_SERVICE_URL=http://expense-service:4003`), which is service discovery through DNS.

### 3.5 Ingress and Ingress controller

- **What it is.**
  - An **Ingress** is a set of HTTP routing rules (host plus path to a Service).
  - An **Ingress controller** (here NGINX) is the reverse proxy that actually implements them.
- **How we use it.** One Ingress, `spendwise` (in `charts/platform/templates/ingress.yaml`), for host `spendwise.localtest.me`:
  - `/api` goes to `api-gateway:8080`
  - `/docs` goes to `api-gateway:8080` (Swagger UI)
  - `/` goes to `frontend:8080`

  Grafana, Prometheus and Mailpit get their own hosts. This is objective **O3**: a single entry point with path routing.

### 3.6 StatefulSet, headless Service, PVC, PV, StorageClass

**Concepts:**
- **PersistentVolumeClaim (PVC):** a request for storage ("5 Gi, ReadWriteOnce").
- **PersistentVolume (PV):** the actual storage that satisfies the claim.
- **StorageClass:** how PVs are created automatically (dynamic provisioning). On kind it is `standard`, using `rancher.io/local-path`, which is a folder on the node.
- **StatefulSet:** like a Deployment, but every pod has a **stable name** (`postgres-0`), **its own PVC** (`data-postgres-0`, from `volumeClaimTemplates`), a **stable network identity**, and **ordered** start and stop.
- **Headless Service** (`clusterIP: None`): gives each StatefulSet pod its own DNS name (`postgres-0.postgres-headless`).

**How we use it.**
- **PostgreSQL** and **RabbitMQ** are StatefulSets with PVCs (5 Gi and 2 Gi). This is objective **O2**.
- `persistentVolumeClaimRetentionPolicy: Retain` keeps the data even if the StatefulSet is deleted.
- Deleting `postgres-0` brings back a new pod with the **same name and the same PVC**, so all data survives. We demonstrated this: 24,066 rows were still there after deletion.
- PostgreSQL also runs a **sidecar container**, postgres-exporter, that exposes database metrics.
- report-service and file-service are Deployments with a PVC (with `helm.sh/resource-policy: keep`, so uninstalling never deletes user files). Because the volume is ReadWriteOnce, they use the `Recreate` strategy and run one replica.

### 3.7 ConfigMap and Secret

- **ConfigMap:** non-secret configuration as key/value pairs.
- **Secret:** sensitive values. Base64 is only *encoding*, not encryption.
- **How we use it:**
  - `spendwise-config` (ConfigMap) holds the log level, service URLs, JWKS URL, SMTP host and `OTEL_SDK_DISABLED=true`. Every service loads it with `envFrom`.
  - `spendwise-secrets` (Secret) holds 9 keys: database passwords, RabbitMQ and Redis passwords, the internal service token, and the **RSA private key** auth-service uses to sign JWTs. `grafana-admin` holds the Grafana login.
  - **Secrets are created by `scripts/create-secrets.sh`, never committed to Git.** This is a key GitOps rule. In production you would use Sealed Secrets or the External Secrets Operator.

### 3.8 Probes: startup, liveness, readiness

| Probe | Question it answers | Our endpoint | What Kubernetes does when it fails |
|---|---|---|---|
| **startupProbe** | "Has the app finished starting?" | `/health/live`, up to 40 × 3 s = 2 min | Waits. The other probes are paused until it passes, which gives time for database migrations. |
| **livenessProbe** | "Is the process alive?" | `/health/live` every 15 s | **Restarts** the container after 3 failures. |
| **readinessProbe** | "Can it serve traffic right now?" | `/health/ready` (checks database **and** RabbitMQ) every 10 s | **Removes the pod from the Service** (no traffic) until it passes. The pod is *not* restarted. |

This is objective **O6** (self-healing). PostgreSQL and RabbitMQ use `pg_isready` and `rabbitmq-diagnostics` as exec probes.

### 3.9 Init containers

- **What it is.** A container that runs to completion *before* the main container starts.
- **How we use it.** `wait-for-dependencies` (busybox) loops until `postgres:5432`, `rabbitmq:5672` and `redis:6379` accept connections. On a fresh install, the services wait politely instead of crash-looping. In our test, all 18 workloads came up with **0 restarts**.

### 3.10 Scheduling: requests, limits, topology spread, nodeSelector, PDB

- **Resource requests and limits.**
  - The **request** is what the scheduler reserves for the pod (for example, 50 m CPU and 96 Mi memory).
  - The **limit** is the maximum it may use (for example, 500 m and 320 Mi).
  - Requests are also the **baseline for HPA CPU percentages**.
- **topologySpreadConstraints.** Spreads replicas of the same service evenly across nodes (`maxSkew: 1` on `kubernetes.io/hostname`), so one node failure never takes all replicas.
- **nodeSelector.** Pins pods to nodes with a label. We pin PostgreSQL, RabbitMQ, report and file to worker 1, because on kind their volumes are folders on one node. Worker 2 then holds only stateless pods and can be drained safely.
- **PodDisruptionBudget (PDB).** `minAvailable: 1` stops *voluntary* disruptions (`kubectl drain`, upgrades) from evicting the last pod of a service. It is rendered only for services with 2 or more replicas, because a PDB on a single replica would block draining forever.

### 3.11 Security context

All pods run with:
- `runAsNonRoot` (user 1000)
- `readOnlyRootFilesystem: true` (an `emptyDir` is mounted at `/tmp`)
- `allowPrivilegeEscalation: false`
- all Linux capabilities dropped
- a `RuntimeDefault` seccomp profile
- `automountServiceAccountToken: false` (the apps never call the Kubernetes API)

### 3.12 HorizontalPodAutoscaler

See [section 7](#7-auto-scaling-on-custom-metrics-requirement-d).

---

## 4. Helm: packaging the application (requirement a)

### 4.1 What Helm is

Helm is the **package manager for Kubernetes**:

- A **chart** is a folder of templated YAML (`templates/`) plus defaults (`values.yaml`) and metadata (`Chart.yaml`).
- `helm install` renders the templates with **values** and applies them as a named **release**.
- Every upgrade creates a new **revision**, so `helm rollback` is possible.

**Problems Helm solves:**
- copy-pasted YAML for 18 services
- no application-level version
- no single command to install or remove everything

**What Helm does *not* do:**
- build images
- continuously reconcile the cluster (that is the GitOps tool's job)
- keep secrets secret

### 4.2 Our three charts

```text
charts/microservice/        ← ONE chart reused 18 times
  Chart.yaml                  name, version 1.0.0, kubeVersion >=1.29
  values.yaml                 safe defaults for any service
  values.schema.json          JSON-Schema validation of values
  templates/_helpers.tpl      name, labels, selector labels, secretEnv helpers
  templates/deployment.yaml   init container, envFrom, secrets, 3 probes, resources, security
  templates/service.yaml      ClusterIP Service
  templates/hpa.yaml          autoscaling/v2: Resource + Pods + External metrics
  templates/pdb.yaml          only if replicas > 1
  templates/pvc.yaml          only if persistence.enabled
  templates/servicemonitor.yaml  Prometheus scraping
  templates/NOTES.txt         help text after install
  templates/tests/test-health.yaml  `helm test` pod (wget /health/ready)

charts/platform/            ← shared infrastructure
  templates/postgres.yaml     ConfigMap(init script) + headless Svc + Svc + StatefulSet(+exporter) + ServiceMonitor
  templates/rabbitmq.yaml     headless Svc + Svc + StatefulSet + ServiceMonitor (per-queue metrics)
  templates/redis-mailpit.yaml
  templates/configmap.yaml    spendwise-config
  templates/ingress.yaml      path routing
  files/01-create-databases.sh  creates 16 databases + 16 roles (database-per-service)

charts/monitoring-extras/   ← our dashboards and alerts
  dashboards/*.json           3 Grafana dashboards
  templates/dashboards.yaml   one ConfigMap per JSON (label grafana_dashboard=1)
  templates/prometheusrule.yaml  9 alert rules
```

### 4.3 The key idea: one chart, many values files

Every service is the same *kind* of thing: a container with a port, maybe a database, probes, metrics and maybe autoscaling. So we wrote the template **once**, and each service has a short values file with only what differs. For example, `values/services/expense-service.yaml`:

```yaml
image: { repository: spendwise/expense-service, tag: dev }
port: 4003
database: expenses          # chart builds DATABASE_URL for role expenses_svc
replicaCount: 2
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 8
  cpu: { enabled: true, averageUtilization: 80 }
  podsMetrics:
    - name: http_requests_per_second
      averageValue: "5"
```

**Benefits:**
- A fix in the template (for example, a new security setting) applies to all 18 services at once.
- Adding a service means adding one values file.
- This is objective **O4**.

**Values precedence**, from lowest to highest priority:
1. chart `values.yaml`
2. `-f` files
3. `--set` flags

Maps merge deeply; lists and scalars are replaced.

### 4.4 Template techniques we used

- **Helpers** (`define`/`include`) for consistent names and labels (`app.kubernetes.io/name`, `part-of`, `version`, `managed-by`, `helm.sh/chart`).
- **Stable selector labels.** The selector uses only `name` and `part-of`, because selectors cannot change after creation.
- **Conditionals:**
  - `{{- if .Values.autoscaling.enabled }}` renders the HPA.
  - When the HPA is on, the Deployment **omits `replicas`**, so Helm, Argo CD and the HPA never fight over the replica count.
- **Loops** (`range`) for env vars, secret refs and HPA metrics.
- **`fail`** stops rendering with a clear message if autoscaling is enabled without any metric.
- **`toYaml | nindent`** inserts maps such as resources and securityContext with correct indentation.
- **`.Files.Get` / `.Files.Glob`** embed the database init script and the dashboard JSON files.

### 4.5 Validation (what we showed)

| Check | Catches | Command |
|---|---|---|
| `helm lint --strict` + `values.schema.json` | Template errors, wrong types, out-of-range values | `helm lint charts/microservice -f values/services/x.yaml --strict` |
| Deliberate failure | Schema working: `replicaCount=50` → `maximum: got 50, want 10` | `helm template … --set replicaCount=50` |
| Server-side dry run | Unknown or misspelled fields the API server rejects | `helm template … \| kubectl apply --dry-run=server -f -` |
| `helm test` | The deployed service really answers | `helm test expense-service -n spendwise` |

---

## 5. GitOps with Argo CD (requirement b)

### 5.1 What GitOps is

GitOps means **Git is the single source of truth** for what should run in the cluster. It rests on four principles:

1. **Declarative.** The desired state is described in files (YAML, Helm values).
2. **Versioned and immutable.** It lives in Git, with history, review and revert.
3. **Pulled automatically.** An agent *inside* the cluster pulls changes. CI never needs cluster admin credentials.
4. **Continuously reconciled.** The agent keeps comparing Git with the cluster and fixes any difference (drift).

**Push vs pull:**
- In traditional CI/CD, the pipeline runs `kubectl apply` (it *pushes*), so it needs cluster credentials, and manual changes drift silently.
- With GitOps, **Argo CD pulls**. A deploy is a `git commit`; a rollback is a `git revert`; `git log` is the audit trail.

### 5.2 Argo CD architecture

| Component | Job |
|---|---|
| `argocd-server` | Web UI, CLI and API |
| `argocd-repo-server` | Clones Git and renders Helm charts into plain YAML |
| `argocd-application-controller` | Compares desired (Git) with live (cluster) state, and syncs |
| `argocd-applicationset-controller` | Generates Applications from templates (our ApplicationSet) |

**Status of each app:**
- **Sync status:** Synced or OutOfSync.
- **Health:** Healthy, Progressing or Degraded.

### 5.3 Our Argo CD objects

```text
argocd/project.yaml         AppProject "spendwise": which repos and namespaces are allowed (guard-rails)
argocd/root-app.yaml        App of Apps: the ONLY thing applied by hand
argocd/apps/
  metrics-server.yaml       wave -3   Helm chart from kubernetes-sigs repo + our values (multi-source)
  monitoring.yaml           wave -2   kube-prometheus-stack chart + our values (ServerSideApply)
  prometheus-adapter.yaml   wave -1   adapter chart + our custom-metric rules
  monitoring-extras.yaml    wave -1   our dashboards + alerts chart
  platform.yaml             wave  0   our platform chart
  services-appset.yaml      wave  1   ApplicationSet → 18 Applications
```

- **App of Apps.** `spendwise-root` points at the folder `argocd/apps/`. Everything in that folder becomes an Argo CD Application. One `kubectl apply` bootstraps the whole system, and after that even the Argo CD apps themselves are managed from Git.
- **ApplicationSet with the Git files generator.** It scans `dso202-final-project/values/services/*.yaml`. For **each file** it creates an Application with:
  - the same name as the file,
  - the shared chart `charts/microservice`,
  - that file as its values,
  - destination namespace `spendwise`.

  It creates 18 apps, each with its own sync status, health, history and rollback. **Adding a 19th service means committing one values file. Deleting a file deletes the app.** This is objective **O5**.
- **Sync waves** (the `argocd.argoproj.io/sync-wave` annotation) set the order. For example, the Prometheus Operator CRDs (`ServiceMonitor`, `PrometheusRule`) must exist before our charts create those objects.
- **Sync policy:**
  - `automated` makes Argo CD sync without anyone clicking Sync.
  - `prune: true` deletes resources that were removed from Git.
  - `selfHeal: true` reverts manual changes made in the cluster.
- **Sync options:**
  - `CreateNamespace=true`.
  - `ServerSideApply=true`, because the Prometheus CRDs are too big for client-side apply.
  - `SkipDryRunOnMissingResource=true` plus **retry with backoff**, so an app that runs before the CRDs exist simply retries.
- **Multi-source Applications.** The chart comes from the public Helm repository, and the values come from *our* Git repo (`ref: values` and `$values/...`), so the third-party configuration is also in Git.
- **Finalizer** (`resources-finalizer.argocd.argoproj.io`). Deleting an Application also deletes its Kubernetes resources.

### 5.4 Continuous deployment flow (`scripts/release.sh`)

```text
developer ──► release.sh expense-service v1.0.1
                1. docker build spendwise/expense-service:v1.0.1
                2. kind load docker-image        (our "registry" on a laptop)
                3. edit values/services/expense-service.yaml  → tag: v1.0.1
                4. git commit + git push
GitHub ──────────────────────────────────────────────────────────────►
Argo CD (polls every 3 min, or click Refresh) ──► OutOfSync ──► helm template ──► apply
Deployment ──► new ReplicaSet ──► rolling update (maxSurge 1, maxUnavailable 0) ──► Synced + Healthy
```

**The script never talks to the cluster API to deploy.** The only deploy action is `git push`.

In a real pipeline, GitHub Actions would:
1. build, test and scan the image,
2. push it to a registry (GHCR),
3. commit the new tag.

The repository's `.github/workflows/ci-cd.yml` already contains those steps.

### 5.5 What we demonstrated

| Demo | Action | Result |
|---|---|---|
| Deploy | `release.sh expense-service v1.0.1` | Argo CD rolled out the new image |
| Scale through Git | Changed `replicaCount` 2 → 3 and pushed | A third pod appeared |
| Self-heal | `kubectl scale … --replicas=1` | Argo CD restored 2 within seconds |
| Rollback | `git revert HEAD && git push` | Previous version restored (also visible in *History and Rollback*) |
| Drift detection | Auto-sync disabled, then scaled to 0 | App shown **OutOfSync** until re-synced |

---

## 6. Monitoring with Prometheus and Grafana (requirement c)

### 6.1 How Prometheus works

- **Pull model.** Every 15 s, Prometheus sends `GET /metrics` to each target (it *scrapes*) and stores the result as **time series**: a metric name plus labels gives a list of (timestamp, value) pairs.

  ```text
  http_request_duration_seconds_count{service="expense-service",method="POST",route="/api/v1/expenses/",status_code="201",pod="expense-service-7f..."}  1532
  ```

- **Metric types:**
  - **counter:** only goes up, for example total requests. Use `rate()` on it.
  - **gauge:** goes up and down, for example queue depth.
  - **histogram:** buckets, for example latency. Use `histogram_quantile()` for p95.
- **PromQL** is the query language. For example, `rate(x[1m])` is the per-second increase averaged over 1 minute.
- **Alert rules** are PromQL conditions that must hold for a time (`for: 2m`) before they fire.

### 6.2 Prometheus Operator and kube-prometheus-stack

We installed **kube-prometheus-stack** (chart 92.17.1) with Argo CD. It includes:

| Component | Role |
|---|---|
| **Prometheus Operator** | Manages Prometheus through CRDs, so scraping is configured with Kubernetes objects instead of editing `prometheus.yml` |
| **Prometheus** | Stores metrics; 3-day retention on a 5 Gi PVC |
| **Grafana** | Dashboards, with a sidecar that loads dashboards from ConfigMaps |
| **kube-state-metrics** | Metrics *about Kubernetes objects*: pod phase, deployment replicas, HPA current/desired replicas |
| **node-exporter** | Node CPU, memory, disk and network (a DaemonSet, one pod per node) |
| **kubelet / cAdvisor** | Per-container CPU and memory |

**CRDs we use:**
- **ServiceMonitor:** "scrape the Services with these labels, on port `http`, path `/metrics`, every 15 s". Our microservice chart renders one per service. The platform chart renders them for postgres-exporter and RabbitMQ.
- **PrometheusRule:** our alert rules.

We set `serviceMonitorSelectorNilUsesHelmValues: false`, so Prometheus picks up ServiceMonitors from *every* release, not only its own.

### 6.3 What our application exposes

Every SpendWise service exposes these metrics (`prom-client`):

| Metric | Type | Meaning |
|---|---|---|
| `http_request_duration_seconds` | histogram | Every HTTP request, by route and status code. Gives **rate, errors and duration** (the *RED* method). |
| `events_published_total{type}` | counter | Events sent from the outbox to RabbitMQ |
| `events_consumed_total{type,outcome}` | counter | Events handled, by outcome: success, duplicate, retry, dead_letter |
| `event_processing_duration_seconds` | histogram | Time to handle an event |
| `outbox_pending_events` | gauge | Events not yet published (a broker problem shows here) |
| `spendwise_business_events_total{name}` | counter | Business KPIs such as expense_created and user_registered |
| `nodejs_*`, `process_*` | various | Heap, event-loop lag, CPU (Node.js defaults) |

**Exporters:**
- **postgres-exporter** (a sidecar in `postgres-0`): `pg_up`, connections per database, database size, transactions per second.
- **RabbitMQ's built-in Prometheus plugin** (port 15692): `/metrics` for broker totals, and `/metrics/detailed?family=queue_coarse_metrics` for **per-queue depth**, `rabbitmq_detailed_queue_messages_ready{queue}`.

### 6.4 Alert rules (`charts/monitoring-extras/templates/prometheusrule.yaml`)

| Alert | Condition | Why |
|---|---|---|
| SpendWiseServiceDown | `up == 0` for 2 m | A pod cannot be scraped |
| SpendWiseDeploymentUnavailable | available replicas `== 0` for 2 m | A whole service is down (works even with 0 pods) |
| SpendWisePodCrashLooping | more than 3 restarts in 15 m | A crash loop |
| SpendWiseHighErrorRate | 5xx above 5% for 5 m | Users see errors |
| SpendWiseHighLatency | p95 above 1 s for 10 m | Slow service |
| SpendWiseDeadLetteredEvents | DLQ has messages | Events failing permanently |
| SpendWiseOutboxBacklog | outbox above 100 for 5 m | Cannot publish to RabbitMQ |
| SpendWiseHPAAtMaxReplicas | current ≥ max for 10 m | **Capacity**: raise the maximum or add nodes |
| SpendWisePVCAlmostFull | volume above 85% (on cloud storage) | **Capacity**: grow the disk |

Alertmanager (which sends alerts on to e-mail or Slack) is disabled to save memory. The alerts are evaluated and visible in the Prometheus **Alerts** page.

### 6.5 Out of scope

As agreed, the project does not cover **OpenTelemetry** tracing or **ELK/Loki** logging. The services' tracing SDK is switched off with `OTEL_SDK_DISABLED=true`. Logs are structured JSON, read with `kubectl logs`.

---

## 7. Auto-scaling on custom metrics (requirement d)

### 7.1 How the HPA decides

Every 15 seconds, the HorizontalPodAutoscaler calculates, **for each metric**:

```text
desiredReplicas = ceil( currentReplicas × currentMetricValue / targetValue )
```

It then uses the **highest** result, clamped between `minReplicas` and `maxReplicas`.

**Example:** expense-service has 2 pods, receiving 9.85 req/s each, with a target of 5. That gives ceil(2 × 9.85 / 5) = ceil(3.94) = **4 pods**.

`behavior` controls the speed:
- **Scale up:** at most +2 pods every 30 s.
- **Scale down:** wait for a 2-minute *stabilisation window*, then at most −1 pod per minute. This prevents flapping (up, down, up).

### 7.2 Where the metrics come from: three metric APIs

```text
                     ┌───────────────────────────────┐
 kubelet (cAdvisor) ─► metrics-server ─► metrics.k8s.io           ── "Resource" metrics (CPU, memory)
                     └───────────────────────────────┘
 app /metrics ─► Prometheus ─► prometheus-adapter ─► custom.metrics.k8s.io   ── "Pods" metrics (per pod)
                                                  └► external.metrics.k8s.io ── "External" metrics (e.g. a queue)
                                                                   │
                                          HorizontalPodAutoscaler ◄┘
```

- **metrics-server** gives CPU and memory. We run it with `--kubelet-insecure-tls` because kind's kubelets use self-signed certificates.
- **prometheus-adapter** registers itself as an **APIService** with the Kubernetes API server. When the HPA asks "what is `http_requests_per_second` for these pods?", the adapter runs a PromQL query and answers.

### 7.3 Our adapter rules (`monitoring/prometheus-adapter.values.yaml`)

```yaml
custom:
  - seriesQuery: 'http_request_duration_seconds_count{namespace!="",pod!=""}'
    resources: { overrides: { namespace: {resource: namespace}, pod: {resource: pod} } }
    name: { matches: "^http_request_duration_seconds_count$", as: "http_requests_per_second" }
    metricsQuery: 'sum(rate(<<.Series>>{<<.LabelMatchers>>}[1m])) by (<<.GroupBy>>)'
external:
  - seriesQuery: 'rabbitmq_detailed_queue_messages_ready{namespace!="",queue!=""}'
    resources: { overrides: { namespace: {resource: namespace} } }
    name: { as: "rabbitmq_queue_messages_ready" }
    metricsQuery: 'sum(<<.Series>>{<<.LabelMatchers>>}) by (<<.GroupBy>>)'
```

How to read it:
- `seriesQuery` chooses which Prometheus series to use.
- `resources` maps the Prometheus labels `namespace` and `pod` to Kubernetes objects.
- `name` gives the Kubernetes metric name.
- `metricsQuery` is the PromQL that produces the value. Here it is the **request rate per pod over the last minute**.

### 7.4 Our HPAs

| Service | Min–max | Metrics (HPA uses the highest) | Why this metric |
|---|---|---|---|
| **api-gateway** | 2–6 | `http_requests_per_second` 10 per pod (**Pods**) + CPU 80% | Every request goes through it, so load equals request rate |
| **expense-service** | 2–8 | `http_requests_per_second` 5 per pod (**Pods**) + CPU 80% | The busiest write path. Each create triggers events to 5 services. |
| **analytics-service** | 1–5 | `rabbitmq_queue_messages_ready{queue=analytics-service.events}` 20 per pod (**External**) + CPU 80% | It does its work from a queue. A growing backlog means it needs more consumers. CPU cannot see a backlog. |

**Why custom metrics are better than CPU alone:**
- Node.js services are often waiting on the database (I/O-bound), so CPU can stay low while requests pile up.
- The request rate measures *demand* directly.
- Queue depth measures *work waiting*.
- CPU stays as a safety net.

### 7.5 Lessons from tuning (good to tell the tutor)

1. **Our first test scaled on CPU, not the custom metric.** The CPU request was only 25 m, so normal use looked like 200–280% CPU, and CPU always "won" the max() comparison.

   **Fix:** a realistic request of 100 m with an 80% target, and request-rate targets of 10 and 5 per pod. Now, under load, CPU stays at **46–73%** (below target) while the request rate is above target. **The custom metric is what keeps the service scaled out.** You can prove it with `kubectl describe hpa`.

2. **A metric that reports `<unknown>` blocks scale-down.** analytics-service first also had an HTTP-rate metric, but it gets almost no HTTP traffic, so the value was `<unknown>`. When any metric is unavailable, the HPA will scale *up* but never *down*: it stayed at 3 pods. We removed that metric, so it now scales on queue depth and CPU only.

### 7.6 Measured results

**Load test:** a k6 Job inside the cluster ramps to 80 req/s, holds, then ramps down. 70% of the requests are `GET /expenses` and 30% are `POST /expenses`.

| Time | api-gateway | expense-service |
|---|---|---|
| t+0 s | 2 pods | 2 pods |
| t+91 s | 3 pods (12.95 req/s per pod against a target of 10) | 4 pods (9.6 against a target of 5) |
| t+152–183 s | **6 pods (max)** | **8 pods (max)** |
| hold | CPU 57–70% < 80%, request rate about 12.7 > 10 | CPU 46–60% < 80%, request rate about 9.5 > 5 |
| after the load | 2 pods about 3.5 min later | 2 pods about 6 min later (−1 per minute) |

- **k6 totals:** 28,842 requests at 57 req/s average, with **0.49% errors**. The errors were HTTP 500s at the peak, while new pods were starting. The Grafana *4xx/5xx* panel shows them.
- **Queue test:**
  1. analytics was paused and the queue grew to **about 6,000 messages**.
  2. On resume, the HPA saw about 1,461 messages per pod against a target of 20, and went 1 → **3 pods**, the +2 per 30 s limit.
  3. The queue **drained to 0 in about 1 minute**.
  4. The HPA scaled back to 1.

---

## 8. Dashboards (requirement e)

**Dashboards as code.**
- The dashboards are JSON files generated by `scripts/build-dashboards.mjs`, stored in Git, and packaged as ConfigMaps labelled `grafana_dashboard: "1"`.
- Grafana's **sidecar** watches for those ConfigMaps and loads them into the *SpendWise* folder.
- Changing a dashboard therefore means a Git commit, and Argo CD deploys it.
- All panels use the Prometheus datasource (`uid: prometheus`).

| Dashboard | Purpose | Panels |
|---|---|---|
| **SpendWise · Application** | "Are users OK?" The **golden signals**: traffic, errors, latency, saturation. | Service pods up · total req/s · 5xx rate · p95 latency · outbox backlog · dead-lettered events · request rate by service · p95 by service · 4xx/5xx by service · busiest routes table · events published/consumed/processing p95 · business events · Node.js heap · event-loop lag. Filters: namespace, service. |
| **SpendWise · Autoscaling** | "Is the HPA doing the right thing?" | Current vs desired replicas · max replicas per HPA · **requests/s per pod with the dashed target line** · RabbitMQ messages waiting · events processed per pod · CPU used/requested per pod |
| **SpendWise · Infrastructure** | "Is the platform healthy?" (USE: utilisation, saturation, errors) | Nodes ready · pods running / not ready · restarts · cluster CPU and memory · CPU and memory by node · top pods by CPU and memory · network I/O · PVC sizes · PostgreSQL up, connections by database, database size, transactions/s · RabbitMQ queue depth, publish/deliver rates, connections, DLQ depth |

The built-in kube-prometheus-stack dashboards complete the infrastructure view:
- *Kubernetes / Compute Resources / Namespace (Pods)*
- *Node Exporter / Nodes*
- *Kubernetes / Persistent Volumes*

**Design choices:**
- Status colours (green, amber, red) only on stat panels with thresholds.
- Table legends with *Last* and *Max* values.
- The dashed red line on the autoscaling panel is the HPA target, so viewers immediately see "above the line means it scales out".

---

## 9. High availability and capacity plan

### 9.1 How the system survives failures

| Failure | What protects us |
|---|---|
| Container crash or hang | Deployment/ReplicaSet recreates the pod; the liveness probe restarts a hung process |
| Dependency down (database, broker) | The readiness probe takes the pod out of the Service, so users are not sent to a broken pod |
| Node lost or drained | 2+ replicas for critical services, **spread over both workers**, plus a **PDB** (`minAvailable: 1`) |
| Bad release | Rolling update with `maxUnavailable: 0`, readiness gate, `git revert` rollback |
| Someone changes the cluster by hand | Argo CD self-heal |
| Traffic spike | HPA on request rate, queue depth and CPU |
| Message broker restarts | Durable queues on a PVC; the outbox keeps events until they are published; retries and DLQ |
| Database pod deleted | StatefulSet with a stable PVC; data survives (proved: 24,066 rows) |

**Replica plan:**

| Replicas | Services |
|---|---|
| 2 or more | gateway (2–6), expense (2–8), auth (2), category (2), frontend (2) |
| 1 | the other 11 services, analytics (1–5) |
| 1 (RWO volume) | report, file |
| 1 (StatefulSet) | postgres, rabbitmq |

### 9.2 Honest limitations: single points of failure, and the production fix

| Limitation | Production fix |
|---|---|
| **PostgreSQL is a single pod.** If it restarts, services are NotReady for about 15 s. | **CloudNativePG** operator (3 instances with streaming replication and automatic failover; the Operators topic in Unit II), or a managed database (RDS or Cloud SQL) |
| **RabbitMQ is a single pod.** | RabbitMQ Cluster Operator with 3 nodes and **quorum queues** |
| **kind volumes are node-local folders.** The stateful pods are pinned to worker 1, and if worker 1 goes down they wait. | Cloud network storage (EBS or Persistent Disk) can re-attach to another node |
| **Report and file data on RWO volumes**, so one replica | Object storage (S3 or MinIO), so they can scale horizontally |
| **One control-plane node** | Managed Kubernetes (EKS, GKE or AKS) with 3 control-plane nodes |
| **Single-replica services** (11) restart elsewhere in a few seconds during a drain | Set `replicaCount: 2`. It is one line per values file. |

### 9.3 Capacity plan

**Measured** with `kubectl top`:
- about **40 MiB** of memory per Node.js service
- 5–60 m CPU per pod, from idle to about 13 req/s
- PostgreSQL about 175 MiB
- RabbitMQ about 120 MiB
- at peak, everything (services, platform and monitoring) used about **1.4 cores and 3.2 GiB**

**Reserved** (requests):

| Group | Pods | CPU | Memory |
|---|---|---|---|
| Services at baseline | 23 | ~1.25 cores | ~2.2 GiB |
| Extra pods at HPA max | +14 | +1.2 cores | +1.3 GiB |
| Platform | 4 | 0.24 cores | 0.6 GiB |
| Monitoring | 9 | 0.26 cores | 0.85 GiB |
| Argo CD | 7 | — | ~0.5 GiB actual |
| System | ~12 | — | ~0.6 GiB |
| **Total at peak** | **~69 pods** | **~3.9 cores** | **~6 GiB** |

- **Laptop requirement:** Docker with **8 GB of RAM and 4 CPUs**.
- **Throughput at maximum replicas:** about 75–80 req/s, measured with 0.5% errors. That is enough for about 500 active users at 5–6 actions per minute.
- **When to scale the platform:**
  - `SpendWiseHPAAtMaxReplicas` firing for more than 10 minutes means raise `maxReplicas`.
  - Node CPU above 70% or memory above 75% on the Infrastructure dashboard means add a node.
- **Production sizing:** 3 nodes × 4 vCPU / 16 GB, with 2 replicas of every service, a 3-instance database and a 3-node broker. This survives losing one node (N+1).
- **Storage:**

  | Volume | Size |
  |---|---|
  | PostgreSQL | 5 Gi |
  | RabbitMQ | 2 Gi |
  | Prometheus | 5 Gi (3 days, about 100k series ≈ 1.5 GB) |
  | Reports | 2 Gi |
  | Files | 2 Gi |
  | Grafana | 1 Gi |

---

## 10. End-to-end flows (tell these as stories)

**A. A user adds an expense:**
1. The browser sends `POST http://spendwise.localtest.me:8000/api/v1/expenses`.
2. The NGINX Ingress matches `/api` and forwards to the `api-gateway` Service, which load-balances to a **Ready** gateway pod.
3. The gateway verifies the JWT (public key from auth-service's JWKS), applies rate limits in Redis, and forwards to `expense-service:4003`.
4. expense-service asks category-service for the category, then saves the row in **its own** database (`expenses` on `postgres-0`). In the same transaction, it writes `ExpenseCreated` to its **outbox**.
5. The outbox relay publishes the event to RabbitMQ. budget, analytics, notification, ai and audit each receive a copy in their own queue.
6. budget-service may raise `BudgetWarning`, and notification-service then sends an e-mail (visible in Mailpit).
7. Prometheus scrapes every service involved, so the request and the events appear on the Application dashboard.
8. If many users do this at once, the request rate per pod rises and the **HPA adds expense-service pods**.

**B. A developer releases a new version:**
1. `release.sh` builds the image, loads it, changes the tag in Git and pushes.
2. Argo CD notices the commit (OutOfSync).
3. The repo-server renders the Helm chart with the new tag, and the controller applies it.
4. The Deployment does a rolling update: the new pod becomes Ready, then an old one is removed. **No downtime and no kubectl.**
5. If it is bad, `git revert` brings back the previous version.

**C. Something breaks:**
1. A pod crashes, and the liveness probe or controller restarts or replaces it.
2. If it keeps crashing, `SpendWisePodCrashLooping` fires.
3. The Infrastructure dashboard shows the restarts.
4. If someone "fixes" it by hand, Argo CD reverts the change so that Git remains the truth.

---

## 11. Security practices

- **Secrets never in Git.** They are created with a script in the cluster, and only Secret *references* appear in the charts.
- **Pods run as non-root** with a read-only root filesystem, no privilege escalation, all capabilities dropped and a seccomp profile.
- **No Kubernetes API token is mounted** in the app pods.
- **Database isolation:** 16 databases and 16 roles; `CONNECT` is revoked from `PUBLIC`.
- **Internal endpoints** (`/internal/*`) require a shared token and are never routed by the gateway.
- **JWT signed with RS256.** The private key is in a Secret, shared by all auth replicas, so tokens stay valid when a different replica answers.
- **An Argo CD AppProject** limits which repositories and namespaces can be deployed to.
- **Images are pinned to versions** (no `latest`). Helm chart and Argo CD versions are pinned.

---

## 12. Changes from the proposal (and why)

| Proposal said | We did | Reason |
|---|---|---|
| 16 microservices | **17 microservices + frontend** (18 Deployments) | The API Gateway is also a microservice; the slides should say 17 |
| HPA scales on CPU | **Custom metrics** (request rate, queue depth) **plus** CPU | The assignment requires auto-scaling on custom metrics (d) |
| HPA on Expense and **Report** | HPA on **Expense, API Gateway and Analytics** | Report files live on a ReadWriteOnce volume, so a second replica on another node could not read them. Analytics is a better custom-metric example (queue depth). |
| Prometheus + Grafana | Plus prometheus-adapter, exporters, 9 alert rules, 3 custom dashboards | Needed for custom metrics and for "comprehensive dashboards" |
| — | Added PDBs, topology spread, init containers, values schema, a k6 load test, `release.sh` | High availability, reliability and a CD demo |

**Update the slides:**
1. "16" becomes "17 microservices + frontend".
2. The scaling row becomes "HPA on custom metrics (requests/s, queue depth) + CPU".
3. The expected outcome becomes "HPA scales Gateway, Expense and Analytics".

---

## 13. Presentation plan (slide by slide)

Aim for **12–15 minutes** plus questions. Split the speaking between the 4 members, for example one member per part.

| # | Slide | Content | Show (live or screenshot) | Speaker idea |
|---|---|---|---|---|
| 1 | Title | Project name, group, tutor | — | Member 1 |
| 2 | Aim and objectives | Aim (section 1) and O1–O7 | — | Member 1 |
| 3 | Architecture | Diagram from instruction.md §1; the 17 services; database-per-service; events | Screenshot 23 (pods on both workers) | Member 1 |
| 4 | Kubernetes objects | Deployment, Service, Ingress, StatefulSet + PVC, ConfigMap/Secret, probes, PDB | Screenshots 24, 29 | Member 1 |
| 5 | Helm | One shared chart and 18 values files; templates; schema; lint | Screenshots 08–15. **Live:** `helm lint` loop | Member 2 |
| 6 | GitOps concept | Push vs pull, the 4 principles | — | Member 2 |
| 7 | Argo CD design | App of Apps, ApplicationSet, sync waves, self-heal and prune | Screenshots 18–21 | Member 2 |
| 8 | CD demo | `release.sh` → OutOfSync → rolling update → rollback | **Live**, with screenshots 32–35 as backup | Member 2 |
| 9 | Monitoring stack | Prometheus pull model, ServiceMonitor, exporters, alerts | Screenshots 36–38 | Member 3 |
| 10 | Dashboards | The 3 dashboards and what each answers | Screenshots 40–43 (or live Grafana) | Member 3 |
| 11 | Custom-metric autoscaling | Metrics pipeline diagram (§7.2), HPA formula, our 3 HPAs | Screenshots 44–46 | Member 4 |
| 12 | Autoscaling demo | Load test: replicas 2 → 6 / 2 → 8; queue demo | **Live** (start the k6 job at the start of the slide), backup screenshots 47–56 | Member 4 |
| 13 | HA and capacity | Failure table, drain demo, measured capacity, limitations and production plan | Screenshots 57–62 | Member 3 |
| 14 | Challenges and lessons | CPU dominating the HPA, `<unknown>` metric, node-local storage, slow image pulls | — | Member 4 |
| 15 | Conclusion and future work | Gateway API, Sealed Secrets, CloudNativePG, cloud cluster, CI to GHCR | — | Member 1 |

**Live-demo tips:**
- Start the cluster **1 hour before**, and check all 24 apps are green.
- Open the browser tabs beforehand: Argo CD, Grafana Autoscaling, Prometheus, the app.
- Start the **k6 load test at the beginning** of the autoscaling slide. The HPA needs 1–2 minutes to react, so talk about the theory while it ramps up.
- Keep the screenshots in the slides as a **backup** in case the network or laptop is slow.

---

## 14. Questions the tutor may ask (with answers)

**Helm**

1. *Why one chart for all services instead of 18 charts?*
   The services share the same shape. One chart means one place to fix or improve things: a security setting added once applies to all 18. Each service's differences live in a short values file. The ApplicationSet then turns each values file into its own release.
2. *What is the difference between `values.yaml` in the chart and `values/services/x.yaml`?*
   The chart's `values.yaml` has safe defaults for any service. The per-service file overrides only what differs. Helm merges them, and the later file wins.
3. *What does `values.schema.json` do?*
   It validates the merged values with JSON Schema on lint, template, install and upgrade. For example, `replicaCount` must be an integer between 1 and 10. It catches wrong types that YAML would accept silently.
4. *Why does the Deployment have no `replicas` when the HPA is on?*
   Otherwise Helm and Argo CD would keep resetting the replicas to the Git value, fighting the HPA. Leaving it out lets the HPA own the replica count.
5. *Helm vs Argo CD: don't they overlap?*
   Helm **renders and packages**. Argo CD **decides when and where to apply, and keeps reconciling**. Argo CD runs `helm template` internally and applies the result. The release is tracked by Argo CD, not by `helm list`.

**GitOps / Argo CD**

6. *What is GitOps, and why is pull better than push?*
   Git is the source of truth, and an in-cluster agent pulls and reconciles. CI needs no cluster credentials, drift is detected and corrected automatically, and every change is a reviewed commit that can be audited and reverted.
7. *What is an ApplicationSet?*
   A template plus a generator. Our Git files generator creates one Application per values file. Adding or removing a file adds or removes an app.
8. *What are App of Apps and sync waves?*
   The root Application manages the other Application manifests, so one apply bootstraps everything. Sync waves order them: CRDs and monitoring first, then the platform, then the services.
9. *What do `selfHeal` and `prune` do?*
   `selfHeal` reverts manual cluster changes to match Git (we demonstrated it with `kubectl scale`). `prune` deletes resources that were removed from Git.
10. *How do you roll back?*
    `git revert` the commit, and Argo CD syncs the previous state. The UI's *History and Rollback* also works, but it pauses auto-sync; Git remains the source of truth.
11. *How do you handle secrets in GitOps?*
    We never commit them; a script creates them in the cluster. In production we would use Sealed Secrets (encrypted secrets that *can* be committed) or the External Secrets Operator (secrets pulled from a vault).
12. *Where are the images? There is no registry.*
    On kind, `kind load docker-image` copies them into the nodes, and the charts use `IfNotPresent`. On a real cluster, CI pushes them to a registry (GHCR) and the values files point there.

**Monitoring**

13. *How does Prometheus find our services?*
    Through ServiceMonitor objects, one per service, created by our chart. The Prometheus Operator turns them into scrape configuration. Prometheus then pulls `/metrics` every 15 s.
14. *What is kube-state-metrics, compared with node-exporter or metrics-server?*
    - **kube-state-metrics:** the state of Kubernetes *objects* (replicas, pod phase, HPA status).
    - **node-exporter:** the *node's* hardware and OS metrics.
    - **metrics-server:** live CPU and memory for the HPA and `kubectl top`. It is not stored over time.
15. *What is p95 latency?*
    95% of requests are faster than this value. It is calculated from histogram buckets with `histogram_quantile(0.95, …)`.
16. *How are the dashboards deployed?*
    As JSON in ConfigMaps (from our monitoring-extras chart, via Argo CD). Grafana's sidecar loads every ConfigMap labelled `grafana_dashboard=1`. Dashboards are code in Git.

**Autoscaling**

17. *How does the HPA calculate replicas?*
    `ceil(current × currentValue / target)` for each metric, then the maximum across metrics, within min and max. `behavior` limits the speed.
18. *What does prometheus-adapter do?*
    It implements the Kubernetes custom and external metrics APIs. When the HPA asks for a metric, the adapter runs the configured PromQL against Prometheus and returns the value.
19. *Why not just CPU?*
    These services are I/O-bound, so CPU doesn't reflect demand well. The request rate measures demand directly, and queue depth measures waiting work, which CPU can't see at all. CPU stays as a safety net.
20. *How do you know the custom metric, not CPU, caused the scaling?*
    `kubectl get hpa` and `describe hpa` show both values. During the hold, CPU was 46–73% (below the 80% target) while the request rate was above target, so only the custom metric required more pods. The HPA events also say "pods metric http_requests_per_second above target".
21. *Pods vs External metrics?*
    A **Pods** metric belongs to each pod and is averaged (request rate). An **External** metric is not tied to a pod (RabbitMQ queue depth); `AverageValue` divides it by the replica count.
22. *Why didn't the report service autoscale as in the proposal?*
    Its files are on a ReadWriteOnce volume that only one node can mount, so extra replicas couldn't read them. Object storage would fix this.

**HA / Kubernetes**

23. *Liveness vs readiness?*
    Liveness failure means the container is restarted. Readiness failure means the pod is removed from the Service endpoints but not restarted. We use readiness to check the database and broker.
24. *Why a StatefulSet for PostgreSQL?*
    It gives a stable pod name, its own persistent volume that re-attaches after restart, and ordered start and stop. A Deployment's pods are interchangeable and would share or lose storage.
25. *What does a PodDisruptionBudget do?*
    It limits *voluntary* evictions (drain, upgrade). `minAvailable: 1` means at least one pod of the service must stay up, so the drain waits.
26. *What happens if a node dies?*
    Stateless pods are recreated on the other worker. Services with 2+ replicas keep serving because the replicas are spread over both nodes. On kind, the stateful tier is pinned to worker 1 because its volumes are local folders. Losing worker 1 would pause the database until the node returns, and on a cloud cluster with network storage it would move. That is a documented limitation.
27. *Why kind and not minikube or a cloud cluster?*
    kind gives real multi-node clusters on a laptop at no cost, and it was used in the practicals. Everything here (charts, Argo CD, monitoring) works unchanged on EKS, GKE or AKS. Only the storage class and the image registry change.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **App of Apps** | An Argo CD Application whose content is other Application manifests |
| **ApplicationSet** | An Argo CD object that generates Applications from a template and a generator |
| **CRD** | Custom Resource Definition: adds a new object type to Kubernetes, such as ServiceMonitor |
| **Drift** | The live cluster differs from Git |
| **DLQ** | Dead-letter queue: where messages go after all retries fail |
| **Exporter** | A program that exposes another system's metrics in Prometheus format |
| **HPA** | HorizontalPodAutoscaler: changes the replica count based on metrics |
| **Headless Service** | A Service with `clusterIP: None`, giving per-pod DNS for StatefulSets |
| **Ingress** | HTTP routing rules; the Ingress controller implements them |
| **Outbox** | A table where a service stores events in the same transaction as its data, before publishing them |
| **PDB** | PodDisruptionBudget: a minimum number of pods kept during voluntary disruptions |
| **PromQL** | Prometheus Query Language |
| **PVC / PV / StorageClass** | Storage request / actual storage / automatic provisioner |
| **Reconciliation** | Continuously comparing desired and actual state, and fixing the difference |
| **Release (Helm)** | One installed instance of a chart, with revisions |
| **ServiceMonitor** | A Prometheus Operator object saying which Services to scrape |
| **StatefulSet** | A workload with stable names, per-pod storage and ordered rollout |
| **Sync wave** | An Argo CD ordering number; lower waves are applied first |
| **Topology spread** | A rule that spreads replicas evenly across nodes |
