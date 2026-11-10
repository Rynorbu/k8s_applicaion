#!/usr/bin/env bash
# Replaces the placeholder Git URL in every Argo CD manifest with your repository.
#   scripts/set-repo-url.sh https://github.com/<user>/spendwise.git
set -euo pipefail
URL="${1:?usage: set-repo-url.sh https://github.com/<user>/spendwise.git}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
grep -rl 'https://github.com/YOUR-GITHUB-USERNAME/spendwise.git' "$HERE/argocd" | while read -r f; do
  sed -i.bak "s#https://github.com/YOUR-GITHUB-USERNAME/spendwise.git#${URL}#g" "$f" && rm -f "$f.bak"
  echo "updated ${f#$HERE/}"
done
