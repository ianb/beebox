---
title: "bin/browse screenshot and snapshot hang; second --session blocked by profile SingletonLock"
workstream: browse-capture-hang
area: callback-box
labels: [browse, dev-tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dev-docs-workflow — exhibits browser-pass verification
priority: important
resolution: implemented
---

Closed by 62dc462c and 8be6945f. Both symptoms had one cause each, and the
second was not the first. Details below the original report.

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

## Cause and fix

The wrapper waits for the app to settle before it reads a page: `bin/browse`
runs `agent-browser wait --fn "document.body.dataset.cbLoading === 'false'"`
before `snapshot` and `screenshot`, and after `open`. On agent-browser 0.27.0
that wait never returns on a page that does not set the marker. Its
`--timeout` flag is parsed only in `--download` mode, and the documented 25s
default action timeout is not applied unless `AGENT_BROWSER_DEFAULT_TIMEOUT` is
set. So `about:blank`, any other site, and the login wall all hung forever.
`eval` and `get` pass straight through the wrapper and never wait, which is why
the failure read as capture-specific and survived daemon restarts and
`close --all` — the profile was never involved.

The wait now runs only when the loaded page is this worktree's own origin, sets
the env var that bounds it (15s, `BROWSE_READY_TIMEOUT_MS`), and carries a
wall-clock kill in the runner as a backstop. On timeout it writes a note to
stderr and captures anyway.

The `--session` failure was unrelated. Every session shared one Chrome profile
directory, and Chrome aborts rather than open a profile another live instance
holds. Each session now gets `profiles/<name>` under the worktree's browse
cache. A fresh profile starts with an empty cookie jar; the browse key is
re-seeded on the first own-origin `open`, so nothing has to carry over, but
login or app state set up in one session is not visible in another.

Verified against `about:blank`, a real app page, and an own-origin page with
the marker removed, headed and headless, after a daemon restart, and with two
named sessions live at once. Covered by
`callback-box/test/dev/browse-session-profile.doctest.md`.
