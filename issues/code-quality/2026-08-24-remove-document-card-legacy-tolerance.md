---
title: "Confirm no `.document.card` remains on deployed boxes, then retire the migrator note"
workstream: document-card-view
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: document-card-view — renaming the `document` card type to `pdf`
---

The `document` → `pdf` card-type rename (`scripts/migrate/document-to-pdf.ts`,
registered as `document-to-pdf` in `src/core/migrations.ts`) left **no legacy
tolerance code** — there is no fallback branch, lenient parse, or "both
spellings accepted" reader anywhere in the sweep. The schema, CLI command,
core commands, and frontend all require `pdf` outright; a box that has not run
the migration simply fails to load its `.document.card` files under the new
schema until it does.

Nothing to extend or delete in source. The only follow-up is operational:

- Once every deployed box has run `cb migrate` past `document-to-pdf` (or been
  confirmed to have never held a `.document.card`), the migrator itself can
  stay registered forever (append-only `MIGRATIONS`, per `docs/migrations.md`)
  but the "why this exists" note can be trimmed from
  `docs/plans/scanner-ingest.md`'s Track 4 section and the dated note added at
  the top of that section (2026-08-24) — check that no live box still needs
  the explanation.
- Confirm via `grep -rn "\.document\.card"` across deployed box content (or
  `cb validate` failing to resolve `document` as a type) that none remain.
