#!/usr/bin/env bash
#
# Raises the version in package.json, commits it to main, tags it, and opens an
# empty draft release for it.
#
# Nothing is built here. The three build pipelines are run afterwards, by hand,
# and each attaches its own packages to the release this created. The release
# stays a draft until all three operating systems are in.
#
# Usage: scripts/bump-version.sh <minor|major>
# Expects: gh on the PATH, GH_TOKEN and GITHUB_REPOSITORY in the environment.
set -euo pipefail

KIND="${1:?usage: bump-version.sh <minor|major>}"
case "$KIND" in
  minor | major) ;;
  *) echo "the version part must be minor or major, not $KIND" >&2; exit 1 ;;
esac

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
CURRENT="$(node -p "require('./package.json').version")"
NEXT="$(node scripts/next-version.mjs "$KIND")"
TAG="v$NEXT"
echo "$KIND: $CURRENT -> $NEXT"

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "a release for $TAG already exists; nothing to do" >&2
  exit 1
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

npm version "$NEXT" --no-git-tag-version
git commit -am "chore: v$NEXT"
git push origin HEAD:main

git tag -a "$TAG" -m "PST Monster $TAG"
git push origin "$TAG"

# A draft, so the version is not on the Releases page until it has packages.
gh release create "$TAG" \
  --repo "$REPO" \
  --draft \
  --target "$(git rev-parse HEAD)" \
  --title "PST Monster $TAG" \
  --notes "Paketler henüz üretilmedi. Build pipeline'larını çalıştırın.

_No packages yet. Run the build pipelines._"

echo "$TAG is ready. Run Build Linux, Build Windows and Build macOS to fill it."
