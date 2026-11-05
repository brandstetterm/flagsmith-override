#!/usr/bin/env bash
# Packages the extension and publishes a GitHub release for the version in manifest.json.
# Bump "version" in manifest.json and commit before running.
set -euo pipefail

cd "$(dirname "$0")/.."
version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
tag="v$version"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit first." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Tag $tag already exists. Bump the version in manifest.json." >&2
  exit 1
fi

archive=$(scripts/package.sh)
git tag "$tag"
git push origin "$tag"
gh release create "$tag" "$archive" --title "Flagsmith Override $tag" --generate-notes
