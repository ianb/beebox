---
title: "file-watcher doctest expects a box listing without _config/feedback and src/publications"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-file-layout — change-selected tests after the core layout moves
---

`beebox/test/core/box/file-watcher.doctest.md` fails four subtests on
`main`. Before the layout moves it lived at
`beebox/test/core/file-watcher.doctest.md`. Its expected box directory
listing lacks `_config/feedback` and `src/publications`, which newer box
scaffolding creates. The layout workstream reproduced the same four failures
at `2b0680f5d`, the commit before its moves. So the expected listing went
stale when those features landed, not because of the moves.

Fix: update the expected listing. First confirm with the owners of the
feedback and publications scaffolding that both directories belong in a new
box.
