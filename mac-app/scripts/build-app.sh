#!/usr/bin/env bash
# Build BeeBox.app: the release binary, Sparkle.framework, the bundled Linux
# kernel, and an Info.plist that pins the beebox image to the app's version.
#
# Environment:
#   VERSION          app version and beebox image tag (default 0.0.0-dev)
#   BUILD_NUMBER     CFBundleVersion (default: commit count)
#   BUNDLE_ID        default run.beebox.mac
#   BEEBOX_IMAGE     image reference (default ghcr.io/ianb/beebox:$VERSION)
#   SIGN_IDENTITY    codesign identity; "-" (ad-hoc, the default) until the
#                    Developer ID certificate exists
#   SPARKLE_PUBLIC_KEY  the update-signing key's public half (default: the
#                    project's key, made with `generate_keys --account beebox`;
#                    the private half is in the maintainer's keychain)
#   MIN_MACOS        LSMinimumSystemVersion (default 26.0)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${VERSION:-0.0.0-dev}"
BUILD_NUMBER="${BUILD_NUMBER:-$(git rev-list --count HEAD)}"
BUNDLE_ID="${BUNDLE_ID:-run.beebox.mac}"
IMAGE="${BEEBOX_IMAGE:-ghcr.io/ianb/beebox:$VERSION}"
IDENTITY="${SIGN_IDENTITY:--}"
# A development build carries no update key: Sparkle would otherwise "update"
# it to the latest release (any release is newer than 0.0.0-dev).
if [[ "$VERSION" == *-dev ]]; then
  SPARKLE_PUBLIC_KEY="${SPARKLE_PUBLIC_KEY-}"
else
  SPARKLE_PUBLIC_KEY="${SPARKLE_PUBLIC_KEY-TdU85iPE0GdWg8yepTnRXo3v5dJYhQ6CmsIb6Qt/l98=}"
fi
MIN_MACOS="${MIN_MACOS:-26.0}"
FEED_URL="https://github.com/ianb/beebox/releases/latest/download/appcast.xml"

scripts/fetch-sparkle.sh
swift build -c release --arch arm64
BIN_DIR="$(swift build -c release --arch arm64 --show-bin-path)"

APP=build/BeeBox.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Frameworks" "$APP/Contents/Resources"
cp "$BIN_DIR/BeeBoxMac" "$APP/Contents/MacOS/BeeBoxMac"
ditto "$BIN_DIR/Sparkle.framework" "$APP/Contents/Frameworks/Sparkle.framework"
scripts/fetch-kernel.sh "$APP/Contents/Resources/vmlinux"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
	<key>CFBundleName</key><string>Bee Box</string>
	<key>CFBundleDisplayName</key><string>Bee Box</string>
	<key>CFBundleExecutable</key><string>BeeBoxMac</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>${VERSION}</string>
	<key>CFBundleVersion</key><string>${BUILD_NUMBER}</string>
	<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
	<key>LSMinimumSystemVersion</key><string>${MIN_MACOS}</string>
	<key>LSArchitecturePriority</key><array><string>arm64</string></array>
	<key>LSUIElement</key><true/>
	<key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
	<key>BeeBoxImage</key><string>${IMAGE}</string>
	<key>SUFeedURL</key><string>${FEED_URL}</string>
	<key>SUPublicEDKey</key><string>${SPARKLE_PUBLIC_KEY}</string>
	<key>SUEnableAutomaticChecks</key><true/>
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null

# Sign inside out: Sparkle's helpers, the framework, then the app with its
# one entitlement. A real identity also gets the hardened runtime and a secure
# timestamp, which notarization requires. Ad hoc builds skip the hardened
# runtime: its library validation needs a shared Team ID, which ad hoc
# signatures lack, so the app could not load Sparkle.
timestamp=()
[[ "$IDENTITY" != "-" ]] && timestamp=(--options runtime --timestamp)
sign() {
  local out
  out="$(codesign --force --sign "$IDENTITY" "${timestamp[@]}" "$@" 2>&1)" || { echo "$out" >&2; exit 1; }
}
FW="$APP/Contents/Frameworks/Sparkle.framework/Versions/B"
sign "$FW/XPCServices/Installer.xpc"
sign --preserve-metadata=entitlements "$FW/XPCServices/Downloader.xpc"
sign "$FW/Autoupdate"
sign "$FW/Updater.app"
sign "$APP/Contents/Frameworks/Sparkle.framework"
sign --entitlements BeeBoxMac.entitlements "$APP"
codesign --verify --strict --deep "$APP"
echo "Built $PWD/$APP ($VERSION, image $IMAGE, signed by ${IDENTITY/#-/ad hoc})"
