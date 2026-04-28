#!/usr/bin/env bash
# Rewrites legacy `file="..."` attributes to `ref="..."` in box cards.
# Targets only the four element types that were renamed in the schemas:
#   <attachment>, <message-ref>, <content> (doc), <sheet-tab>
#
# Usage: migrate-file-to-ref.sh <box-root>
#
# Safe to re-run: substitutions are no-ops once applied. Does not commit;
# review and commit yourself.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <box-root>" >&2
  exit 64
fi

BOX="$1"
if [ ! -d "$BOX" ]; then
  echo "Not a directory: $BOX" >&2
  exit 1
fi

# BSD sed needs an arg after -i; GNU sed does not.
if sed --version >/dev/null 2>&1; then
  inplace() { sed -i "$@"; }
else
  inplace() { sed -i '' "$@"; }
fi

rewrite() {
  local pattern="$1" glob="$2"
  find "$BOX" -type f -name "$glob" -print0 \
    | while IFS= read -r -d '' f; do inplace "$pattern" "$f"; done
}

echo "Migrating $BOX..."
rewrite 's|<attachment file="|<attachment ref="|g' "*.email-message.card"
rewrite 's|<message-ref file="|<message-ref ref="|g' "*.email-thread.card"
rewrite 's|<content file="|<content ref="|g'        "*.doc.card"
rewrite 's|<sheet-tab file="|<sheet-tab ref="|g'    "*.sheet.card"

remaining=$({ grep -rln 'file="' "$BOX" \
  --include='*.email-message.card' \
  --include='*.email-thread.card' \
  --include='*.doc.card' \
  --include='*.sheet.card' 2>/dev/null || true; } | wc -l | tr -d ' ')
echo "Done. Cards still containing file=\": $remaining"
