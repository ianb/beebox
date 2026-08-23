---
title: "The browse sidebar has no error state — a failed tree load just says Loading..."
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — opening /browse on a cold browser profile
---

On a cold browser profile the browse sidebar sat at "Loading..." indefinitely.
A reload fixed it. It happened several times while several agents were hitting
the same box server, so the trigger may be contention rather than a fault in the
query itself.

What the code guarantees regardless of trigger is that there is no way out of it
from the page. The sidebar renders the list when `data` is present, "Loading..."
while the query is in flight, and nothing at all otherwise
(`callback-box/src/frontend/src/pages/browse/BrowsePage.tsx:285-296`). There is
no error branch and no retry control, and the query's default retries keep
`isLoading` true, so a failing `status.browse` shows a permanent "Loading..."
and then an empty pane.

The tree is the only navigation on the page, so this state leaves the person with
nothing to click and no statement of what went wrong.
