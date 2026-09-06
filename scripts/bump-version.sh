#!/usr/bin/env bash
#
# Raises the version in package.json and commits it to main. That is all.
#
# It does not tag and does not create a release: an empty release, or a tag with
# nothing attached to it, is only something for a visitor to download by mistake.
# The first build pipeline to finish creates the release and its tag together.
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

echo "package.json is now $NEXT on main."
echo "Run Build Windows, Build Linux or Build macOS; the first one to finish"
echo "creates release $TAG and puts its packages in it."

