---
title: "Browse name guard calls a visible search result covered"
workstream: journey-walk
resolution: implemented
area: browse
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey C and independent verification
---

Closed in the journey-walk worktree: the name guard now inserts block-boundary
spacing, stops name collection at the hit control, and decodes escaped snapshot
names before comparison. This is a harness
fix; it does not change product search behavior.

Verification: a fresh browser session on C's disposable box searched for the
fictional person Bram, clicked the first rich result through its snapshot ref,
and opened the saved document. Ordinary navigation also passed. Separate
browser fixtures confirmed that an overlay and a changed same-role name still
cause refusal. A review then exposed an ancestor-scope gap: an overlay inside
`#root` incorrectly passed by matching the target text elsewhere in that root.
A browser regression reproduced `ok: true` before bounding the ancestor walk;
after the fix it returned `covered`. The same check passed an unobstructed rich
option and rejected both a changed name and an overlay within a listbox.
A further regression covered an overlay control named only with the target
name's prefix: it incorrectly passed before removing the reverse substring
comparison and was refused afterwards. Matching now requires a candidate to
contain the whole expected name.
The final C-box replay clicked the first Bram result (`@e32` in that snapshot),
returned `Done`, and selected the Reconnecting document tab.

The doctest covers snapshot escaping/annotation; rendered DOM
spacing and occlusion were browser-verified, not covered by that doctest.


The journey walker clicked the visible first search result twice, including a
fresh snapshot and scroll-into-view retry. `bin/browse` refused it as `covered`.
The independent replay produced the same refusal, while `elementFromPoint` at
the result centre returned the result button itself (`centerHitsOwnResult: true`).
This is a harness defect, not evidence of an app overlay blocking search.

## Re-encounter and repair (2026-09-21)

The same guard failure reappeared during the F journey on the canonical Search
surface, this time for the visible Search input on fresh snapshot references.
An independent replay on disposable C reproduced it deterministically:

```text
searchbox "Search this box" [ref=e36]
✗ fill @e36 refused: covered — the element at the ref's center is input#:r2:, not "Search this box"
```

The input was visible and its center hit the input itself. Its accessible name
came from the associated visually hidden native label (`label[for=":r2:"]`,
text `Search this box`), while the tighter hit-control boundary in
`namesOf` only collected the input's placeholder and value. The prior ancestor
scope and prefix-match repairs therefore left this native-label case uncovered.

The local repair adds associated native label text from `e.labels` to the
candidate names while preserving the nearest-control boundary and whole-name
matching. The fresh C replay then succeeded:

```text
✓ Done
```

The existing rich-result/overlay guard fixtures still reject overlays and
changed names while accepting an unobstructed rich option. The focused
`browse-controls` doctest remains 8/8 passing, and browse typecheck and lint
pass. No product behavior changes.

Coverage limit: native labels, block spacing and overlay boundaries were
browser-verified only; there is no durable automated DOM regression for them.
The local `scratch/check-rich-guard.mjs` fixture was adapted to the isolated
`f-search-probe` session; the label case used the real C-box Search input.
The eight doctests exercise snapshot parsing/escaping, and typecheck/lint do
not parse the JavaScript inside the generated script string. These gates
must not be described as automated coverage of the native-label fix.

## Verified mechanism

`browse/src/act.ts:237–254` passes the snapshot accessible name to the point
check. `browse/src/controls.ts:262–275,285–291` compares that name against DOM
attributes/raw `textContent`. Whitespace normalization does not insert spaces
between adjacent block contents. SearchResults renders title, type, path and
snippet as separate elements without an explicit accessible label or `bbx-` id.

The snapshot begins `Reconnecting with friends doc todos/Reconnecting…`.
Raw text begins `Reconnecting with friendsdoctodos/Reconnecting…`.
The mismatch is rejected before the actual occlusion check at lines 318–323.
The diagnostic truncates its display to 40 characters; truncation is not the
cause of the comparison failure.

Retain real stale-ref and occlusion protections while making this name check
agree with the accessible target. A regression should use adjacent title/badge/
path/snippet elements, not merely a plain text button.

Evidence: [journey C report](../../../beebox/user-stories/journeys/C-reconnecting/reports/2026-09-21.md),
actions 45–47, screenshot 25. Related historical guard introduction:
[click reported success without dispatch](2026-08-21-browse-click-on-a-ref-does-not-dispatch.md).
The old silent-dispatch defect and this false refusal are different failures.
