---
title: "Review the standard card fields: remove the ones that slipped in, and decide whether every card needs a title"
workstream: unattached
needs: [design]
area: beebox
labels: [cards, schema]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
---

Fields such as `created` and `status` slip into card schemas without a
clear job. Agents then fill them in, readers expect them to mean something,
and nothing reads them. The memo type shows both problems: its `status`
never leaves `new`, and its `created` is misused
([retire memo](2026-09-27-retire-memo-card-type-into-doc.md)). The
developer wants a review of the standard fields across all card types.

## Scope

- **The global fields.** `GLOBAL_CARD_FIELDS` in
  `beebox/src/cards/schema.ts:100`: `title`, `contains`,
  `contains-evidence`, `todos`, `symbol`, `prominence`, `theme`.
- **Per-type fields with repeated names.** On 2026-09-27:
  - `status` is defined in about 35 schemas.
  - `created` is defined in `memo` and `pub-submission`.
  - `date` is defined in `email-message`, `image`, `personality`, and the
    guide schemas; `modified` in `gdoc` and `gsheet`.

  For each one, the question is whether code reads it, whether its values
  change over time, and whether it means the same thing everywhere. A name
  with different meanings in different schemas is the kind of collision the
  [codebase ontology](../docs-and-chores/2026-09-27-codebase-ontology-files.md)
  treats as a bug.
- **Timestamps.** The developer's position: a creation time is valid only
  when something is made later from an earlier piece of media, for example a
  transcription made from a recording. Git history already records when a
  card was written.
- **Titles.** The developer wishes cards had titles. Today `title` is
  optional on every type and required only by `doc`, `gdoc`, `gsheet`, and
  `recipe`. Untitled cards fall back to the file name, or, for memo, to the
  start of the body with its markdown. Decide whether `title` becomes
  required on most or all types, and what that means for cards created
  without one (captures, connector output).

## Output

For each field: keep, remove, rename, or make required. Changes to existing
cards need a migration (the bbx-migration skill). The rule for adding a new
field to a schema goes where the schema workflow is documented
(`beebox/docs/cards/schemas.md` and the bbx-guide-schemas skill).
