#!/usr/bin/env bash
# Fetch the Linux kernel the app bundles: the one Apple's `container` 1.5.0
# recommends, from Kata Containers' release. The release tarball is ~700 MB
# for a 30 MB kernel, so it is downloaded once into a cache outside the repo
# and the kernel is checked against a pinned SHA-256.
#
# Usage: scripts/fetch-kernel.sh <output-path>
set -euo pipefail

KATA_VERSION=3.32.0
MEMBER=opt/kata/share/kata-containers/vmlinux-6.18.35-197-debug
SHA256=fb2cfb79eb1ae19447a85d75682d7fa5cfec97e24beb2609a492b806e8072c8d
URL="https://github.com/kata-containers/kata-containers/releases/download/${KATA_VERSION}/kata-static-${KATA_VERSION}-arm64.tar.zst"
CACHE="${BEEBOX_BUILD_CACHE:-$HOME/Library/Caches/beebox-mac-build}"

out="${1:?usage: fetch-kernel.sh <output-path>}"
kernel="$CACHE/$(basename "$MEMBER")"

verify() { [[ -f "$1" ]] && [[ "$(shasum -a 256 "$1" | cut -d' ' -f1)" == "$SHA256" ]]; }

if ! verify "$kernel"; then
  mkdir -p "$CACHE"
  tarball="$CACHE/kata-static-${KATA_VERSION}-arm64.tar.zst"
  if [[ ! -f "$tarball" ]]; then
    echo "fetch-kernel: downloading Kata ${KATA_VERSION} (~700 MB, once)..." >&2
    curl -fsSL -o "$tarball.part" "$URL"
    mv "$tarball.part" "$tarball"
  fi
  # Release tarballs list members as ./opt/...; strip down to the file name.
  zstd -dc "$tarball" | tar -xf - -C "$CACHE" --strip-components 5 "./$MEMBER"
  verify "$kernel" || { echo "fetch-kernel: SHA-256 mismatch for $kernel" >&2; exit 1; }
  # The kernel is what we keep; the tarball can go once it is extracted.
  rm -f "$tarball"
fi

mkdir -p "$(dirname "$out")"
cp "$kernel" "$out"
