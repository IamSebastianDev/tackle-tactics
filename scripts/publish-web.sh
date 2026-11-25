#!/bin/sh
# npm run web:build
#
# Builds the browser version and zips it for an HTML5 host such as itch.io:
#   releases/<version>/Tackle-Tactics_<version>_web.zip  (index.html at the top level)
# The build uses relative paths, so the zip runs from any folder. itch.io limits: 1,000 files and
# 500 MB unpacked; the sprite strips are packed into one file to stay far below the first.
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
OUT="releases/$VERSION"
ZIP="$OUT/Tackle-Tactics_${VERSION}_web.zip"

TT_WEB=1 npm run build
FILES=$(find dist -type f | wc -l | tr -d ' ')
if [ "$FILES" -gt 1000 ]; then
  echo "dist has $FILES files; HTML5 hosts such as itch.io accept at most 1000" >&2
  exit 1
fi

mkdir -p "$OUT"
rm -f "$ZIP"
(cd dist && zip -qr -X "../$ZIP" .)
echo "web build: $ZIP ($(du -h "$ZIP" | cut -f1), $FILES files)"
