#!/bin/sh
# Runs before `npm run dev` / `npm run build`: makes sure the game's art is in public/assets.
# The art packs are licensed and kept out of git, so a fresh clone has to add them first (see README).
cd "$(dirname "$0")/.."
PACK="assets/Goals_in_Pixels"
ART="public/assets/football-roll.png"

[ -f "$ART" ] && exit 0

if [ -f "$PACK/characters/players/character.aseprite" ]; then
  echo "Exporting art from Goals in Pixels…"
  exec sh scripts/copy-assets.sh
fi

# cloud builds: the art and songs come from the private R2 bucket (npm run assets:upload)
if [ -n "$R2_ACCESS_KEY_ID" ]; then
  echo "Downloading Goals in Pixels art and the soundtrack from R2…"
  exec node scripts/fetch-assets.mjs
fi

cat >&2 <<'MSG'

  The game's art is missing.

  Tackle Tactics uses the licensed Goals in Pixels pack by Josee
  (https://n3cloud.itch.io/goals-in-pixels). The standalone pack is kept out of the repository.

  1. Get the pack from Josee's itch.io page.
  2. Unzip it into ./assets so this folder exists:
       assets/Goals_in_Pixels/characters/players
  3. Run the command again, or run `npm run assets` to export the art with Python 3.

  See "Building the game" in README.md.

MSG
exit 1
