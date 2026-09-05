---
title: "A history deep link to an older commit silently shows the newest commit"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — checking the history page's shareable-link user stories
resolution: implemented
---

`/<box>/history/<hash>` selects the right commit only while that commit is in the
first loaded page (50 commits). For anything older, the page keeps the requested
hash in the URL, renders the NEWEST commit in the detail pane, and highlights
that commit in the timeline. There is no "not loaded" state and no error, so a
shared link reads as if it resolved.

`HistoryBrowser` searches only the first page and falls back to its first entry:

```ts
const match = firstPage?.commits.find((c) => c.hash.startsWith(initialHash));
setSelectedCommit(match ?? firstCommit);
```

(`beebox/src/frontend/src/components/history/HistoryBrowser.tsx:86-89`.)
Later pages arrive through `fetchNextPage`, and the selection is never revisited.

Reproduced with `/history/8d65fe14` (138 commits back), which rendered commit
`993f5e8a`. Deep links inside the first 50 commits work.
