#!/usr/bin/env bash
# Creates the two Kubernetes Secrets the project needs. Secrets are NEVER committed to
# Git (GitOps rule) - they are created once per cluster with this script.
#   spendwise/spendwise-secrets  - DB, RabbitMQ, Redis passwords, internal token, JWT key
#   monitoring/grafana-admin     - Grafana admin login
# Safe to re-run: existing secrets are left unchanged (delete them first to rotate).
set -euo pipefail

rand() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('base64url'))"; }

kubectl get namespace spendwise >/dev/null 2>&1 || kubectl create namespace spendwise
kubectl get namespace monitoring >/dev/null 2>&1 || kubectl create namespace monitoring

if kubectl -n spendwise get secret spendwise-secrets >/dev/null 2>&1; then
  echo "spendwise/spendwise-secrets already exists - keeping it"
else
  # RSA-2048 key (PKCS#8 PEM, base64) used by auth-service to sign RS256 access tokens.
  JWT_KEY=$(node -e "const {generateKeyPairSync}=require('crypto');const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});process.stdout.write(Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64'))")
  kubectl -n spendwise create secret generic spendwise-secrets \
    --from-literal=internal-api-token="$(rand 32)" \
    --from-literal=jwt-private-key="$JWT_KEY" \
    --from-literal=service-db-password="$(rand 24)" \
    --from-literal=postgres-password="$(rand 24)" \
    --from-literal=rabbitmq-user=spendwise \
    --from-literal=rabbitmq-password="$(rand 24)" \
    --from-literal=redis-password="$(rand 24)" \
    --from-literal=anthropic-api-key="${ANTHROPIC_API_KEY:-}" \
    --from-literal=smtp-password=""
  echo "created spendwise/spendwise-secrets"
fi

if kubectl -n monitoring get secret grafana-admin >/dev/null 2>&1; then
  echo "monitoring/grafana-admin already exists - keeping it"
else
  GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-$(rand 12)}"
  kubectl -n monitoring create secret generic grafana-admin \
    --from-literal=admin-user=admin \
    --from-literal=admin-password="$GRAFANA_PASSWORD"
  echo "created monitoring/grafana-admin"
fi

echo
echo "Grafana login:  admin / $(kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d)"
