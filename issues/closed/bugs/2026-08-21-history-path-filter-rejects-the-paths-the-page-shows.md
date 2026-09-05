---
title: "The history path filter rejects the file paths the history page itself displays"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — filtering history by a file taken from the diff panel
resolution: implemented
---

The history page shows changed files with a `content/` prefix — for example
`content/config/template-versions.json` — because git reports paths relative to
the repository root, and the box's git root is the directory above the box root.
The path filter takes a box-relative path
(`beebox/src/webapp/trpc/routers/history.ts:83-91` resolves the input
against `ctx.boxRoot`; `beebox/src/lib/git-log.ts:58` documents the field as
"One box-relative path").

So copying a path out of the diff panel into the filter returns nothing. The page
renders the path chip and "No commits found / 0 loaded" — an empty result, not an
error, which reads as "this file has no history".

Verified against the API: `history.list` with `config/template-versions.json`
returns commits; with `content/config/template-versions.json` returns `[]`.
