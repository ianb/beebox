#!/usr/bin/env bash
# Build, sign, notarize, and publish one Mac release to GitHub.
#
# Usage: [NOTES_FILE=notes.md] scripts/release.sh X.Y.Z
#
# An app release is for the Swift shell only. The engine image moves on its
# own channel (ghcr.io/ianb/beebox:latest, published by the image workflow
# from main), and the app follows it without a release here.
#
# Expects, on the maintainer's Mac:
#   - the tag mac-vX.Y.Z pushed;
#   - a "Developer ID Application" identity in the keychain;
#   - the `beebox-notary` notarytool profile;
#   - the Sparkle private key in the keychain (generate_keys --account beebox).
#
# Publishes BeeBoxDesktop-X.Y.Z.dmg, its .sha256, and appcast.xml to the
# mac-vX.Y.Z GitHub Release, marked latest: the app's feed URL is
# releases/latest/download/appcast.xml, and GitHub's "latest" skips
# pre-releases. Engine images make no GitHub Release, so they never move the
# feed.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?usage: release.sh X.Y.Z}"
TAG="mac-v$VERSION"
REPO=ianb/beebox
CACHE="${BEEBOX_BUILD_CACHE:-$HOME/Library/Caches/beebox-mac-build}"
SPARKLE_BIN="$CACHE/sparkle-2.10.0/bin"

git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null \
  || { echo "release: tag $TAG is not on origin; push it first" >&2; exit 1; }

# The image declares the oldest app that can run it (MIN_APP_VERSION in the
# Dockerfile). Releasing an app below that would ship a shell the channel's
# next image refuses; the Dockerfile and this release must move together.
min_app="$(sed -n 's/^ARG MIN_APP_VERSION=\(.*\)$/\1/p' ../beebox/docker/Dockerfile)"
[[ -n "$min_app" ]] || { echo "release: no MIN_APP_VERSION in beebox/docker/Dockerfile" >&2; exit 1; }
if [[ "$(printf '%s\n%s\n' "$min_app" "$VERSION" | sort -V | tail -1)" != "$VERSION" ]]; then
  echo "release: app $VERSION is below the image's MIN_APP_VERSION $min_app" >&2; exit 1
fi

IDENTITY="${SIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"
[[ -n "$IDENTITY" ]] || { echo "release: no Developer ID Application identity in the keychain" >&2; exit 1; }

VERSION="$VERSION" SIGN_IDENTITY="$IDENTITY" scripts/build-app.sh
SIGN_IDENTITY="$IDENTITY" NOTARY_PROFILE="${NOTARY_PROFILE:-beebox-notary}" scripts/make-dmg.sh

DMG="build/BeeBoxDesktop-$VERSION.dmg"
(cd build && shasum -a 256 "BeeBoxDesktop-$VERSION.dmg" > "BeeBoxDesktop-$VERSION.dmg.sha256")

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
  edit=(--prerelease=false --latest)
  [[ -n "${NOTES_FILE:-}" ]] && edit+=(--notes-file "$NOTES_FILE")
  gh release edit "$TAG" -R "$REPO" "${edit[@]}"
else
  notes=(--notes "Bee Box Desktop $VERSION for macOS 26 on Apple silicon.")
  [[ -n "${NOTES_FILE:-}" ]] && notes=(--notes-file "$NOTES_FILE")
  gh release create "$TAG" -R "$REPO" --latest --title "Bee Box Desktop $VERSION" "${notes[@]}" \
    "$DMG" "$DMG.sha256" build/appcast.xml
fi
echo "Released $TAG: https://github.com/$REPO/releases/tag/$TAG"
