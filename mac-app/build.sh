#!/usr/bin/env bash
# Build and sign in one step: an unsigned rebuild loses the virtualization
# entitlement, and vmnet then fails with status 1002.
set -euo pipefail
cd "$(dirname "$0")"
swift build -c release
codesign --force --sign - --entitlements BeeBoxMac.entitlements .build/release/BeeBoxMac
codesign -d --entitlements - .build/release/BeeBoxMac 2>/dev/null | grep -q com.apple.security.virtualization
echo "Built and signed: $PWD/.build/release/BeeBoxMac"
