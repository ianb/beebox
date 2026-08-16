---
title: "bin/browse screenshot and snapshot hang; second --session blocked by profile SingletonLock"
workstream: unattached
area: callback-box
labels: [browse, dev-tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dev-docs-workflow — exhibits browser-pass verification
---

During a browser verification pass, `bin/browse screenshot` timed out (exit
124) on every page, including `about:blank`. `bin/browse snapshot` hung the
same way. `bin/browse close --all` and killing the daemon did not clear it.
`get text` and `eval` worked normally throughout, so the failure is specific
to the capture commands, not the session.

Separately: `bin/browse --session <name>` cannot run a second concurrent
session. Chrome refuses to start on the shared profile's `SingletonLock`
(`$WT_STATE_DIR/browse/<worktree>/profile`), so a second isolated session in
the same worktree is impossible. If concurrent sessions are meant to work,
each session needs its own profile directory.

Impact: agents cannot produce screenshots for verification reports or
exhibits. Reproduce by running `bin/browse screenshot <any-url>` in a
worktree session.
