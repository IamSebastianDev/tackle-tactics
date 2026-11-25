#!/bin/sh
# npm run desktop:build [-- --mac | --windows]
#
# Builds the desktop game and collects the results in releases/<version>/:
#   macOS    universal (Apple silicon + Intel): .dmg and a zipped .app
#   Windows  x64, cross-compiled from macOS: a portable .exe, plus an NSIS installer when makensis works
#            (Homebrew's makensis 3.13 crashes on recent macOS; the portable exe is the full game either way)
# Builds are unsigned (ad-hoc signed on macOS): on a Mac players allow the first launch under System
# Settings → Privacy & Security → Open Anyway; on Windows SmartScreen it's "More info → Run anyway".
#
# The Windows build uses Tauri's cross-compilation (cargo-xwin + NSIS + LLVM). One-time setup is
# printed below if anything is missing.
set -e
cd "$(dirname "$0")/.."

MAC=1
WIN=1
case "$1" in
  --mac) WIN=0 ;;
  --windows) MAC=0 ;;
  "") ;;
  *) echo "usage: npm run desktop:build [-- --mac | --windows]" >&2; exit 2 ;;
esac

VERSION=$(node -p "require('./package.json').version")
OUT="releases/$VERSION"
NAME="Tackle-Tactics_$VERSION"

# Homebrew's llvm and lld are keg-only: put their tools (clang-cl, llvm-rc, lld-link) on PATH for this run
if command -v brew >/dev/null 2>&1; then
  for f in llvm lld; do
    d="$(brew --prefix "$f" 2>/dev/null)/bin"
    [ -d "$d" ] && PATH="$d:$PATH"
  done
  export PATH
fi

missing=""
has_target() { rustup target list --installed | grep -qx "$1"; }
if [ $MAC = 1 ]; then
  has_target aarch64-apple-darwin || missing="$missing\n  rustup target add aarch64-apple-darwin"
  has_target x86_64-apple-darwin || missing="$missing\n  rustup target add x86_64-apple-darwin"
fi
if [ $WIN = 1 ]; then
  has_target x86_64-pc-windows-msvc || missing="$missing\n  rustup target add x86_64-pc-windows-msvc"
  command -v cargo-xwin >/dev/null 2>&1 || missing="$missing\n  cargo install --locked cargo-xwin"
  command -v clang-cl >/dev/null 2>&1 || missing="$missing\n  brew install llvm"
  command -v lld-link >/dev/null 2>&1 || missing="$missing\n  brew install lld"
fi
if [ -n "$missing" ]; then
  printf "\n  Missing build tools. One-time setup:\n%b\n\n" "$missing" >&2
  [ $WIN = 1 ] && printf "  (The first Windows build downloads Microsoft's CRT and Windows SDK via cargo-xwin,\n   which means accepting Microsoft's license for them.)\n\n" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"
BUILT_FRONTEND=0
frontend_flag() {
  # the frontend only needs building once per run
  if [ $BUILT_FRONTEND = 1 ]; then echo '{"build":{"beforeBuildCommand":""}}'; else echo '{}'; fi
}

if [ $MAC = 1 ]; then
  echo "\n▶ macOS (universal)"
  npx tauri build --target universal-apple-darwin --bundles app --config "$(frontend_flag)"
  BUILT_FRONTEND=1
  APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/Tackle Tactics.app"
  # a plain drag-to-Applications disk image, made with hdiutil: Tauri's own DMG step scripts the
  # Finder window over AppleScript, which needs Automation permission most terminals don't have
  STAGE=$(mktemp -d)
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  hdiutil create -quiet -volname "Tackle Tactics $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$OUT/${NAME}_macos-universal.dmg"
  rm -rf "$STAGE"
  ditto -c -k --keepParent "$APP" "$OUT/${NAME}_macos-universal.app.zip"
fi

if [ $WIN = 1 ]; then
  echo "\n▶ Windows (x64, cross-compiled)"
  T=src-tauri/target/x86_64-pc-windows-msvc/release
  rm -f "$T"/bundle/nsis/*-setup.exe
  if command -v makensis >/dev/null 2>&1 &&
    npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis --config "$(frontend_flag)"; then
    cp "$T"/bundle/nsis/*-setup.exe "$OUT/${NAME}_windows-x64-setup.exe"
  else
    # the installer step failed or NSIS isn't installed: build just the executable
    echo "\n⚠ No Windows installer this time (makensis missing or crashed); shipping the portable exe."
    npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle --config "$(frontend_flag)"
  fi
  cp "$T/tackle-tactics.exe" "$OUT/${NAME}_windows-x64-portable.exe"
fi

(cd "$OUT" && shasum -a 256 -- * > SHA256SUMS.txt)
echo "\n✔ Tackle Tactics $VERSION → $OUT"
ls -lh "$OUT" | tail -n +2 | awk '{ print "   " $5 "\t" $9 }'
