---
title: "gsheet-rename migration overwrites an existing destination card on collision"
workstream: unattached
area: beebox
needs: [decision]
labels: [migrations]
filed-by: agent
discovered-in: document-card-view worktree — cross-model review of document-to-pdf
resolution: wontfix
---

> **Closed 2026-08-24 — window closed.** Verified zero `*.sheet.card` files
> remain: local boxes (`~/src/boxes/*/`, all 10) and every prod box
> (`ai-class`, `birch`, `box-family`, `estate`, `mn-pottery`, `personal`, via
> `sudo -u beebox find /home/beebox/boxes -name '*.sheet.card'`, empty on
> both). Each prod box's `config/migrations.jsonl` records `gsheet-rename` as
> applied. No box exists that could still hit the collision this issue
> describes, so the fix is moot; not implementing it.

`scripts/migrate/gsheet-rename.ts` renames `*.sheet.card` → `*.gsheet.card`
without checking whether the destination exists; POSIX rename silently
replaces it, so a box holding both `Foo.sheet.card` and `Foo.gsheet.card`
would lose the latter. `document-to-pdf.ts` now does a pre-pass collision
check and refuses the whole run; the same pattern applies here.

Low urgency: the migration has already run on tracked boxes, so it only
matters for a box that has never migrated. Fix it or record that the
window has closed.
