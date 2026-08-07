---
title: "GET /api/task-output reads host-tmp-wide, not box-scoped"
area: callback-box
filed-by: agent
discovered-in: worktree-security-report — endpoint inventory for the security report
---

`src/webapp/routes/api.ts:78` (`GET /api/task-output`) validates only
that the requested path starts with `/private/tmp/` or `/tmp/` and
contains `/tasks/`. It rides the normal box auth wall, but the paths it
serves are **host-wide**: any box member (or agent/browse/mobile
credential holder) on any box can read any matching file in the host's
tmp — including other sessions' and other worktrees' subagent transcripts,
which can contain box content from a different box.

On a single-operator machine this is moot; it matters on a multi-box
server with distinct members, and it is a cross-box information leak by
design shape (the same class the hub child-env allowlist exists to
prevent). Fix direction: scope the readable roots to the requesting
box's own session/task directory, or gate the route owner-only.
