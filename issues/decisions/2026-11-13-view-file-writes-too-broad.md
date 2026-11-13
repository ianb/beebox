---
title: "View file writes reach the whole box: narrow what a view may write"
workstream: unattached
needs: [design, decision]
area: beebox
labels: [views, security]
filed-by: agent
discovered-by: Ian
discovered-in: "canvas-brushes workstream, reviewing how a box's figures logged learner actions, 2026-11-13"
---

A view's file helpers (`beebox/src/frontend/src/hooks/useViewFileHelpers.ts`)
include `writeFile`, `appendFile` and `commitFile`. They call
`PUT`/`POST /api/files/*` and `POST /api/files-commit` as the signed-in
person. The only server rule
(`beebox/src/webapp/routes/api/register/files-write.ts`, `guard`) is that the
path resolves inside one of the box's underscore areas and is not a card or a
dotfile. So any view, written by a box agent, can overwrite or append to any
non-card file in `_content`, `_config`, `_tmp` and so on, and commit it.

The boxholder's view: views have real reasons to write, but not to this
degree.

The helpers came from commit d1050f0fa ("views are read/write surfaces",
2026-06-12), with version-checked saves and no auto-commit. Uses seen on
2026-11-13, across the boxholder's local and production boxes:

- saving a view's own state file (a puzzle's progress, a sandbox's settings)
  and committing it;
- rewriting a progress document a view shows;
- appending rows to a data file the view reads;
- one box logging every learner action from many figures and views to one
  shared JSONL file. The boxholder does not want this technique; first-class
  activity is planned separately.

Figures got the same helpers by reuse (`figure.file`, from the figure card
plan's "data loading" need) and are being cut back to read-only on their
own; this issue is about views.

Questions to decide:

- Where may a view write: its own card's attach folder, a declared list of
  paths, or a dedicated data subfolder?
- Does `commitFile` stay with views, or does the box commit on its own
  schedule?
- Does `adapterFetch` (connected services, with keys the server adds) need its
  own grant?
- How do existing views that write elsewhere move?
