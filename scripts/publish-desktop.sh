#!/bin/sh
# npm run publish:desktop [-- --mac | --windows]
#
# Builds the desktop game and collects the results in releases/<version>/:
#   macOS    universal (Apple silicon + Intel): .dmg and a zipped .app
#   Windows  x64, cross-compiled from macOS: NSIS installer and a portable .exe
# Builds are unsigned (ad-hoc signed on macOS): players right-click → Open the first time on a Mac,
# and click "More info → Run anyway" on Windows SmartScreen.
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
  *) echo "usage: npm run publish:desktop [-- --mac | --windows]" >&2; exit 2 ;;
esac

VERSION=$(node -p "require('./package.json').version")
OUT="releases/$VERSION"
NAME="Tackle-Tactics_$VERSION"

# LLVM from Homebrew is keg-only: put its tools (lld-link, llvm-rc, clang-cl) on PATH for this run
if command -v brew >/dev/null 2>&1 && [ -d "$(brew --prefix llvm 2>/dev/null)/bin" ]; then
  PATH="$(brew --prefix llvm)/bin:$PATH"
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
  command -v makensis >/dev/null 2>&1 || missing="$missing\n  brew install nsis"
  command -v lld-link >/dev/null 2>&1 || missing="$missing\n  brew install llvm"
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
  npx tauri build --target universal-apple-darwin --bundles app,dmg --config "$(frontend_flag)"
  BUILT_FRONTEND=1
  B=src-tauri/target/universal-apple-darwin/release/bundle
  cp "$B"/dmg/*.dmg "$OUT/${NAME}_macos-universal.dmg"
  ditto -c -k --keepParent "$B/macos/Tackle Tactics.app" "$OUT/${NAME}_macos-universal.app.zip"
fi

if [ $WIN = 1 ]; then
  echo "\n▶ Windows (x64, cross-compiled)"
  npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis --config "$(frontend_flag)"
  T=src-tauri/target/x86_64-pc-windows-msvc/release
  cp "$T"/bundle/nsis/*-setup.exe "$OUT/${NAME}_windows-x64-setup.exe"
  cp "$T/tackle-tactics.exe" "$OUT/${NAME}_windows-x64-portable.exe"
fi

(cd "$OUT" && shasum -a 256 -- * > SHA256SUMS.txt)
echo "\n✔ Tackle Tactics $VERSION → $OUT"
ls -lh "$OUT" | tail -n +2 | awk '{ print "   " $5 "\t" $9 }'
