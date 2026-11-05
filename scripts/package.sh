#!/usr/bin/env bash
# Builds dist/flagsmith-override-v<version>.zip with only the files Chrome needs.
# The archive contains a single `flagsmith-override/` folder that can be loaded unpacked.
set -euo pipefail

cd "$(dirname "$0")/.."
version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
name="flagsmith-override"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT

mkdir -p "$staging/$name" dist
cp -R manifest.json background.js content lib panel icons LICENSE "$staging/$name/"
rm -f "$staging/$name/icons/"*.svg
find "$staging" -name '.DS_Store' -delete

archive="dist/$name-v$version.zip"
rm -f "$archive"
(cd "$staging" && zip -qr - "$name") > "$archive"
echo "$archive"
