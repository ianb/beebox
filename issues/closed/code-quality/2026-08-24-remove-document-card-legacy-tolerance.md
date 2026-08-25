---
title: "Confirm no `.document.card` remains on deployed boxes, then retire the migrator note"
workstream: document-card-view
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: document-card-view — renaming the `document` card type to `pdf`
resolution: implemented
---

> **Closed 2026-08-24.** Today's deploy applied `document-to-pdf` on all 6
> prod boxes (`ai-class`, `birch`, `box-family`, `estate`, `mn-pottery`,
> `personal`) and logged it in each `config/migrations.jsonl`.
> `sudo -u callback find /home/callback/boxes -name '*.document.card'` is
> empty — no leftover card files, and `box-family` has the expected
> `content/store/school/grs/Family_Student_Handbook_2025-26.pdf.card`. Local
> boxes (`~/src/boxes/*/`) also have zero `.document.card`.
>
> The card-file sweep left three boxes' *generated* agent-guide docs stale
> (`.claude/rules/card-document.md` and
> `.agents/skills/callback-box-rule-card-document/SKILL.md` in `mn-pottery`,
> `personal`, `box-family`, still naming the old `**/*.document.card` glob) —
> those regenerate only via `cb init`, not passively. Ran
> `cb init` on each (as `callback`, sourcing the services' env, mirroring
> `cb migrate`'s own pre-migration provisioning step) and committed the
> result in each box repo as `cb init provisioning (after document-to-pdf)`,
> matching the boxes' own convention for this step. All three now show
> `card-pdf.md` / `callback-box-rule-card-pdf` instead, matching `estate`
> (which had already converged via its own tick). Re-ran
> `grep -rl 'document\.card' /home/callback/boxes --include='*.card'
> --include='*.md'` (and a `find -iname '*card-document*'`) across all 6
> boxes: both empty. All three box working trees are clean after the commit.
>
> `docs/plans/scanner-ingest.md`'s Track 4 already carries the dated note
> (added in the same rename commit, `4f34b188`) explaining the `document` →
> `pdf` rename and pointing at `src/schemas/pdf.ts`; the note itself says the
> historical Track 4 body is "left as written for the historical record," so
> no further trim.

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
