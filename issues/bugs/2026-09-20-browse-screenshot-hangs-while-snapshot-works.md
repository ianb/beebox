---
title: "bin/browse screenshot hangs on every app page while snapshot, click, and eval work"
workstream: unattached
area: beebox
labels: [browse, dev-tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-collection-views — visual check of the rewritten todo list
---

On 2026-09-20, `bin/browse screenshot` did not return on any page of the
worktree app. Two sessions saw it: an implementation agent (two 120 s
timeouts) and the driving session (exit 124 at 45 s to 100 s, four attempts).
It hung with `--slug`, with an explicit path, on the new todo list, and on an
unrelated `person` card, so the page content is not the cause. No file was
written.

In the same browser session `open`, `snapshot -i`, `click`, and `eval` all
worked and returned promptly.

This differs from the closed
[screenshot and snapshot hang](../closed/bugs/2026-08-15-browse-screenshot-hangs.md).
There, `snapshot` hung too, and the cause was the readiness wait that both
commands share. Here `snapshot` passes that wait, so the hang is inside the
capture step itself. That is why this is filed as a new defect and the old
issue stays closed.

Not investigated: whether the capture call blocks in headless Chrome when the
machine's display is asleep or locked, whether `--full` or `--annotate`
behave differently, and whether a fresh daemon clears it. The router was not
restarted, because a worktree session must not manage the shared router.

Impact: no screenshot evidence and no exhibit for UI work in this worktree.
The visual check fell back to the accessibility snapshot and page text.

**Re-encountered the same day in `worktree-mobile-app-bar`,** with two of the
open questions answered:

- It is not the app. `bin/browse screenshot` also hangs on
  `data:text/html,<h1>hi</h1>`, a page with no app, no readiness marker, and
  no network.
- A fresh daemon does not clear it. `bin/browse close --all` followed by a new
  `open` still hangs on capture, as does a separate `--session` with its own
  Chrome profile.
- `--no-wait`, an explicit output path, and a selector-scoped capture all hang
  the same way. Six attempts, 30 s to 120 s timeouts, no file written.

One run launched in the background reported exit 0 after the foreground
timeout had already been moved aside, and still wrote no file — so the capture
does not merely block, it can also return without producing output.

The remaining untested hypothesis from the original filing stands: the display
was asleep or locked during every attempt in both worktrees.
