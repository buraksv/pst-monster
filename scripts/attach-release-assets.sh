#!/usr/bin/env bash
#
# Adds the packages one build produced to the GitHub Release for the version in
# package.json.
#
# Each operating system has its own pipeline and runs this on its own, so a
# release fills up one system at a time. It is published straight away, with
# whatever is in it: a finished Windows build has to be downloadable even if
# macOS has not been built, or failed. The notes say which systems are still
# missing, so nobody is misled about what is there.
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
# The release itself. The first build of a version creates it; creating it here
# is also what creates the git tag, so no tag is ever left without a release.
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "release $TAG already exists"
else
  echo "creating release $TAG"
  gh release create "$TAG" \
    --repo "$REPO" \
    --target "${GITHUB_SHA:-HEAD}" \
    --title "PST Monster $TAG" \
    --notes "Paketler yükleniyor · Packages are being uploaded."
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
# Make sure it is visible. A release left as a draft by an earlier run, or by an
# older version of this script, is published here: packages that exist are of no
# use to anyone while they are hidden.
gh release edit "$TAG" --repo "$REPO" --draft=false

# Say what is still to come, without holding anything back.
if gh release view "$TAG" --repo "$REPO" --json assets --jq '.assets[].name' \
  | node scripts/release-notes.mjs complete; then
  echo "$TAG now has packages for all three operating systems"
else
  echo "$TAG is published with what has been built so far"
fi

echo "done: $(gh release view "$TAG" --repo "$REPO" --json url --jq .url)"
