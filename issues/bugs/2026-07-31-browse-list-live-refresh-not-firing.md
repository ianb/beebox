---
title: "Browse sidebar live-refresh did not fire for a file added to the open directory"
workstream: browse-back-url
area: beebox
filed-by: agent
discovered-in: worktree-browse-back-url — first real-browser verification after the browse-key auth work
priority: backlog
---

`useBrowseListLiveRefresh` (`src/frontend/src/pages/browse/BrowsePage.tsx`)
refetches the directory listing when a `file-change` event names a file directly
inside the open directory. In a real browser it did not fire.

## What was observed

Against an isolated dev router, with `/browse/store/recipes` open:

1. A new card was written directly to
   `<box>/content/store/recipes/Live_Refresh_Probe.recipe.card`.
2. After 4s and again after 12s (plus a `touch`), the sidebar still listed only
   the two original cards.
3. A page reload showed all three. So the API and the box see the file; only the
   live path did not.

The WebSocket transport is not the cause: a raw upgrade to
`/<wt>/<box>/api/trpc` carrying the browse-key cookie returns `101 Switching
Protocols`, and is refused without it.

## Not the BrowsePage change

The browse work in
[browse-back-button-url-not-updated](../closed/bugs/2026-07-22-browse-back-button-url-not-updated.md)
made the URL the source of truth for the open file. For a DIRECTORY url that
change is a no-op for this hook: `dirPath` is `currentPath` before and after,
and the hook itself was untouched. Worth re-checking, but the wiring is
identical.

## Research (incomplete)

Candidates, none confirmed:

- The bus subscription (`useBusSubscription`) never established in this
  headless browser, despite the transport authenticating. Check whether the
  tRPC `events.subscribe` subscription is live client-side.
- The box's file watcher did not emit `file-change` for a file created by an
  external write (as opposed to one written through `bbx`).
- The event fired but `parent !== dirPath` — e.g. a path-shape mismatch between
  the event's `path` and the browse `dirPath`.

Reproduce with the isolated-router setup in
`beebox/docs/implemented-plans/agent-token-browser-auth.md` — that is now the only way
an agent can drive the dev app in a browser at all.

## Related

While verifying, the page also logged, on every load:

```
Service worker registration failed: ... A bad HTTP response code (401) was
received when fetching the script ('/<worktree>/sw.js')
```

`sw.js` is served at the worktree root and is not in the router's
`VITE_DEV_ASSET_SEGMENTS` allowlist (`bin/router-auth.ts`), so it is refused
even for an otherwise-authenticated browser. It surfaces as a permanent "1
error" badge in the dev UI. Probably wants adding to that allowlist — it serves
no box data — but that is an auth-surface change and was left alone here.

## Audit 2026-10-22

The service-worker part is fixed: the dev router now allows `/<w>/sw.js` without auth (`workstreams-app/src/router/server/auth.ts:206`, commit `60a9e188c`). The live-refresh hook is unchanged (`useBrowseListLiveRefresh`, `beebox/src/frontend/src/pages/browse/BrowsePage.tsx:45`). The report that it does not fire in a real browser is not yet reproduced or ruled out.

## Note 2026-10-23 (functional-duplication sweep)

The third candidate above has support. `useBrowseListLiveRefresh` compares the
parent of the raw event path to `dirPath`. Sibling views normalize the event
path first (`fileChangeAffectsPath` or `boxRelativePath`), and
`components/file-view-data.ts` names the raw compare as "the original refresh
bug". The sweep left the compare unchanged; the comparison of all live-refresh
copies is in [frontend-live-refresh-hooks-disagree](../closed/code-quality/2026-10-23-frontend-live-refresh-hooks-disagree.md).
Not reproduced.

## Note 2026-10-23 (after the live-refresh unification)

Reproduced twice on the `dup-sweep-frontend` worktree's test1 clone, before
and after `useBrowseListLiveRefresh` moved onto `useLiveRefresh` with
box-relative path comparison (plan
`beebox/docs/implemented-plans/frontend-unify-formatters-refresh-storage.md`, track 5). A
card written into `_content/projects/porch-rebuild/` while that directory
was open in Browse did not appear within about 12 s. A reload showed it.

The watcher's event path is box-relative with no prefix for the box root
(`core/box/file-watcher.ts:419-423`), which matches `dirPath`, so the path
comparison was not the cause. A second probe on an open card's body was
inconclusive (the card was not the open pane). The next check is whether
the `file-change` event reaches the browser at all: watch the
`events.subscribe` frames, or log in `useBusSubscription`'s `onData`.

## Direction 2026-10-23

The boxholder: "for seeing updates we might need an entirely new approach.
The fs watcher is problematic, and I think it might need a redesign." Treat
this bug as a symptom of the live-update mechanism, not a Browse defect; see
also [box-watcher-ceiling-leaves-attach-scopes-unwatched](2026-09-07-box-watcher-ceiling-leaves-attach-scopes-unwatched.md).
