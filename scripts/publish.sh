#!/usr/bin/env bash
# publish.sh — Build and publish all OOJS packages.
#
# Usage:
#   ./scripts/publish.sh [--version <semver>] [--dry-run]
#
# Packages:
#   npm:      @oojs/browser   (js/)
#             @oojs/node      (js-node/)
#             @oojs/core      (ts/)       — compiled + browser bundle
#   python:   oojs            (pyproject.toml)
#   php:      oojs/oojs       (php/)      — Packagist via git tag
#
# Requirements:
#   npm, node >= 18, tsc, esbuild, python3, pip3 (twine, build), git

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=0
VERSION=""

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)  VERSION="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    *)          echo "Unknown argument: $1"; exit 1 ;;
  esac
done

run() {
  echo "  $ $*"
  if [[ $DRY_RUN -eq 0 ]]; then
    "$@"
  fi
}

banner() { echo; echo "=== $* ==="; echo; }

# ---------------------------------------------------------------------------
# Version bump (optional)
# ---------------------------------------------------------------------------
if [[ -n "$VERSION" ]]; then
  banner "Version bump → $VERSION"

  # npm packages
  for dir in js js-node ts; do
    (cd "$REPO_ROOT/$dir" && run npm version "$VERSION" --no-git-tag-version)
  done

  # Python
  run sed -i "s/^version = .*/version = \"$VERSION\"/" "$REPO_ROOT/pyproject.toml"

  # PHP
  run sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$REPO_ROOT/php/composer.json"

  echo "Version bumped to $VERSION in all packages."
fi

# ---------------------------------------------------------------------------
# @oojs/browser  (js/)
# ---------------------------------------------------------------------------
banner "@oojs/browser"
cd "$REPO_ROOT/js"
echo "No build step (vanilla ES modules — publish src/ directly)"
run npm publish --access public

# ---------------------------------------------------------------------------
# @oojs/node  (js-node/)
# ---------------------------------------------------------------------------
banner "@oojs/node"
cd "$REPO_ROOT/js-node"
echo "Running tests..."
run node --test tests/validator.test.js
echo "Publishing..."
run npm publish --access public

# ---------------------------------------------------------------------------
# @oojs/core  (ts/)
# ---------------------------------------------------------------------------
banner "@oojs/core"
cd "$REPO_ROOT/ts"
echo "Building (tsc + esbuild browser bundle)..."
run npm run build:all
echo "Running tests..."
run npm test
echo "Publishing..."
run npm publish --access public

# ---------------------------------------------------------------------------
# Python: oojs (PyPI)
# ---------------------------------------------------------------------------
banner "oojs (Python / PyPI)"
cd "$REPO_ROOT"
echo "Building sdist + wheel..."
run python3 -m build
echo "Publishing to PyPI (requires twine + PyPI token in ~/.pypirc or TWINE_* env vars)..."
run python3 -m twine upload dist/oojs-*

# ---------------------------------------------------------------------------
# PHP: oojs/oojs (Packagist via git tag)
# ---------------------------------------------------------------------------
banner "oojs/oojs (PHP / Packagist)"
if [[ -n "$VERSION" ]]; then
  echo "Creating git tag v$VERSION and pushing to trigger Packagist webhook..."
  run git tag "v$VERSION"
  run git push origin "v$VERSION"
  echo
  echo "Packagist will auto-update when it receives the tag push."
  echo "Ensure the webhook is configured at: https://packagist.org/packages/oojs/oojs"
else
  echo "No --version supplied; skipping PHP git tag."
  echo "To release PHP, run:  git tag v<version> && git push origin v<version>"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
banner "Done"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "(dry-run — no packages were actually published)"
fi
