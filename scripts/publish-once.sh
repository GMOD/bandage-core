#!/usr/bin/env bash
# Publishes the package in the current directory unless npm already has its
# version, so a release run that failed partway can be re-run.
set -euo pipefail

spec=$(node -p "const p = require('./package.json'); p.name + '@' + p.version")
if [ -n "$(npm view "$spec" version 2>/dev/null)" ]; then
  echo "$spec is already on npm"
  exit 0
fi
pnpm publish --provenance --no-git-checks "$@"
