#!/usr/bin/env bash
# GitOps continuous deployment of ONE service, end to end:
#   1. build a new image   2. load it into kind   3. change the tag in Git
#   4. commit + push        5. Argo CD notices the commit and rolls the Deployment
#
#   scripts/release.sh expense-service v1.0.1
#
# Nothing here talks to the cluster API to deploy: the only "deploy" step is git push.
set -euo pipefail
SERVICE="${1:?usage: release.sh <service> <tag>}"
TAG="${2:?usage: release.sh <service> <tag>}"
CLUSTER="${CLUSTER:-spendwise}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"        # dso202-final-project/
ROOT="$(cd "$HERE/.." && pwd)"                   # repository root
VALUES="$HERE/values/services/${SERVICE}.yaml"
[ -f "$VALUES" ] || { echo "no values file $VALUES" >&2; exit 1; }

if [ "$SERVICE" = "frontend" ]; then DOCKERFILE="frontend/Dockerfile"; else DOCKERFILE="services/${SERVICE}/Dockerfile"; fi

echo "1/4 building spendwise/${SERVICE}:${TAG}"
docker build -q -f "$ROOT/$DOCKERFILE" -t "spendwise/${SERVICE}:${TAG}" "$ROOT"

echo "2/4 loading image into kind cluster '$CLUSTER'"
kind load docker-image "spendwise/${SERVICE}:${TAG}" --name "$CLUSTER" >/dev/null

echo "3/4 pinning tag ${TAG} in ${VALUES#$ROOT/}"
sed -i.bak -E "s/^(  tag: ).*/\1${TAG}/" "$VALUES" && rm -f "$VALUES.bak"
git -C "$ROOT" --no-pager diff -- "$VALUES"

echo "4/4 committing and pushing"
git -C "$ROOT" add "$VALUES"
git -C "$ROOT" commit -m "deploy(${SERVICE}): ${TAG}"
git -C "$ROOT" push

echo
echo "Pushed. Argo CD polls every 3 minutes - click REFRESH on '${SERVICE}' in the UI, or run:"
echo "  kubectl -n argocd annotate application ${SERVICE} argocd.argoproj.io/refresh=normal --overwrite"
echo "  kubectl -n spendwise rollout status deploy/${SERVICE}"
