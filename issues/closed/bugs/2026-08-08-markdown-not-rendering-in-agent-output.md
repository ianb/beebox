---
title: "Markdown and source-citation markup render raw in agent output and cards"
workstream: vocab-sweep
resolution: implemented
area: beebox
filed-by: agent
discovered-in: worktree-integration-tests — field-test onboarding-first-days (multiple activities)
labels: [soft-launch, field-test-findings, ui-error]
priority: important
---

> **Closed 2026-09-02 (vocab-sweep).** Both remaining symptoms resolved: the
> todo-view `**` glob fix landed earlier; the `[→ …]` guidance already
> existed in `src/core/agent-guide/source.ts` (audit `source-no-bracket-form`
> pass, 2026-08-09) — the 2026-09-02 survey note below checked the wrong
> file, corrected in this branch's note. The apostrophe-loss note stays open
> as its own issue, [apostrophes-lost-in-slugs-and-titles](../../bugs/2026-09-02-apostrophes-lost-in-slugs-and-titles.md)
> (different mechanism, workstream unattached).

> **Re-attributed 2026-08-09 — neither symptom is a markdown-rendering bug.**
> (1) The bare `**` under "The Plate" was never markdown: it was the todo
> view rendering its `glob: "**"` frontmatter as an unlabeled mono line under
> the heading. Fixed: the box-wide `**` is no longer shown; a scoped plate's
> glob renders as "Scope: <glob>" (`TodoViewCard.tsx`). (2) The `[→ …]`
> bracket form is the system's own CLAUDE.md-downgrade serialization of
> `{% source %}` (`src/core/markdoc/emit-tags.ts` — "markdown can't capture
> the chip UI"), which the agent read in its compiled briefing context and
> imitated in chat prose. Chat's renderer DOES render real `{% source %}`
> tags as citation chips (`Markdown.tsx` wires `SourceInline`/`SourceBlock`),
> so the remaining work is guidance/design, not rendering: teach the box
> agent that `[→ …]` is a compiled-doc artifact it must never write — in
> chat, use `{% quote %}`/`{% source %}` or a plain link. Bold/`**` markdown
> was confirmed rendering normally everywhere. The apostrophe-loss note
> ("Wren's" → "Wrens") remains unexamined.
Across the onboarding field-test run, agent-authored markup reached the UI
unrendered:

- **Bare `**`** shown as literal text under the "The Plate" heading
  (`screenshots/dentist-email/02-todos-plate.png`, verified by eye) — bold
  markdown that didn't parse.
- **Source-citation blocks show raw brackets and arrow**: `[→ original.txt: the
  recipe as it was written in the family's own file — kept verbatim]` and
  `[→ thread Reminder Wrens check up Thursday 14 Augu reminder: …]` render with
  their literal `[→ … ]` syntax rather than as a designed citation element
  (recall-recipe, dentist-email). In one the citation is truncated mid-word
  ("Augu") and loses the apostrophe from "Wren's".

Two surfaces are implicated — the chat/message renderer and the card renderer —
so the likely root is a shared markdown/citation rendering path (`src/frontend/`
Markdown component and/or the source-tag renderer) that some agent output takes
and some doesn't. Worth pinning down which citation syntax the agent emits
(`[→ …]`) and whether the renderer is supposed to turn it into a source
affordance; right now it leaks as raw markup, which reads as broken to a user.

The apostrophe loss ("Wren's" → "Wrens", "Nana Odette's" → "Nana Odettes" in
tabs and menus) recurs in filenames/titles and may be a separate slugging
issue; noted here since it showed up in the same citations.


> 2026-09-02 survey (bbx-pick-issues): still true for the remaining half — `core/agent-guide/behavior.ts` has no guidance about the `[→ …]` compiled-doc serialization; the apostrophe-loss slug note is untriaged. Grouped with 2026-08-08-implementation-vocab-leaks-into-ui as one vocabulary sweep.

> 2026-09-02 (vocab-sweep): the apostrophe-loss note is a different mechanism
> (slug/title derivation, not vocabulary or rendering) and is split into its
> own issue: [apostrophes-lost-in-slugs-and-titles](../../bugs/2026-09-02-apostrophes-lost-in-slugs-and-titles.md).
> The `[→ …]` guidance gap turned out to be already closed: the survey note
> above checked the wrong file. The guidance lives in
> `beebox/src/core/agent-guide/source.ts` ("Never write the `[→ …]` bracket
> form"), verified by the `source-no-bracket-form` knowledge audit (pass,
> knows_directly, 2026-08-09). Nothing remains here but this correction.
