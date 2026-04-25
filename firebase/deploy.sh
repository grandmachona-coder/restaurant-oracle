#!/usr/bin/env bash
#
# deploy.sh — Firebase deploy wrapper that stamps the current git SHA into
# Sentry release tags (%GIT_SHA% placeholder) before `firebase deploy`, then
# restores the placeholders so the working tree stays clean.
#
# Usage:
#   ./deploy.sh                 # deploy hosting + functions
#   ./deploy.sh hosting         # deploy only hosting (frontend)
#   ./deploy.sh functions       # deploy only functions (backend)
#   ./deploy.sh functions:api   # deploy only a single function
#
# Safe to re-run; uses a trap to restore files even on failure.

set -euo pipefail

cd "$(dirname "$0")"

FILES=(
  public/sentry-init.js
  functions/index.js
)

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
echo "→ Stamping release SHA: $SHA"

# Back up + swap placeholder.
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    cp "$f" "$f.bak"
    # Use | as sed delimiter since SHA is alphanumeric.
    sed -i.tmp "s|%GIT_SHA%|$SHA|g" "$f"
    rm -f "$f.tmp"
  fi
done

# Always restore on exit (success or failure).
restore() {
  for f in "${FILES[@]}"; do
    if [[ -f "$f.bak" ]]; then
      mv "$f.bak" "$f"
    fi
  done
  echo "→ Restored %GIT_SHA% placeholders"
}
trap restore EXIT

# Deploy target defaults to hosting + functions.
TARGET="${1:-hosting,functions}"
echo "→ firebase deploy --only $TARGET"
firebase deploy --only "$TARGET"
