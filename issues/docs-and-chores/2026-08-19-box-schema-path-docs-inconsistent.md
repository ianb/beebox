---
title: "Box-local schema docs conflate config/schemas/ logical path with real location"
workstream: unattached
area: docs
filed-by: agent
discovered-by: agent
discovered-in: worktree-public-site — box-authored site page experiment
---

In a v2 box package, box-local schemas physically live at
`<package-root>/src/schemas/` — `box-shape.ts` maps the logical
`config/schemas/` path there, and `content/config/schemas/` is a
`.gitkeep`-only stub. But the guidance (the generated box guide via
`src/core/agent-guide/cards.ts`, and the box's `src/schemas/CLAUDE.md`) says
"a `.ts` file in `config/schemas/`" throughout, which reads as the
content-root path. An agent following it puts the schema in the stub
directory, where nothing loads it. Also noted: the two docs describe the
no-`type:`-in-frontmatter rule inconsistently. Say the physical path (or
explain the mapping) wherever `config/schemas/` appears.
