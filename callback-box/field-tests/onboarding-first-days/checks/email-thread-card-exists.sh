#!/bin/sh
# Hard assert for `dentist-email`: the injected message really went through the
# connector and became a card in the box. Run from the operational box root;
# exit 0 = pass.
#
# This is the check on the PIPELINE (fake Gmail → sync → intake → card), which
# is the part no other test tier exercises end to end. It deliberately does not
# care where the card sits or what the agent then did with it — that is what
# `dentist-followup-exists.sh` is for.
set -eu

cards=$(find . \( -name .git -o -path ./store/trash \) -prune -o -name '*.email-thread.card' -type f -print)

if [ -z "$cards" ]; then
  echo "FAIL: no *.email-thread.card anywhere under $(pwd) — the injected mail never became a card" >&2
  exit 1
fi

# "dental"/"dentist" rather than the subject line verbatim: the card's title is
# the agent's to choose, but the message body it carries is not.
matching=$(printf '%s\n' "$cards" | while IFS= read -r card; do
  if grep -qiE 'dentist|dental' "$card"; then printf '%s\n' "$card"; fi
done)

if [ -z "$matching" ]; then
  echo "FAIL: email-thread card(s) exist but none mentions the dentist:" >&2
  printf '%s\n' "$cards" | sed 's/^/  /' >&2
  exit 1
fi

echo "PASS: the dentist email arrived as a card:" >&2
printf '%s\n' "$matching" | sed 's/^/  /' >&2
