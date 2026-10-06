#!/usr/bin/env bash
# Package build/BeeBox.app as a drag-to-Applications DMG. With a real
# SIGN_IDENTITY the DMG is signed; with NOTARY_PROFILE (an
# `xcrun notarytool store-credentials` profile) it is also notarized and
# stapled, so it opens without a Gatekeeper warning.
set -euo pipefail
cd "$(dirname "$0")/.."

APP=build/BeeBox.app
[[ -d "$APP" ]] || { echo "make-dmg: build the app first (scripts/build-app.sh)" >&2; exit 1; }
VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
IDENTITY="${SIGN_IDENTITY:--}"
DMG="build/BeeBox-$VERSION.dmg"

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
ditto "$APP" "$staging/BeeBox.app"
ln -s /Applications "$staging/Applications"
rm -f "$DMG"
hdiutil create -quiet -volname "Bee Box" -srcfolder "$staging" -fs APFS -format UDZO "$DMG"

if [[ "$IDENTITY" != "-" ]]; then
  codesign --force --sign "$IDENTITY" --timestamp "$DMG"
fi
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
fi
echo "Built $PWD/$DMG ($(du -h "$DMG" | cut -f1))"
