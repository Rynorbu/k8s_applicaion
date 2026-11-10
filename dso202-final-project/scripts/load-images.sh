#!/usr/bin/env bash
# Copies the 18 SpendWise images from the local Docker engine into every kind node, so
# the cluster can run them without a registry (imagePullPolicy: IfNotPresent).
#   scripts/load-images.sh            # load spendwise/<name>:dev
#   BUILD=1 scripts/load-images.sh    # build them first with docker compose
#   TAG=v2 scripts/load-images.sh     # load a different tag
set -euo pipefail
CLUSTER="${CLUSTER:-spendwise}"
TAG="${TAG:-dev}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"   # repository root (spendwise/)

IMAGES="api-gateway auth-service user-service expense-service income-service category-service
budget-service recurring-service goal-service analytics-service notification-service report-service
search-service currency-service audit-service ai-service file-service frontend"

if [ "${BUILD:-0}" = "1" ]; then
  echo "Building images with docker compose (first build takes several minutes)..."
  (cd "$ROOT" && docker compose build)
fi

for name in $IMAGES; do
  image="spendwise/${name}:${TAG}"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "missing $image - build it first (BUILD=1 $0)" >&2
    exit 1
  fi
  echo "loading $image"
  kind load docker-image "$image" --name "$CLUSTER" >/dev/null
done
echo "All images loaded into kind cluster '$CLUSTER'."
