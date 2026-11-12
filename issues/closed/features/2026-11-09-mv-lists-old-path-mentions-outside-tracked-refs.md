---
title: "bbx mv could list mentions of the old path that it does not rewrite"
workstream: unattached
area: beebox
labels: [refs, agent]
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: "courseware box feedback — Mv_Leaves_Stale_Refs_Inside_Attach_Scope, 2026-11-09"
---

**Closed (implemented, 2026-11-09):** the boxholder chose fixing over listing. `bbx mv` now rewrites any path that resolves exactly to the moved card (or into its `.attach/` folder) in every `.md` file, `AGENTS.md`/`CLAUDE.md` included, in code spans, fenced blocks, and plain text, keeping relative or box-absolute form. `.ts` files are not touched (box-feedback-bugs).

`bbx mv` rewrites tracked refs in cards, `.md` files, and views. It does not
read `AGENTS.md` files (`isBuiltinLintableMarkdown` excludes agent
instruction files) or box code such as `src/schemas/*.ts` instruction
strings. In the courseware box, box paths in those files went stale after a
move, and the agent found them only by hand.

The box agent suggested that `bbx mv` print the files outside its rewrite
set that still contain the old path as text, so the agent can check them.
A plain substring search of the box's text files for the old box-relative
path would do; the move would not change them.

The tracked-ref part of the same report was fixed:
[mv skips absolute refs inside moved attach scope](../bugs/2026-11-09-mv-skips-absolute-refs-inside-moved-attach-scope.md).
