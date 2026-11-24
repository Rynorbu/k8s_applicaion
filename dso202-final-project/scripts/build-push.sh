#!/usr/bin/env bash
# Build SpendWise images for BOTH x86 laptops (amd64) and Raspberry Pis (arm64)
# and push them to Docker Hub as one multi-arch tag.
#
#   bash scripts/build-push.sh all                  # all 18 images
#   bash scripts/build-push.sh auth-service         # one image
#   TAG=v1.0.1 bash scripts/build-push.sh all       # different tag
#
# Always uses the repository root as the build context, so it works from any folder.
set -euo pipefail
USER_NS="${DOCKERHUB_USER:-khemraj9815}"
TAG="${TAG:-v1.0.0}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"     # repository root

ALL="frontend api-gateway auth-service user-service expense-service income-service category-service
budget-service recurring-service goal-service analytics-service notification-service report-service
search-service currency-service audit-service ai-service file-service"

[ $# -ge 1 ] || { echo "usage: $0 all | <service> [<service>...]" >&2; exit 1; }
if [ "$1" = "all" ]; then set -- $ALL; fi

# One-time: a buildx builder that can produce several architectures (uses QEMU for arm64).
docker buildx inspect multiarch >/dev/null 2>&1 || docker buildx create --name multiarch --driver docker-container >/dev/null
docker buildx use multiarch

for svc in "$@"; do
  if [ "$svc" = "frontend" ]; then df="frontend/Dockerfile"; else df="services/$svc/Dockerfile"; fi
  [ -f "$ROOT/$df" ] || { echo "no Dockerfile for '$svc' ($df)" >&2; exit 1; }
  echo "=== $USER_NS/$svc:$TAG  [$PLATFORMS]"
  docker buildx build --platform "$PLATFORMS" -f "$ROOT/$df" -t "$USER_NS/$svc:$TAG" --push "$ROOT"
done
echo "Done. Check: docker buildx imagetools inspect $USER_NS/<service>:$TAG"
