#!/bin/sh
# Hard assert for `upload-photos`: the four household photos are IN the box.
# Run from the operational box root; exit 0 = pass.
#
# Matched by filename stem, anywhere under the box, because where an upload
# lands (a batch directory, an attach/ scope, a topic folder the agent chose)
# is the box's business. Uploads are also renamed on the way in — sanitized,
# de-duplicated, sometimes prefixed — so the stem is matched as a SUBSTRING of
# the filename rather than as an exact name.
#
# The photos are the evidence, not the cards about them: a batch that produced
# beautiful cards while losing the files is the failure this check exists for.
#
# `tmp/` and `.beebox/` are pruned along with the trash: a file still
# sitting in capture/bulk STAGING is an upload that did not land, and counting
# it would make an abandoned half-upload look like a success.
#
# POSIX sh, no arrays: this runs wherever the harness runs, macOS /bin/sh
# included.
set -eu

stems="kitchen-sink-leak juniper-school-artwork wren-soccer-schedule pantry-shelf"

missing=""
for stem in $stems; do
  found=$(find . \
    \( -name .git -o -name .beebox -o -path ./tmp -o -path ./store/trash \) -prune -o \
    -type f -name "*${stem}*" -print | head -n 1)
  if [ -z "$found" ]; then
    missing="${missing} ${stem}"
  fi
done

if [ -n "$missing" ]; then
  echo "FAIL: uploaded photo(s) not found anywhere under $(pwd):${missing}" >&2
  exit 1
fi

echo "PASS: all four uploaded photos are present in the box" >&2
