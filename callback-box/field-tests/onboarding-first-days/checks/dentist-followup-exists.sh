#!/bin/sh
# Hard assert for `whats-needed`: the box turned the dentist email into
# something ACTIONABLE — a todo, a question, a note, a card of any kind that is
# not merely the stored copy of the message. Run from the operational box root;
# exit 0 = pass.
#
# The bar is deliberately low and layout-agnostic: any card outside the raw
# email surfaces (`*.email-thread.card`, `*.email-message.card`, `box/inbox/`)
# that mentions the appointment counts. Naming the shape more precisely — "a
# `{% todo %}` tag", "a question card" — would encode today's product decisions
# into a test whose whole purpose is to notice when the box does nothing.
#
# Chat cards are excluded, and that exclusion is what keeps the low bar honest:
# a chat husk's title and body carry the OPERATOR's own words, so an operator
# who merely typed "what about the dentist?" would otherwise satisfy a check
# about what the BOX did.
set -eu

candidates=$(find . \
  \( -name .git -o -name .callback-box -o -path ./tmp -o -path ./store/trash -o -path ./box/inbox \) -prune -o \
  -name '*.card' -type f -print |
  grep -v '\.email-thread\.card$' |
  grep -v '\.email-message\.card$' |
  grep -v '\.chat\.card$' || true)

if [ -z "$candidates" ]; then
  echo "FAIL: no non-email cards at all under $(pwd)" >&2
  exit 1
fi

matching=$(printf '%s\n' "$candidates" | while IFS= read -r card; do
  if grep -qiE 'dentist|dental|check-?up' "$card"; then printf '%s\n' "$card"; fi
done)

if [ -z "$matching" ]; then
  echo "FAIL: nothing outside the raw email cards mentions the appointment —" >&2
  echo "      the box stored the mail but did nothing with it." >&2
  exit 1
fi

echo "PASS: the appointment surfaced beyond the raw email:" >&2
printf '%s\n' "$matching" | sed 's/^/  /' >&2
