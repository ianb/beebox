---
title: "bin/browse does not seed the browse key for a worktree's /dev/ URL"
workstream: canvas-brushes
area: dev-tooling
filed-by: agent
discovered-in: canvas-brushes — opening a canvas-loop live page
resolution: implemented
---

**Closed (implemented, 2026-11-17):** Fixed by e5d641433.

In a fresh browse profile, `bin/browse open
http://localhost:3210/<worktree>/dev/canvas-loop-pages/pieces.html` lands on
the router's login page. The same URL answers 200 to `curl` with the key
cookie, and opens once one box route (`bin/browse open /`) has seeded the
cookie.

`isOwnOrigin` in `browse/src/worktree.ts` accepts only URLs under
`ctx.routerBase`, which is `/<worktree>/<box>`. The read-only dev surfaces
(`/<worktree>/dev/…`, `/workstreams/…`), which the key also authenticates
(`.claude/skills/browse/references/authentication.md`), are not under it, so
no cookie is seeded for them. The browse skill says the key "is re-seeded on
its first own-origin `open`", which reads as covering them.
