#!/bin/bash
# Builds the macOS benchmark tool. The embedded Info.plist carries the
# speech-recognition usage string that SFSpeechRecognizer requires.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/.build/apple-speech-bench}"
mkdir -p "$(dirname "$out")"
swiftc -O -parse-as-library -target arm64-apple-macos26.0 \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$here/Info.plist" \
  "$here/AppleSpeechBench.swift" -o "$out"
echo "$out"
