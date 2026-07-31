---
title: "Browse sidebar live-refresh did not fire for a file added to the open directory"
area: callback-box
filed-by: agent
discovered-in: worktree-browse-back-url — first real-browser verification after the browse-key auth work
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
[browse-back-button-url-not-updated](2026-07-22-browse-back-button-url-not-updated.md)
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
  external write (as opposed to one written through `cb`).
- The event fired but `parent !== dirPath` — e.g. a path-shape mismatch between
  the event's `path` and the browse `dirPath`.

Reproduce with the isolated-router setup in
`callback-box/docs/plans/agent-token-browser-auth.md` — that is now the only way
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
