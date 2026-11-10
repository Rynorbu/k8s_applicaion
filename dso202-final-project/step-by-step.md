# SpendWise on Kubernetes: Step-by-Step Lab Guide with Screenshots

This is the **practical checklist** for doing the DSO202 final project from scratch on your laptop. It also tells you **exactly which screenshots to take**.

- Do the steps in order. Do not skip any.
- Each 📸 box tells you what to capture and what to name the file.
- For the theory behind each step (what it is and why), read **[concept.md](concept.md)**.
- For extra detail and troubleshooting, see **[instruction.md](instruction.md)**.

**Time needed:** about 2–3 hours the first time. Most of it is waiting for images to download.

---

## How to take and save screenshots

1. **Snipping tool:** press **`Win + Shift + S`**, drag a box around the area, then click the notification. In the Snipping Tool, press **`Ctrl + S`** to save.
2. **Save every screenshot in one folder:** `spendwise/dso202-final-project/evidence/`. Create it once:

   ```bash
   mkdir -p evidence
   ```

3. **Use the file name given** in each 📸 box, for example `evidence/01-tools-versions.png`. The numbers keep them in order for your report and slides.
4. For terminal screenshots, make sure the **command and its output** are both visible. Maximise the terminal window and use a readable font size (`Ctrl` + `+`).
5. For browser screenshots, include the **address bar**, so the tutor can see the URL.
6. Also save text output as **files**, which is useful for the report appendix. Wherever you see `| tee evidence/xx.txt`, the output is shown on screen *and* saved.

> Tip: open **two Git Bash terminals**. Use **Terminal 1** for commands and **Terminal 2** for long-running watches and port-forwards.

---

## Part A: Prepare your laptop

### Step A1: Open Git Bash in the project folder

1. Open **Git Bash**. Do **not** use PowerShell or CMD; the scripts are Bash.
2. Go to the project folder:

   ```bash
   cd ~/OneDrive/Desktop/K8s_application/spendwise/dso202-final-project
   pwd
   ls
   ```

   You should see `instruction.md`, `concept.md`, `charts/`, `argocd/`, `values/`, `monitoring/`, `scripts/` and so on.

### Step A2: Give Docker enough memory

1. Open **Docker Desktop**, then **Settings** (gear icon), then **Resources**.
2. Set **Memory to at least 8 GB** and **CPUs to at least 4**. Click **Apply & restart**.
   - If you use the WSL 2 backend and there is no slider, create `C:\Users\<you>\.wslconfig` containing `[wsl2]` and `memory=8GB` on the next line. Then run `wsl --shutdown` in PowerShell and restart Docker Desktop.

### Step A3: Stop other clusters (frees about 4 GB)

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

Stop anything that is another Kubernetes cluster. On this laptop that means the `ingress-*` kind cluster and the `k3d-usms-*` cluster:

```bash
docker stop ingress-control-plane ingress-worker ingress-worker2
docker stop k3d-usms-eks-cluster-server-0 k3d-usms-eks-cluster-agent-0 k3d-usms-eks-cluster-agent-1 k3d-usms-eks-cluster-serverlb
```

These are only stopped, not deleted. Start them again later with `docker start <name>`.

### Step A4: Check the tools

```bash
docker version --format 'Docker {{.Server.Version}}'
kind version
kubectl version --client
helm version --short
git --version
node --version
```

> 📸 **Screenshot 01: `evidence/01-tools-versions.png`**
> The terminal showing all six version outputs.

---

## Part B: Put the project on GitHub (GitOps needs Git)

### Step B1: Create the GitHub repository

1. Go to **https://github.com/new**.
2. Fill in the form:
   - **Repository name:** `spendwise`
   - **Visibility:** **Public**. Argo CD can then read it without a password.
   - **Do NOT** tick "Add a README".
3. Click **Create repository**. Keep the page open, because you need the URL: `https://github.com/<your-username>/spendwise.git`.

### Step B2: Point Argo CD at your repository

Replace `<your-username>` with your GitHub username:

```bash
bash scripts/set-repo-url.sh https://github.com/<your-username>/spendwise.git
grep -rh "repoURL\|- https://github" argocd/ | sort -u
```

Every line must now show **your** URL. None should say `YOUR-GITHUB-USERNAME`.

### Step B3: Commit and push

```bash
cd ..                                   # go to spendwise/ (the repository root)
git add .
git commit -m "DSO202 final project: Helm charts, Argo CD, monitoring, autoscaling"
git branch -M main
git remote add origin https://github.com/<your-username>/spendwise.git
git push -u origin main
cd dso202-final-project                 # back to the project folder
```

A browser window may open asking you to log in to GitHub. Log in and allow access.

> 📸 **Screenshot 02: `evidence/02-github-repo.png`**
> Your GitHub repository page in the browser, with the `dso202-final-project` folder visible.
>
> 📸 **Screenshot 03: `evidence/03-github-folder.png`**
> Click into `dso202-final-project/` so the `argocd`, `charts`, `monitoring` and `values` folders are visible.

---

## Part C: Create the Kubernetes cluster

### Step C1: Create the kind cluster (1 control-plane + 2 workers)

```bash
cat cluster/kind-cluster.yaml
kind create cluster --config cluster/kind-cluster.yaml
```

This takes about 1–3 minutes. Then check it:

```bash
kubectl config current-context          # must print: kind-spendwise
kubectl get nodes -o wide | tee evidence/c1-nodes.txt
```

**Expected:** three nodes, all `Ready`: `spendwise-control-plane`, `spendwise-worker` and `spendwise-worker2`.

> 📸 **Screenshot 04: `evidence/04-kind-nodes.png`**
> The `kubectl get nodes -o wide` output with all 3 nodes Ready.

### Step C2: Load the application images into the cluster

The SpendWise images (`spendwise/api-gateway:dev` and the others) already exist in your local Docker from the earlier `docker compose` build. Check:

```bash
docker images | grep "^spendwise/" | wc -l          # should print 18
```

- If it prints **18**, run `bash scripts/load-images.sh`.
- If it prints **less than 18**, run `BUILD=1 bash scripts/load-images.sh`. This builds them first and takes 10–20 minutes.

Loading takes about 5–10 minutes. Then verify:

```bash
docker exec spendwise-worker crictl images | grep spendwise
```

> 📸 **Screenshot 05: `evidence/05-images-loaded.png`**
> The `crictl images` list showing the 18 `spendwise/...` images inside the node.

### Step C3: Install the NGINX Ingress controller

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/kind/deploy.yaml
kubectl wait -n ingress-nginx --for=condition=Ready pod -l app.kubernetes.io/component=controller --timeout=300s
kubectl -n ingress-nginx get pods -o wide
```

**Expected:** `ingress-nginx-controller-...` is `1/1 Running` on `spendwise-control-plane`.

> 📸 **Screenshot 06: `evidence/06-ingress-controller.png`**
> The ingress controller pod Running.

### Step C4: Create the Secrets (never stored in Git)

```bash
bash scripts/create-secrets.sh
```

At the end it prints **`Grafana login: admin / <password>`**. **Copy that password** into a notepad; you need it later.

```bash
kubectl -n spendwise get secrets
kubectl -n monitoring get secrets
kubectl -n spendwise describe secret spendwise-secrets     # shows key NAMES and sizes, not values
```

> 📸 **Screenshot 07: `evidence/07-secrets.png`**
> The `describe secret` output listing the 9 keys (byte sizes only, not the values). This shows the secrets exist in the cluster but **not in Git**.
> Do **not** screenshot the Grafana password.

---

## Part D: Helm charts (requirement a)

### Step D1: Look at the chart structure

```bash
find charts -maxdepth 2 | sort
ls values/services/
cat values/services/expense-service.yaml
```

> 📸 **Screenshot 08: `evidence/08-chart-structure.png`**
> The `find charts` tree and the list of 18 values files.
>
> 📸 **Screenshot 09: `evidence/09-values-expense.png`**
> The contents of `expense-service.yaml`: image, port, database and the autoscaling block with `http_requests_per_second`.

Also open these files in **VS Code** and screenshot them for your report:

> 📸 **Screenshot 10: `evidence/10-template-deployment.png`**
> `charts/microservice/templates/deployment.yaml` in VS Code. Scroll so the **init container and the three probes** (startup, liveness, readiness) are visible.
>
> 📸 **Screenshot 11: `evidence/11-template-hpa.png`**
> `charts/microservice/templates/hpa.yaml`, showing the `Resource`, `Pods` and `External` metric blocks.
>
> 📸 **Screenshot 12: `evidence/12-postgres-statefulset.png`**
> `charts/platform/templates/postgres.yaml`, showing `kind: StatefulSet`, `volumeClaimTemplates` and the headless Service.

### Step D2: Lint every chart

```bash
for f in values/services/*.yaml; do
  helm lint charts/microservice -f "$f" --strict >/dev/null && echo "ok   $(basename "$f")" || echo "FAIL $f"
done | tee evidence/d2-lint.txt
helm lint --strict charts/platform -f values/platform.yaml
helm lint --strict charts/monitoring-extras
```

**Expected:** 18 × `ok`, then `1 chart(s) linted, 0 chart(s) failed` twice.

> 📸 **Screenshot 13: `evidence/13-helm-lint.png`**
> All 18 `ok` lines plus the two "0 chart(s) failed" lines.

### Step D3: Render a chart (see what Helm produces)

```bash
helm template expense-service charts/microservice -f values/services/expense-service.yaml -n spendwise | grep "^kind:"
```

**Expected:** `Service`, `Deployment`, `HorizontalPodAutoscaler`, `PodDisruptionBudget`, `ServiceMonitor` and `Pod` (the helm test).

> 📸 **Screenshot 14: `evidence/14-helm-template.png`**
> The list of kinds generated for one service.

### Step D4: Prove the values schema works (a deliberate failure)

```bash
helm template bad charts/microservice -f values/services/expense-service.yaml --set replicaCount=50
```

**Expected:** an **error**: `at '/replicaCount': maximum: got 50, want 10`. This is good: the chart refuses bad values.

> 📸 **Screenshot 15: `evidence/15-schema-validation.png`**
> The schema error message.

---

## Part E: GitOps with Argo CD (requirement b)

### Step E1: Install Argo CD

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.6/manifests/install.yaml
kubectl wait -n argocd --for=condition=Ready pods --all --timeout=600s
kubectl -n argocd get pods
```

> 📸 **Screenshot 16: `evidence/16-argocd-pods.png`**
> All Argo CD pods Running: server, repo-server, application-controller, applicationset-controller, redis, dex and notifications.

### Step E2: Open the Argo CD UI

In **Terminal 2**, run this and leave it running:

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

In **Terminal 1**, get the admin password:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
```

1. Open **https://localhost:8080** in Chrome or Edge.
2. Click **Advanced → Continue to localhost** to accept the self-signed certificate.
3. Log in with user **`admin`** and the password above.

The **Applications** page is empty at this point.

> 📸 **Screenshot 17: `evidence/17-argocd-empty.png`**
> The empty Argo CD Applications page, taken *before* GitOps starts.

### Step E3: Bootstrap everything from Git (the only manual apply)

```bash
kubectl apply -f argocd/project.yaml
kubectl apply -f argocd/root-app.yaml
```

Watch it work. In Terminal 1:

```bash
kubectl -n argocd get applications -w
```

Within about 30 seconds the apps start appearing. The full first sync takes **about 10–15 minutes** while images download. Press `Ctrl + C` to stop watching.

In the **Argo CD UI**, watch the tiles appear. Order of appearance:

| Wave | App |
|---|---|
| −3 | metrics-server |
| −2 | monitoring |
| −1 | prometheus-adapter, monitoring-extras |
| 0 | platform |
| 1 | the 18 service apps |

Wait until **every tile is green**: **Synced** and **Healthy**. Some apps show `Progressing` or `Degraded` for a few minutes, which is normal while PostgreSQL starts.

```bash
kubectl -n argocd get applications | tee evidence/e3-applications.txt
kubectl -n argocd get applications --no-headers | wc -l        # expect 24
```

> 📸 **Screenshot 18: `evidence/18-argocd-all-apps.png`**
> The Argo CD Applications page in **tile view**, with all 24 apps Synced and Healthy. Zoom out (`Ctrl` + `-`) so they all fit.
>
> 📸 **Screenshot 19: `evidence/19-argocd-root-tree.png`**
> Click **spendwise-root**. The tree view shows the root app connected to its 5 Applications and the ApplicationSet. This is the **App of Apps** pattern.
>
> 📸 **Screenshot 20: `evidence/20-argocd-expense-tree.png`**
> Click **expense-service**. The tree shows Deployment → ReplicaSet → Pods, plus Service, HPA, PDB and ServiceMonitor.
>
> 📸 **Screenshot 21: `evidence/21-argocd-platform-tree.png`**
> Click **platform**. The tree shows the `postgres` and `rabbitmq` StatefulSets, their PVCs, the Ingress and the ConfigMap.
>
> 📸 **Screenshot 22: `evidence/22-argocd-cli-list.png`**
> Terminal output of `kubectl -n argocd get applications` (24 rows).

### Step E4: Check what is running in the cluster

```bash
kubectl -n spendwise get pods -o wide | tee evidence/e4-pods.txt
kubectl -n spendwise get deploy,sts,svc,ingress,pvc,hpa,pdb | tee evidence/e4-resources.txt
```

**Expected:**
- All pods are `Running`, with READY `1/1` (and `postgres-0` at `2/2`).
- Pods of the same service sit on **different workers** (the NODE column).
- There are 3 HPAs, several PDBs, and 4 PVCs (postgres, rabbitmq, report and file).

> 📸 **Screenshot 23: `evidence/23-pods-wide.png`**
> `get pods -o wide`, showing pods spread across `spendwise-worker` and `spendwise-worker2`.
>
> 📸 **Screenshot 24: `evidence/24-all-resources.png`**
> The `get deploy,sts,svc,ingress,pvc,hpa,pdb` output. You may need two screenshots for it all.

---

## Part F: Open the application

### Step F1: Use SpendWise in the browser

Open **http://spendwise.localtest.me:8000**. The `localtest.me` name always points to your own computer.

1. Click **Register** and create an account, for example `demo@example.com` with password `DemoPassw0rd123`.
2. Add **2 incomes** and **5–6 expenses** in different categories.
3. Create **one budget** (for example, Food: 100) and **one goal**.
4. Open the **Dashboard**.

> 📸 **Screenshot 25: `evidence/25-app-dashboard.png`**
> The SpendWise dashboard with your data, with the address bar visible (`spendwise.localtest.me:8000`).

### Step F2: Swagger API docs and e-mail

1. Open **http://spendwise.localtest.me:8000/docs**. This is the Swagger UI; use the dropdown at the top to switch between services.
2. Open **http://mail.localtest.me:8000**. This is Mailpit, which catches the e-mails the app sends. Your **"Welcome to SpendWise"** e-mail is there.

> 📸 **Screenshot 26: `evidence/26-swagger.png`**
> The Swagger UI page.
>
> 📸 **Screenshot 27: `evidence/27-mailpit-welcome.png`**
> The welcome e-mail in Mailpit. It proves the event flow: auth-service → RabbitMQ → notification-service.

> **If a `*.localtest.me` page does not open** (for example, no internet DNS), use port-forwards instead:
> `kubectl -n spendwise port-forward svc/frontend 8081:8080`, then open http://localhost:8081.

---

## Part G: Self-healing and GitOps demos

### Step G1: Self-healing: delete a pod

In **Terminal 2**, run this and keep it visible:

```bash
kubectl -n spendwise get pods -l app.kubernetes.io/name=expense-service -w
```

In **Terminal 1**:

```bash
kubectl -n spendwise delete pod -l app.kubernetes.io/name=expense-service --wait=false
```

A new pod appears within seconds, and the app keeps working while it starts.

> 📸 **Screenshot 28: `evidence/28-selfheal-pod.png`**
> Terminal 2 showing the old pods `Terminating` and the new pods `ContainerCreating`, then `Running`.

### Step G2: Database survives a restart (StatefulSet + PVC)

```bash
kubectl -n spendwise exec postgres-0 -c postgres -- psql -U postgres -d expenses -tAc "select count(*) from expenses"
kubectl -n spendwise delete pod postgres-0
kubectl -n spendwise get pods postgres-0 -w          # wait for 2/2 Running, then Ctrl+C
kubectl -n spendwise get pvc data-postgres-0
kubectl -n spendwise exec postgres-0 -c postgres -- psql -U postgres -d expenses -tAc "select count(*) from expenses"
```

**Expected:** the **same count** before and after. The pod has the **same name** (`postgres-0`) and the **same PVC**. Refresh the app: your data is still there.

> 📸 **Screenshot 29: `evidence/29-statefulset-persistence.png`**
> Both counts, plus the PVC still `Bound`.

### Step G3: GitOps self-heal (Argo CD reverts manual changes)

1. In the Argo CD UI, open **category-service**.
2. In Terminal 1, run:

   ```bash
   kubectl -n spendwise scale deploy category-service --replicas=1
   kubectl -n spendwise get deploy category-service -w      # watch: 1 → back to 2
   ```

   Argo CD sees that the cluster no longer matches Git (OutOfSync) and sets the replicas back to **2** within seconds.

> 📸 **Screenshot 30: `evidence/30-gitops-selfheal.png`**
> The terminal showing `READY 1/1` then `2/2` again. Also screenshot the Argo CD app's **Events** or the sync status if you catch it OutOfSync.

### Step G4: Scale through Git

1. Open `values/services/category-service.yaml` in VS Code and change `replicaCount: 2` to `replicaCount: 3`.
2. Commit and push from the repository root:

   ```bash
   cd .. && git add -A && git commit -m "scale category-service to 3" && git push && cd dso202-final-project
   ```

3. In the Argo CD UI, click **category-service**, then **REFRESH**. Argo CD otherwise checks Git every 3 minutes.
4. Watch it become **OutOfSync** and then **Synced**, with 3 pods.

```bash
kubectl -n spendwise get pods -l app.kubernetes.io/name=category-service
```

> 📸 **Screenshot 31: `evidence/31-gitops-scale.png`**
> The 3 category-service pods, and the Argo CD app showing the new commit message in **Last Sync**.

### Step G5: Continuous deployment of a new version (the main GitOps demo)

1. Make a small visible change. For example, in VS Code open `services/expense-service/src/app.js` and change any log message.
   > This step is optional; the release works even without a change.
2. Run the release script:

   ```bash
   bash scripts/release.sh expense-service v1.0.1
   ```

   The script:
   1. builds the image `spendwise/expense-service:v1.0.1`
   2. loads it into kind
   3. changes `tag: v1.0.1` in `values/services/expense-service.yaml`
   4. commits and pushes

   **It never runs `kubectl apply`.**
3. In Argo CD, click **expense-service → REFRESH**. You can now watch:
   - **OutOfSync**, then **Syncing**
   - a new **ReplicaSet** appearing in the tree
   - pods replaced one by one (rolling update)
4. Verify the new image:

   ```bash
   kubectl -n spendwise rollout status deploy/expense-service
   kubectl -n spendwise get deploy expense-service -o jsonpath='{.spec.template.spec.containers[0].image}'; echo
   ```

   **Expected:** `spendwise/expense-service:v1.0.1`.

> 📸 **Screenshot 32: `evidence/32-release-script.png`**
> The terminal output of `release.sh`, including the git diff that shows `tag: dev` → `tag: v1.0.1`.
>
> 📸 **Screenshot 33: `evidence/33-argocd-rolling-update.png`**
> The Argo CD expense-service tree during the sync, showing **two ReplicaSets** (old and new).
>
> 📸 **Screenshot 34: `evidence/34-new-image.png`**
> The `rollout status` and image output showing `v1.0.1`.

### Step G6: Rollback with Git

```bash
cd .. && git revert HEAD --no-edit && git push && cd dso202-final-project
```

In Argo CD, **REFRESH** expense-service and watch it roll back to `tag: dev`.

```bash
kubectl -n spendwise get deploy expense-service -o jsonpath='{.spec.template.spec.containers[0].image}'; echo
```

> 📸 **Screenshot 35: `evidence/35-rollback.png`**
> The image back to `:dev`, plus Argo CD **History and Rollback** (App Details → History) listing both commits.

---

## Part H: Monitoring with Prometheus and Grafana (requirements c and e)

### Step H1: Prometheus targets

1. Open **http://prometheus.localtest.me:8000**.
2. Go to **Status → Target health** (on older versions, **Status → Targets**).
3. Type `spendwise` in the filter box.

**Expected:** about 20 targets in the `spendwise` namespace, all **UP**: the 17 services, postgres, and 2 × rabbitmq.

> 📸 **Screenshot 36: `evidence/36-prometheus-targets.png`**
> The targets page with the spendwise targets **UP**.

### Step H2: Run PromQL queries

1. In Prometheus, click **Query**.
2. Paste each query below, click **Execute**, then switch to the **Graph** tab.

```promql
sum by (service) (rate(http_request_duration_seconds_count{namespace="spendwise"}[1m]))
```

```promql
histogram_quantile(0.95, sum by (service, le) (rate(http_request_duration_seconds_bucket{namespace="spendwise"}[5m])))
```

```promql
sum by (queue) (rabbitmq_detailed_queue_messages_ready{namespace="spendwise"})
```

> 📸 **Screenshot 37: `evidence/37-promql-rps.png`**
> The graph of request rate per service. Click around the app first so there is data.

### Step H3: Alert rules

Go to **Alerts** in Prometheus and expand the `spendwise.*` groups.

> 📸 **Screenshot 38: `evidence/38-prometheus-alerts.png`**
> The list of SpendWise alert rules (all green "Inactive" is fine).

### Step H4: Grafana dashboards

1. Open **http://grafana.localtest.me:8000** and log in as **`admin`** with the password from Step C4.
2. Click **Dashboards** in the left menu, then open the **SpendWise** folder.
3. Open each of the 3 dashboards. Set the time picker (top right) to **Last 30 minutes**.

> 📸 **Screenshot 39: `evidence/39-grafana-folder.png`**
> The SpendWise folder with the 3 dashboards.
>
> 📸 **Screenshot 40: `evidence/40-grafana-application.png`**
> **SpendWise · Application**: services up, request rate, latency, events.
>
> 📸 **Screenshot 41: `evidence/41-grafana-infrastructure.png`**
> **SpendWise · Infrastructure**: nodes, pods, PostgreSQL and RabbitMQ. Scroll and take 2 screenshots if needed.
>
> 📸 **Screenshot 42: `evidence/42-grafana-k8s-builtin.png`**
> A built-in dashboard: **Kubernetes / Compute Resources / Namespace (Pods)** with namespace `spendwise` selected.
>
> 📸 **Screenshot 43: `evidence/43-grafana-node-exporter.png`**
> The built-in **Node Exporter / Nodes** dashboard.

> **If Grafana or Prometheus does not open**, port-forward instead:
> - Grafana: `kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80`, then http://localhost:3000
> - Prometheus: `kubectl -n monitoring port-forward svc/monitoring-prometheus 9090:9090`, then http://localhost:9090

---

## Part I: Auto-scaling on custom metrics (requirement d)

### Step I1: Check the metric APIs exist

```bash
kubectl get apiservices | grep metrics
kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1/namespaces/spendwise/pods/*/http_requests_per_second" | head -c 400; echo
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/spendwise/rabbitmq_queue_messages_ready?labelSelector=queue%3Danalytics-service.events"; echo
kubectl -n spendwise get hpa
```

**Expected:**
- Three API services (`metrics.k8s.io`, `custom.metrics.k8s.io` and `external.metrics.k8s.io`), all `True`.
- JSON values for both metrics.
- 3 HPAs.

> If `http_requests_per_second` says *not found*, use the app for a minute first. The metric only exists after a service has received requests.

> 📸 **Screenshot 44: `evidence/44-metrics-apis.png`**
> The `apiservices` output (three lines, all True).
>
> 📸 **Screenshot 45: `evidence/45-custom-metric-raw.png`**
> The JSON from the custom and external metrics APIs.
>
> 📸 **Screenshot 46: `evidence/46-hpa-before.png`**
> `kubectl get hpa` **before the load**. Replicas are at the minimum: gateway 2, expense 2, analytics 1.

### Step I2: Prepare the screen for the load-test demo

1. **Browser:** open Grafana → **SpendWise · Autoscaling**, time range **Last 15 minutes**, refresh **10s**.
2. **Terminal 2:**

   ```bash
   kubectl -n spendwise get hpa -w
   ```

### Step I3: Start the load test (request-rate autoscaling)

In **Terminal 1**:

```bash
kubectl apply -f loadtest/k6-job.yaml
kubectl -n spendwise logs -f job/loadtest        # Ctrl+C any time; the test keeps running
```

The test runs **8 minutes**: 2 minutes ramping up to 80 req/s, 4 minutes holding, 2 minutes ramping down.

Watch Terminal 2. Within about 1–3 minutes:
- **api-gateway** goes from 2 to **6** pods (its target is `…m/10`).
- **expense-service** goes from 2 to **8** pods (its target is `…m/5`).

**How to read the TARGETS column.** For example, `cpu: 57%/80%, 12700m/10`:
- CPU is at 57% against an 80% target, so CPU is **not** what is scaling it.
- The request rate is 12.7 req/s per pod against a target of 10, so the **custom metric is driving the scaling**.

While the load is at its peak (about 3–6 minutes in), take the screenshots:

> 📸 **Screenshot 47: `evidence/47-hpa-scaling.png`**
> Terminal 2 showing the REPLICAS column rising (2 → 3 → 5 → 6 and 2 → 4 → 6 → 8).
>
> 📸 **Screenshot 48: `evidence/48-hpa-describe.png`**
> Run `kubectl -n spendwise describe hpa expense-service` and capture the **Metrics:** section and the **Events** (`New size: 4; reason: pods metric http_requests_per_second above target`).
>
> 📸 **Screenshot 49: `evidence/49-pods-scaled.png`**
> `kubectl -n spendwise get pods -l app.kubernetes.io/name=expense-service -o wide`, showing 8 pods across both workers.
>
> 📸 **Screenshot 50: `evidence/50-grafana-autoscaling-peak.png`**
> The **SpendWise · Autoscaling** dashboard at the peak: replicas rising, and req/s per pod above the dashed target line.
>
> 📸 **Screenshot 51: `evidence/51-grafana-application-load.png`**
> **SpendWise · Application** during the load (request rate around 75–80 req/s).

When the test finishes, k6 prints a summary (`http_reqs`, `http_req_failed`):

```bash
kubectl -n spendwise logs job/loadtest --tail=30 | tee evidence/i3-k6-summary.txt
```

> 📸 **Screenshot 52: `evidence/52-k6-summary.png`**
> The k6 summary (total requests, failure %).

Wait **about 6–8 minutes** after the test ends. The HPAs remove one pod per minute.

> 📸 **Screenshot 53: `evidence/53-hpa-scaled-down.png`**
> `kubectl get hpa` with replicas back to 2 / 2 / 1. In Grafana, the Autoscaling replicas graph shows the "mountain" shape: up, hold, down.

### Step I4: Queue-depth autoscaling (analytics-service)

This shows scaling on something CPU cannot see: work waiting in a queue.

1. Pause the consumer:

   ```bash
   kubectl -n spendwise delete job loadtest --ignore-not-found
   kubectl -n spendwise scale deploy analytics-service --replicas=0
   ```

2. Create a backlog by running the load test again for about **3–4 minutes**:

   ```bash
   kubectl apply -f loadtest/k6-job.yaml
   ```

   In Grafana (**Autoscaling → RabbitMQ messages waiting**), the line for `analytics-service.events` climbs into the thousands.

> 📸 **Screenshot 54: `evidence/54-queue-backlog.png`**
> The Grafana panel with the queue growing.

3. Resume the consumer:

   ```bash
   kubectl -n spendwise scale deploy analytics-service --replicas=1
   kubectl -n spendwise get hpa analytics-service -w
   ```

   Within about 30–60 seconds, TARGETS shows something like `1461334m/20 (avg)`, which means about 1,461 waiting messages per pod against a target of 20. Replicas jump to **3**, and later up to 5 if the backlog stays big. The queue drains to 0 and the HPA scales back to 1.

> 📸 **Screenshot 55: `evidence/55-queue-hpa.png`**
> The HPA output with the big external-metric value and replicas above 1.
>
> 📸 **Screenshot 56: `evidence/56-queue-drained.png`**
> Grafana showing the queue line dropping back to 0.

```bash
kubectl -n spendwise delete job loadtest --ignore-not-found
```

---

## Part J: High availability demos

### Step J1: Drain a worker node (simulated node failure or maintenance)

The **stateful tier** (`postgres-0`, `rabbitmq-0`, report-service and file-service) is pinned to **worker 1** (`spendwise-worker`) with a `nodeSelector`. On kind, each volume is a folder on one node. **Worker 2 holds only stateless pods**, so it is the one we drain. Check first:

```bash
kubectl -n spendwise get pods -o wide | tee evidence/j1-before.txt   # postgres-0 and rabbitmq-0 are on spendwise-worker
kubectl drain spendwise-worker2 --ignore-daemonsets --delete-emptydir-data
```

While it drains, keep using the app in the browser. It keeps working:
- The multi-replica services always keep at least one pod, because the **PodDisruptionBudget** blocks evicting the last one.
- The evicted pods are recreated on `spendwise-worker`.

```bash
kubectl get nodes
kubectl -n spendwise get pods -o wide | tee evidence/j1-after.txt
kubectl -n spendwise get pdb
```

**Expected:**
- `spendwise-worker2` shows `Ready,SchedulingDisabled`.
- Every pod is Running on `spendwise-worker`.
- The app still works.

Do **not** drain `spendwise-worker`. The database volume lives there, so PostgreSQL would wait (Pending) until the node came back. This is the limitation of node-local storage that concept.md section 9 explains.

> 📸 **Screenshot 57: `evidence/57-drain.png`**
> `kubectl get nodes` (SchedulingDisabled) and pods all on `spendwise-worker`.
>
> 📸 **Screenshot 58: `evidence/58-pdb.png`**
> `kubectl -n spendwise get pdb` (MIN AVAILABLE 1, ALLOWED DISRUPTIONS).

Bring the node back:

```bash
kubectl uncordon spendwise-worker2
kubectl get nodes
```

### Step J2: An alert firing (and Argo CD drift detection)

1. In Argo CD, open **user-service**, then **DETAILS** (or **App Details**), then **DISABLE AUTO-SYNC**, and confirm.
2. Scale it to zero:

   ```bash
   kubectl -n spendwise scale deploy user-service --replicas=0
   ```

3. In Argo CD, the app turns **OutOfSync** (yellow). It detected the drift but is not fixing it, because auto-sync is off.
4. Wait **2–3 minutes**, then open Prometheus → **Alerts**. **SpendWiseDeploymentUnavailable** is **Firing** (red).

> 📸 **Screenshot 59: `evidence/59-argocd-outofsync.png`**
> user-service OutOfSync in Argo CD.
>
> 📸 **Screenshot 60: `evidence/60-alert-firing.png`**
> The firing alert in Prometheus.

5. Re-enable **auto-sync** in Argo CD. It restores 1 replica, and the alert resolves.

### Step J3: Capacity numbers (for the capacity plan)

```bash
kubectl top nodes | tee evidence/j3-top-nodes.txt
kubectl top pods -n spendwise --sort-by=memory | tee evidence/j3-top-pods.txt
kubectl top pods -n monitoring | tee evidence/j3-top-monitoring.txt
kubectl describe nodes | grep -A8 "Allocated resources" | tee evidence/j3-allocated.txt
```

> 📸 **Screenshot 61: `evidence/61-kubectl-top.png`**
> `kubectl top nodes` and `kubectl top pods` (about 40 MiB per service).
>
> 📸 **Screenshot 62: `evidence/62-allocated.png`**
> The "Allocated resources" (requests/limits) section of the nodes.

---

## Part K: Final checklist before presenting

- [ ] All 62 screenshots are in `evidence/` with the right names.
- [ ] The `.txt` evidence files are saved (nodes, lint, applications, pods, k6 summary, top).
- [ ] Slides updated with the changes from the proposal (see concept.md, section 12): **17 microservices + frontend**, **custom-metric HPA**, **gateway and analytics autoscaled instead of report**.
- [ ] You can explain each concept in **concept.md** in your own words. Practise the Q&A in section 14.
- [ ] On presentation day: create the cluster **1 hour before** and run Part E, so all apps are already green. Do the **live** demos for steps G1, G5, I3 and J1, and show screenshots for the rest.

## Part L: After the project (clean-up)

```bash
kind delete cluster --name spendwise
# restart your other clusters if you need them
docker start ingress-control-plane ingress-worker ingress-worker2
```

---

### Screenshot index (for the report appendix)

| # | File | Shows | Requirement |
|---|---|---|---|
| 01 | tools-versions | tool versions | setup |
| 02–03 | github-* | Git repository = source of truth | b |
| 04–07 | kind-nodes, images, ingress, secrets | cluster, Ingress, secrets outside Git | setup |
| 08–15 | chart-structure … schema-validation | Helm charts, templates, lint, schema | **a** |
| 16–24 | argocd-* , pods, resources | Argo CD, App of Apps, ApplicationSet, running workloads | **b** |
| 25–27 | app, swagger, mailpit | working application | — |
| 28–29 | selfheal, statefulset | probes and controllers, persistent storage | HA |
| 30–35 | gitops-selfheal … rollback | GitOps: drift correction, scale, CD, rollback | **b** |
| 36–43 | prometheus-*, grafana-* | monitoring stack and dashboards | **c, e** |
| 44–56 | metrics-apis … queue-drained | custom-metric autoscaling | **d** |
| 57–62 | drain, pdb, alert, top | HA, alerting, capacity plan | HA and capacity |
