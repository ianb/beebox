---
title: "\"Open as full page\" on a file row drops the base path and 404s in dev"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — opening a Recent-files card preview in a new tab from chat
---

The "Open as full page (new tab)" link on a file row points at
`/test1/browse/<path>` with no `/<worktree>/` prefix, so under the dev router it
opens a 404.

`FileEntry` builds the anchor's `href` with `href()`
(`callback-box/src/frontend/src/components/ui/FileEntry.tsx:113`):

```ts
const pageHref = boxSlug ? href(`/${boxSlug}/browse/${summary.path}`) : undefined;
```

`href()` is an identity function whose only job is to satisfy TanStack Router's
`to` typing (`callback-box/src/frontend/src/lib/routing.ts:12-14`). The router
prepends `basepath` for a `to`; a plain `<a href>` gets nothing. The same link
built for the same purpose elsewhere uses `withBase`
(`callback-box/src/frontend/src/components/FileView.tsx:275`), which is the
helper for hardcoded paths
(`callback-box/src/frontend/src/api-core.ts:38-47`).

In production `BASE_URL` is `/` and the two spellings agree, so this shows up
only in dev — where it breaks the new-tab affordance on every file row.
