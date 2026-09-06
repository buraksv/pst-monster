#!/usr/bin/env bash
#
# Adds the packages one build produced to the GitHub Release for the version in
# package.json.
#
# Each operating system has its own pipeline and runs this on its own, so a
# release fills up one system at a time. The release is a draft while it is
# incomplete, which keeps a half-empty release off the Releases page; whichever
# pipeline finishes the set publishes it.
#
# Re-running a build replaces that system's files rather than adding duplicates.
#
# Usage: scripts/attach-release-assets.sh <directory holding the packages>
# Expects: gh on the PATH, GH_TOKEN and GITHUB_REPOSITORY in the environment.
set -euo pipefail

DIST="${1:?usage: attach-release-assets.sh <directory>}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DIST="$(cd "$DIST" && pwd)"
shopt -s nullglob
BUILT=("$DIST"/*)
shopt -u nullglob
if [ ${#BUILT[@]} -eq 0 ]; then
  echo "no packages found in $DIST" >&2
  exit 1
fi
echo "attaching ${#BUILT[@]} file(s) to $TAG"

# ---------------------------------------------------------------------------
# The release itself. The version pipelines normally create it; this covers the
# case of building a version that has none yet, such as the very first one.
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "release $TAG already exists"
else
  echo "creating draft release $TAG"
  gh release create "$TAG" \
    --repo "$REPO" \
    --draft \
    --target "${GITHUB_SHA:-HEAD}" \
    --title "PST Monster $TAG" \
    --notes "Paketler üretiliyor · Packages are being built."
fi

# ---------------------------------------------------------------------------
# Checksums. The file covers the whole release, so the lines already there for
# other operating systems are kept and only this build's are rewritten.
if gh release view "$TAG" --repo "$REPO" --json assets --jq '.assets[].name' |
  grep -qx 'SHA256SUMS.txt'; then
  gh release download "$TAG" --repo "$REPO" --pattern 'SHA256SUMS.txt' --dir "$WORK" --clobber
fi
node scripts/checksums.mjs "$DIST" "$WORK/SHA256SUMS.txt"

# ---------------------------------------------------------------------------
# Upload. --clobber so a rebuilt package replaces the old one in place.
gh release upload "$TAG" "$DIST"/* --repo "$REPO" --clobber

# ---------------------------------------------------------------------------
# Rewrite the download table from everything the release now holds, so it always
# matches the assets and says which systems are still missing.
gh release view "$TAG" --repo "$REPO" --json assets --jq '.assets[].name' \
  | node scripts/release-notes.mjs notes "$VERSION" > "$WORK/notes.md"
gh release edit "$TAG" --repo "$REPO" --notes-file "$WORK/notes.md"

# ---------------------------------------------------------------------------
# Publish once every operating system is in.
if gh release view "$TAG" --repo "$REPO" --json assets --jq '.assets[].name' \
  | node scripts/release-notes.mjs complete; then
  echo "all three operating systems present; publishing $TAG"
  gh release edit "$TAG" --repo "$REPO" --draft=false --latest
else
  echo "$TAG stays a draft until the other systems are built"
fi

echo "done: $(gh release view "$TAG" --repo "$REPO" --json url --jq .url)"
