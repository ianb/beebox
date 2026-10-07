#!/usr/bin/env bash
# Build, sign, notarize, and publish one Mac release to GitHub.
#
# Usage: [NOTES_FILE=notes.md] scripts/release.sh X.Y.Z
#
# Expects, on the maintainer's Mac:
#   - the tag vX.Y.Z pushed, and the image workflow finished
#     (ghcr.io/ianb/beebox:X.Y.Z must be pullable: the app pins it);
#   - a "Developer ID Application" identity in the keychain;
#   - the `beebox-notary` notarytool profile;
#   - the Sparkle private key in the keychain (generate_keys --account beebox).
#
# Publishes BeeBox-X.Y.Z.dmg, its .sha256, and appcast.xml to the vX.Y.Z
# GitHub Release, marked latest: the app's feed URL is
# releases/latest/download/appcast.xml, and GitHub's "latest" skips
# pre-releases.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?usage: release.sh X.Y.Z}"
TAG="v$VERSION"
REPO=ianb/beebox
CACHE="${BEEBOX_BUILD_CACHE:-$HOME/Library/Caches/beebox-mac-build}"
SPARKLE_BIN="$CACHE/sparkle-2.10.0/bin"

git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null \
  || { echo "release: tag $TAG is not on origin; push it first" >&2; exit 1; }

token="$(curl -fsS "https://ghcr.io/token?scope=repository:$REPO:pull" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')"
curl -fsS -o /dev/null -H "Authorization: Bearer $token" \
  -H 'Accept: application/vnd.oci.image.index.v1+json' \
  "https://ghcr.io/v2/$REPO/manifests/$VERSION" \
  || { echo "release: ghcr.io/$REPO:$VERSION is not published (or not public); wait for the image workflow" >&2; exit 1; }

IDENTITY="${SIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"
[[ -n "$IDENTITY" ]] || { echo "release: no Developer ID Application identity in the keychain" >&2; exit 1; }

VERSION="$VERSION" SIGN_IDENTITY="$IDENTITY" scripts/build-app.sh
SIGN_IDENTITY="$IDENTITY" NOTARY_PROFILE="${NOTARY_PROFILE:-beebox-notary}" scripts/make-dmg.sh

DMG="build/BeeBox-$VERSION.dmg"
(cd build && shasum -a 256 "BeeBox-$VERSION.dmg" > "BeeBox-$VERSION.dmg.sha256")

# The appcast lists this release only; Sparkle offers it to every older
# install. generate_appcast signs the enclosure with the keychain key.
feed="$(mktemp -d)"
trap 'rm -rf "$feed"' EXIT
cp "$DMG" "$feed/"
"$SPARKLE_BIN/generate_appcast" --account beebox \
  --download-url-prefix "https://github.com/$REPO/releases/download/$TAG/" \
  -o build/appcast.xml "$feed"

if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" -R "$REPO" --clobber "$DMG" "$DMG.sha256" build/appcast.xml
  gh release edit "$TAG" -R "$REPO" --prerelease=false --latest
else
  notes=(--notes "Bee Box $VERSION for macOS 26 on Apple silicon.")
  [[ -n "${NOTES_FILE:-}" ]] && notes=(--notes-file "$NOTES_FILE")
  gh release create "$TAG" -R "$REPO" --latest --title "Bee Box $VERSION" "${notes[@]}" \
    "$DMG" "$DMG.sha256" build/appcast.xml
fi
echo "Released $TAG: https://github.com/$REPO/releases/tag/$TAG"
