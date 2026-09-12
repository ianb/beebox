---
title: "Box-local schema docs conflate config/schemas/ logical path with real location"
workstream: unattached
area: docs
resolution: implemented
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


## Fixed upstream, stale on some boxes — closed 2026-09-12

Both documents named here are correct now.

- The generated box guide (`core/agent-guide/cards.ts:235`) is explicit and
  goes further than this issue asked: schemas go in `src/schemas/` at the box
  root, "**NOT `_config/schemas/`** — a schema left there is invisible to the
  loader."
- `box-layout-spec.ts:283` carries a matching legacy-location check, so a `.ts`
  left in the old place is now *reported* rather than silently ignored.
- The schemas guide template is derived by substitution rather than maintained
  by hand — `SCHEMAS_CLAUDE_MD_V2 = SCHEMAS_CLAUDE_MD.replaceAll("config/schemas/",
  "src/schemas/")` (`core/box/templates.ts:186`) — so the two can't drift
  again. Verified by rendering it: **0** mentions of `config/schemas`, 3 of
  `src/schemas`.

**What is left is delivery, not wording.** Three of six local boxes still hold
the old copy on disk — each with 3 stale `config/schemas/` mentions, in a file
that itself lives in `src/schemas/`, telling an agent to write schemas
somewhere other than the directory the instructions are sitting in.

test1's `_config/template-versions.json` has 22 entries and **no
`schemas-guide-v2` entry**, which is exactly the parking condition: a changed
template with no version entry and no matching `priorStockHashes` never lands.
That is a rollout problem shared by every template, not a fact about this
document, so it does not belong to this issue — see the template-rollout
tracking work rather than re-fixing the text here.
