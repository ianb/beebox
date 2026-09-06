---
title: "Figure cards fail to load their sketch: /api/figure/module.js answers \"Attach scope has no owning card\""
workstream: sidecar-shell
area: beebox
labels: [ui]
filed-by: agent
discovered-by: agent
discovered-in: "worktree-sidecar-shell — while verifying the card sidecar in a browser"
priority: normal
resolution: implemented
---

Resolved by commit 398548df0 (`fix(figure): find a figure's owning card by
basename, not filename`): `hasOwningCard` now matches any sibling card whose
`cardBasename()` equals the attach directory's owner basename, using the
shared `src/shared/attach-path.ts` helpers. The separate stale-`view:store/…`
content issue noted below was left as-is, per the issue's own note that it is
not a code defect.

Every `figure` card in the test box renders "Figure error" instead of its
sketch. The card view requests its module and the server refuses it.

```
GET /<prefix>/test1/api/figure/module.js?import&path=_content%2Ffigures%2FCube.attach%2Fsketch.ts
400 {"error":"Attach scope has no owning card"}
```

The owning card is present on disk. `_content/figures/` holds
`Cube.figure.card` beside `Cube.attach/sketch.ts`, which is the standard
attachment layout, so the resolution that answers "no owning card" disagrees
with the box's actual shape. `Figure_Gallery.doc.card` shows the same failure
for its embedded figures, as "Failed to load" placeholders rather than an error
box.

The cause is in `hasOwningCard` (`beebox/src/webapp/routes/figure.ts`): it
builds the owner's filename by replacing the `.attach` suffix with `.card`, so
`Cube.attach/` looks for `Cube.card`. A card filename carries its type, so the
owner is `Cube.figure.card` — and `Cube.card` is a *positional* card of type
"Cube", which exists in no box. Every figure in every box was refused. The
route's own doctests seeded `Demo.figure.attach/`, a dotted form that matches
the broken rule; no box uses it (0 of 6089 attach directories across every local
box), so the tests agreed with the code and both disagreed with the boxes.

Separate, and NOT a code defect: `_content/figures/Figure_Gallery.doc.card`
embeds its figures as `view:store/figures/….figure.card`. The `store/` prefix is
a stale path from an older box layout — those embeds are broken box content in
test1, and stay broken after this fix.
