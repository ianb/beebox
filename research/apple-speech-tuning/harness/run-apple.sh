#!/bin/bash
# Runs every Apple configuration over one manifest, one results file each.
# Usage: run-apple.sh <manifest.jsonl> <out-dir> [config[:vocab-key] …]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bench="$here/.build/apple-speech-bench"
manifest="$1"
out="$2"
shift 2
mkdir -p "$out"
configs=("$@")
if [ ${#configs[@]} -eq 0 ]; then
  configs=(
    st.transcription
    st.transcription:segment st.transcription:call st.transcription:box
    st.alternatives st.progressive st.etiquette
    dt.long dt.long:call dt.long.lm:call dt.long.lm:box dt.long.farfield
    sf.ondevice sf.ondevice:call sf.ondevice.lm:call
  )
fi
for spec in "${configs[@]}"; do
  config="${spec%%:*}"
  key=""
  [ "$spec" != "$config" ] && key="${spec#*:}"
  name="$config${key:++$key}"
  [ -s "$out/$name.jsonl" ] && { echo "skip $name"; continue; }
  echo "== $name"
  "$bench" --config "$config" ${key:+--vocab-key "$key"} --manifest "$manifest" --out "$out/$name.jsonl.tmp" 2>"$out/$name.log"
  mv "$out/$name.jsonl.tmp" "$out/$name.jsonl"
done
