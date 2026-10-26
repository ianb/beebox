#!/usr/bin/env bash
# Install a verified restic binary. Used by the server provisioner, Docker
# image and the documented launchd setup for a local box.
set -euo pipefail

VERSION=0.19.1
DESTINATION="${1:-/usr/local/bin/restic}"
LICENSE_SOURCE="$(dirname "$0")/restic-LICENSE"
LICENSE_DIR="$(dirname "$(dirname "$DESTINATION")")/share/doc/restic"
mkdir -p "$LICENSE_DIR"
install -m 0644 "$LICENSE_SOURCE" "$LICENSE_DIR/LICENSE"
if [[ -x "$DESTINATION" ]] && "$DESTINATION" version | grep -F "restic $VERSION " >/dev/null; then
  exit 0
fi
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)
    ASSET="restic_${VERSION}_linux_amd64.bz2"
    SHA256=f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c
    ;;
  Linux/aarch64|Linux/arm64)
    ASSET="restic_${VERSION}_linux_arm64.bz2"
    SHA256=a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465
    ;;
  Darwin/arm64)
    ASSET="restic_${VERSION}_darwin_arm64.bz2"
    SHA256=7be0a144ccc377880f294204aa271d76e4b79554b42a751151d425ce6ebac143
    ;;
  Darwin/x86_64)
    ASSET="restic_${VERSION}_darwin_amd64.bz2"
    SHA256=c38d579622cf602f665234c5a8c315030b6cf70656028fe6dc29a786b60e5f35
    ;;
  *)
    echo "unsupported restic platform: $(uname -s)/$(uname -m)" >&2
    exit 1
    ;;
esac

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
archive="$tmpdir/$ASSET"
curl -fsSL "https://github.com/restic/restic/releases/download/v$VERSION/$ASSET" -o "$archive"
if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$SHA256" "$archive" | sha256sum -c -
else
  printf '%s  %s\n' "$SHA256" "$archive" | shasum -a 256 -c -
fi
mkdir -p "$(dirname "$DESTINATION")"
bzip2 -dc "$archive" > "$tmpdir/restic"
install -m 0755 "$tmpdir/restic" "$DESTINATION"
"$DESTINATION" version | grep -F "restic $VERSION " >/dev/null
