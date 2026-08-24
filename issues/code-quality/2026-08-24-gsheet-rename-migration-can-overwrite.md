---
title: "gsheet-rename migration overwrites an existing destination card on collision"
workstream: unattached
area: callback-box
needs: [decision]
labels: [migrations]
filed-by: agent
discovered-in: document-card-view worktree — cross-model review of document-to-pdf
---

`scripts/migrate/gsheet-rename.ts` renames `*.sheet.card` → `*.gsheet.card`
without checking whether the destination exists; POSIX rename silently
replaces it, so a box holding both `Foo.sheet.card` and `Foo.gsheet.card`
would lose the latter. `document-to-pdf.ts` now does a pre-pass collision
check and refuses the whole run; the same pattern applies here.

Low urgency: the migration has already run on tracked boxes, so it only
matters for a box that has never migrated. Fix it or record that the
window has closed.
