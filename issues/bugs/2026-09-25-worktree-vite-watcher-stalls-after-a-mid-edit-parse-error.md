---
title: "A worktree's Vite dev server stops seeing file changes after a mid-edit parse error, and serves stale modules until the worktree is restarted"
workstream: unattached
area: router
labels: [dev-router, vite]
filed-by: agent
discovered-by: agent
discovered-in: worktree-admin-structure — two agents editing components/admin/ while the page was open
---

During a session with two agents editing `beebox/src/frontend/src/components/admin/`,
the worktree's Vite server logged a parse error for a half-written file
(`Expected corresponding JSX closing tag`), then one more HMR update 37
seconds later, then nothing. Every later save was ignored: the plain module
URL kept returning the old transform while the same URL with a fresh
`?t=` query returned the new code, so the files were readable and only the
watcher had gone quiet. Touching files and waiting two minutes did not help.
`bin/workstreams down <name>` followed by any request brought it back.

It recurred within minutes of a fresh restart, with no parse error in
between: one edit to `src/lib/admin-card-state.ts` was never picked up while
the plain URL served the old transform and a `?t=` URL served the new one.

What is not known: whether the first parse error caused it, or whether the
watcher hit a limit (macOS FSEvents, or the same 1,024-directory ceiling as
the box watcher issue) around the same time. The log in
`~/.cache/beebox/logs/<worktree>.log` had no watcher error either way, so
an agent has no signal beyond "my change is not showing", which it tends to
read as its own bug.

Two possible fixes: make the router notice a worktree whose Vite has stopped
emitting updates for files that changed on disk and restart it, or at least
log a watcher failure so the dashboard can show it.

Related: [box watcher ceiling](2026-09-07-box-watcher-ceiling-leaves-attach-scopes-unwatched.md).
