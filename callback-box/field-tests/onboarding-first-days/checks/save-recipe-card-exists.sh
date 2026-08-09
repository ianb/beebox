#!/bin/sh
# Hard assert for the `save-recipe` item: the box holds a recipe card that is
# actually the lemon chicken one. Run from the operational box root; exit 0 = pass.
#
# Deliberately find-based rather than checking a fixed path: where a card lands
# (`store/`, a topic directory, wherever the agent decided) is the box's
# business, and pinning it here would turn a legitimate filing choice into a
# test failure. What is NOT negotiable is that a live `*.recipe.card` exists and
# names the dish — that is what "saved so it can be found later" means.
#
# `store/trash/` is pruned: a card that was created and then trashed is exactly
# the outcome this check must not call a pass.
#
# POSIX sh with no arrays or `mapfile`: this runs wherever the harness runs,
# including a stock macOS /bin/sh.
set -eu

cards=$(find . \( -name .git -o -path ./store/trash \) -prune -o -name '*.recipe.card' -type f -print)

if [ -z "$cards" ]; then
  echo "FAIL: no live *.recipe.card anywhere under $(pwd)" >&2
  exit 1
fi

# Both words, so a lemonade recipe or an unrelated card mentioning a lemon
# cannot stand in for the dish the operator was asked to save.
matching=$(printf '%s\n' "$cards" | while IFS= read -r card; do
  if grep -qi lemon "$card" && grep -qi chicken "$card"; then printf '%s\n' "$card"; fi
done)

if [ -z "$matching" ]; then
  echo "FAIL: recipe card(s) exist but none mentions both \"Lemon\" and \"Chicken\":" >&2
  printf '%s\n' "$cards" | sed 's/^/  /' >&2
  exit 1
fi

echo "PASS: lemon recipe card saved:" >&2
printf '%s\n' "$matching" | sed 's/^/  /' >&2
