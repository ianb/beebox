#!/usr/bin/env bash
# Fetch Sparkle.xcframework into Vendor/ (gitignored) for the package's local
# binary target. SwiftPM's own binary-artifact download hung indefinitely on
# the build Mac (0% CPU, no traffic) while curl fetched the same URL in under
# a second, so the archive is fetched here, pinned by SHA-256.
set -euo pipefail
cd "$(dirname "$0")/.."

SPARKLE_VERSION=2.10.0
SHA256=17e28312b8e18ab7cdbbe09a6fb28cc55a5479ec6c371dbc07cdecd2a14fd959
URL="https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-for-Swift-Package-Manager.zip"
CACHE="${BEEBOX_BUILD_CACHE:-$HOME/Library/Caches/beebox-mac-build}"
STAMP="Vendor/.sparkle-${SPARKLE_VERSION}"

[[ -f "$STAMP" && -d Vendor/Sparkle.xcframework ]] && exit 0

mkdir -p "$CACHE" Vendor
zip="$CACHE/Sparkle-${SPARKLE_VERSION}-spm.zip"
[[ -f "$zip" ]] || curl -fsSL -o "$zip" "$URL"
[[ "$(shasum -a 256 "$zip" | cut -d' ' -f1)" == "$SHA256" ]] || { echo "fetch-sparkle: SHA-256 mismatch for $zip" >&2; exit 1; }
rm -rf Vendor/Sparkle.xcframework Vendor/.sparkle-*
unzip -q "$zip" 'Sparkle.xcframework/*' -d Vendor
touch "$STAMP"
