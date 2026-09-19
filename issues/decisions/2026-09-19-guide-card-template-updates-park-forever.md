---
title: "Guide cards learn, so their template updates park on every install once a box has learned anything"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: split from issues/bugs/2026-09-12-procedure-templates-ship-pre-one-root-paths.md (closed by refresh-maps-correctness)
---

A guide card is a learning surface: `triage-rules` accumulate
`source: inferred` entries. Once a box learns anything, its guide differs
from the template permanently, and `installTemplateFile` parks every later
update under `_config/_template-updates/`. `test1` was in that state on
2026-09-12.

Options:

- Declare the learned fields as `boxOwnedFields`
  (`src/core/install-template-file.ts` supports them), so upstream changes to
  the rest of the card still install.
- Install guide templates only at first install, and never update them.

This is a decision, not a bug.
