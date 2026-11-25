#!/bin/sh
# Runs before `npm run dev` / `npm run build`: makes sure the game's art is in public/assets.
# The art packs are licensed and kept out of git, so a fresh clone has to add them first (see README).
cd "$(dirname "$0")/.."
PACK="assets/Soccer_Match_-_Top_Down_Football_Tileset_&_Players_[32x32]"

[ -d public/assets/cast ] && exit 0

if [ -d "$PACK/64" ]; then
  echo "public/assets is missing: copying the art from the Soccer Match pack…"
  exec ./scripts/copy-assets.sh
fi

# cloud builds: the art and songs come from the private R2 bucket (npm run assets:upload)
if [ -n "$R2_ACCESS_KEY_ID" ]; then
  echo "public/assets is missing: downloading the art and music from R2…"
  exec node scripts/fetch-assets.mjs
fi

cat >&2 <<'MSG'

  The game's art is missing.

  Tackle Tactics uses the licensed "Soccer Match - Top Down Football Tileset & Players [32x32]"
  pack by bubbabba (https://bubbabba.itch.io). It is not in the repository, because the license
  doesn't allow sharing the files on their own.

  1. Get the pack from bubbabba's itch.io page.
  2. Unzip it into ./assets so this folder exists:
       assets/Soccer_Match_-_Top_Down_Football_Tileset_&_Players_[32x32]/64
  3. Run the command again (or `npm run assets` to copy the art by hand).

  See "Building the game" in README.md.

MSG
exit 1
