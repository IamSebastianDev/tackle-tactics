#!/bin/sh
# npm run assets:upload
#
# Packs what a build needs and git doesn't have (the licensed art and the radio's songs) into one
# archive and uploads it to a private R2 bucket. Cloud builds (Cloudflare Workers Builds) download it
# before building; see scripts/fetch-assets.mjs. Run it again whenever the art or the music changes.
#
#   public/assets/   the art the game uses (copied from the pack by scripts/copy-assets.sh)
#   assets/music/    the songs, as .m4a: WAV/AIFF/FLAC are converted here (cloud builds run on
#                    Linux, which lacks macOS's afconvert); MP3/M4A/OGG go in as they are
#
# Needs `npx wrangler login` once. The bucket is created on first use.
set -e
cd "$(dirname "$0")/.."

BUCKET="${R2_BUCKET:-tackle-tactics-assets}"
KEY="game-assets-goals-in-pixels.tar.gz"

sh scripts/ensure-assets.sh

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/public" "$STAGE/assets/music"
cp -R public/assets "$STAGE/public/"

for f in assets/music/*; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  base="${name%.*}"
  case "$(printf '%s' "${name##*.}" | tr '[:upper:]' '[:lower:]')" in
    wav | aif | aiff | flac)
      if command -v afconvert >/dev/null 2>&1; then
        afconvert -f m4af -d aac -b 192000 "$f" "$STAGE/assets/music/$base.m4a"
      else
        ffmpeg -loglevel error -i "$f" -c:a aac -b:a 192k "$STAGE/assets/music/$base.m4a"
      fi ;;
    mp3 | m4a | aac | ogg | oga | opus) cp "$f" "$STAGE/assets/music/" ;;
  esac
done

# COPYFILE_DISABLE: macOS tar would otherwise add AppleDouble "._*" files that unpack as junk on Linux
find "$STAGE" -name .DS_Store -delete
COPYFILE_DISABLE=1 tar -czf "$STAGE.tgz" --exclude "._*" --exclude .DS_Store -C "$STAGE" public assets
echo "archive: $(du -h "$STAGE.tgz" | cut -f1), $(find "$STAGE" -type f | wc -l | tr -d ' ') files"

if [ "$1" = "--dry-run" ]; then
  tar -tzf "$STAGE.tgz" | grep -v '/$' | sed 's|/[^/]*$||' | sort | uniq -c
  rm -f "$STAGE.tgz"
  exit 0
fi

npx wrangler r2 bucket info "$BUCKET" >/dev/null 2>&1 || npx wrangler r2 bucket create "$BUCKET"
npx wrangler r2 object put "$BUCKET/$KEY" --file "$STAGE.tgz" --content-type application/gzip --remote
rm -f "$STAGE.tgz"
echo "uploaded to r2://$BUCKET/$KEY"
