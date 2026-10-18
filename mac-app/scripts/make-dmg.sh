#!/usr/bin/env bash
# Package "build/Bee Box Desktop.app" as a drag-to-Applications DMG with a
# background picture, laid-out icons, and the app icon as the volume icon
# (scripts/dmg-settings.py, built by dmgbuild without driving Finder). With a
# real SIGN_IDENTITY the DMG is signed; with NOTARY_PROFILE (an
# `xcrun notarytool store-credentials` profile) it is also notarized and
# stapled, so it opens without a Gatekeeper warning.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="build/Bee Box Desktop.app"
[[ -d "$APP" ]] || { echo "make-dmg: build the app first (scripts/build-app.sh)" >&2; exit 1; }
VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
IDENTITY="${SIGN_IDENTITY:--}"
DMG="build/BeeBoxDesktop-$VERSION.dmg"

# build-app.sh drew the art into build/art; the DMG wants the 1x and 2x
# backgrounds as one HiDPI TIFF.
tiffutil -cathidpicheck build/art/dmg-background.png build/art/dmg-background@2x.png -out build/art/dmg-background.tiff >/dev/null 2>&1 \
  || { echo "make-dmg: tiffutil could not combine the backgrounds" >&2; exit 1; }

rm -f "$DMG"
# Pinned: a build-time tool only, fetched by uv into its cache. 1.6.5 wrote a
# background that Finder on macOS 26 does not show; 1.6.7 works.
uvx --quiet --from 'dmgbuild==1.6.7' dmgbuild \
  -s scripts/dmg-settings.py \
  -D app="$APP" \
  -D background=build/art/dmg-background.tiff \
  -D icon="$APP/Contents/Resources/AppIcon.icns" \
  "Bee Box Desktop" "$DMG"

if [[ "$IDENTITY" != "-" ]]; then
  codesign --force --sign "$IDENTITY" --timestamp "$DMG"
fi
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
fi
echo "Built $PWD/$DMG ($(du -h "$DMG" | cut -f1))"
