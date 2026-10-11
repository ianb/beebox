---
title: "One production root briefing still carries {% key-person %} body tags"
workstream: plugins-planning
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-plugins-planning — watching the body-tags-2026-10 deploy sweep, 2026-10-10
---

The deploy sweep on 2026-10-10 printed four lines of
`markdoc/emit: unknown tag {% key-person %}; emitting inner content only`.
One production box's `_content/briefing.briefing.card` has four
`{% key-person called="…" %}…{% /key-person %}` blocks in its body. Key people
moved to the `key-people:` frontmatter list when that tag was retired, so the
tag is now unknown. The emitter drops the tag and keeps the inner text, so
the compiled briefing shows each person's notes with no name or role, and
every compile logs the warning.

A question card in the same box tells a follow-up agent to "update the
`{% key-person called="…" %}` block", so an agent will keep writing the
retired shape until the briefing and that question are reconciled.

## What to do

Move the four blocks into `key-people:` entries (`called`, `role`, `notes`)
on that box and update the question card's directive. Check the other five
production boxes and the local boxes under `~/src/boxes/` for the same tag
(the 2026-10-10 grep found none elsewhere). If the earlier key-people
migration skipped this box, say why in its migration notes.

The box name is in the deploy log on the server and in the sweep output; it
is not recorded here.
