---
title: "About twenty frontend views wire their own live refresh, with different path matching and reconnect rules"
workstream: dup-sweep-frontend
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-frontend — frontend pass of the functional-duplication sweep
resolution: implemented
---


**Closed:** implemented by the dup-sweep-frontend branch (plan frontend-unify-formatters-refresh-storage; commits 65147fadb through 1bb95099e). Each commit message names the behavior changes. Wording was covered by unit/DOM tests, not checked in a browser.

Part of the [functional-duplication sweep](../../code-quality/2026-10-22-functional-duplication-sweep.md).
Views that refetch when a box file changes each subscribe to the bus and
filter `file-change` events by hand. The sweep moved the shared "skip the
first connect" idiom into `useBusSubscription`'s `onReconnect`. The rest
differs per caller, so merging it changes behavior.

## How the copies differ

- **Path match.** Three conventions:
  - `fileChangeAffectsPath` normalizes slashes and handles directory renames
    (`components/file-view-data.ts`, `CardTodos`, `turn-edits`).
  - `boxRelativePath` equality (`useCardIdentities`, `BrowserTaskView`).
  - A raw compare: `FigureView/view.tsx:95` (`fileChange.path === entryPath`) and
    `pages/browse/BrowsePage.tsx:53` (the parent of the raw event path against
    `dirPath`). `file-view-data.ts` names the raw compare as "the original refresh
    bug". [browse-list-live-refresh-not-firing](../../bugs/2026-07-31-browse-list-live-refresh-not-firing.md)
    may be this.
- **Reconnect.** Six callers resync only on a reconnect. `useRefetchOnFileChange`
  and `BoxPresentationProvider` also refetch on the first connect, so they
  fetch twice on mount. FigureView, BrowserTaskView, CardTodos,
  DirectoryTodos and TodoViewCard do not resync on a reconnect at all.
- **Deferral.** Only file-view-data, AgentViewRenderer and AppNav's nav
  use `useDeferredResync` (coalesce, wait while hidden).
- **Debounce.** `useRefetchOnFileChange` uses 500 ms, `BoxPresentationProvider`
  150 ms, the rest none.
- **Event sets.** `DashboardPage`, `QuestionsList` and `AppNav/nav.tsx` each list
  their own invalidating events, and the lists differ.
- `chat/ambient/AmbientReplies/view.tsx:51` re-adds a `visibilitychange`
  listener on every render (its effect has no deps).

## Open question

One `useLiveRefresh({ match, refresh })` could own matching (always
`fileChangeAffectsPath` or a predicate), reconnect resync and deferral. The
design question is whether every view should defer while hidden and resync
on reconnect. That changes when fetches happen.
