---
title: "Figure cards fail to load their sketch: /api/figure/module.js answers \"Attach scope has no owning card\""
workstream: unattached
area: beebox
labels: [ui]
filed-by: agent
discovered-by: agent
discovered-in: "worktree-sidecar-shell — while verifying the card sidecar in a browser"
priority: normal
---

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

Not investigated: whether this is specific to a worktree's cloned box (the
request goes through the dev router's `/<worktree>/` prefix, and the module URL
carries a `?v=` cache-busting parameter), or whether figures are broken
everywhere. Reproduce by opening `_content/figures/Cube.figure.card` in Browse
or in the chat sidecar, then re-check on the main checkout's box before
concluding it is general.

Owner: the figure/attach-scope resolution behind `/api/figure/module.js`.
