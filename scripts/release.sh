#!/bin/sh
# npm run release [-- patch | minor | major | 1.2.3]     (default: patch)
#
# Cuts a release: uploads the current art and songs to R2 (the cloud builds use them), bumps the
# version (package.json → Cargo.toml, a commit and a v-tag, via `npm version`), then pushes the
# commit and the tag together. The tag starts .github/workflows/release.yml, which builds every
# platform and publishes a GitHub Release.
set -e
cd "$(dirname "$0")/.."

BUMP="${1:-patch}"

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "release: switch to main first" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "release: commit or stash your changes first" >&2; exit 1; }
git fetch --quiet origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "release: main isn't in sync with origin/main (pull or push first)" >&2; exit 1; }

npm run assets:upload
npm version "$BUMP" -m "Release %s"
TAG="v$(node -p "require('./package.json').version")"
git push --atomic origin main "$TAG"
echo "\n✔ $TAG pushed: the Release workflow builds it → https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo '<repo>')/actions"
