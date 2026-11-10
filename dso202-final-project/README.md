# DSO202 Final Project: SpendWise on Kubernetes

Helm charts, GitOps with Argo CD, Prometheus + Grafana monitoring and custom-metric
autoscaling for the SpendWise microservices application (17 microservices + frontend).

| File | Use it for |
|---|---|
| **[step-by-step.md](step-by-step.md)** | Doing the project: every command in order, plus the 62 screenshots to take |
| **[concept.md](concept.md)** | Understanding and presenting it: concepts, design, results, slide plan, tutor Q&A |
| [instruction.md](instruction.md) | Reference manual: architecture, demos, HA/capacity plan, troubleshooting |

Quick start (after reading Phases 0–1 of the guide):

```bash
kind create cluster --config cluster/kind-cluster.yaml
BUILD=1 bash scripts/load-images.sh
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/kind/deploy.yaml
bash scripts/create-secrets.sh
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.6/manifests/install.yaml
kubectl apply -f argocd/project.yaml -f argocd/root-app.yaml
```

The older `../kubernetes/` folder holds the original single umbrella chart. **This folder is the
one used for the DSO202 project.**
