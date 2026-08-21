---
title: "The card page 404s on an .attach directory because directory detection reads the extension"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — walking card and directory URLs to check the browse user stories
---

`/<box>/card/box/inbox/scan-20260429T0322-dbe99514.attach` renders
"Error loading … Failed to load: 404 Not Found". The same directory lists
normally under `/<box>/browse/…`, and `/<box>/card/box/inbox` (a directory with
no dot in its name) renders the directory renderer.

`FileView` decides whether a path is a directory by looking at its extension:

```ts
function isDirectoryPath(path: string): boolean {
  return pathExt(path) === "";
}
```

(`callback-box/src/frontend/src/components/FileView.tsx:109`, with `pathExt` in
`callback-box/src/frontend/src/lib/binary-files.ts`.) An `.attach` directory has
a non-empty extension, so it is classified as a file, and the shell fetches its
body as text from `/api/files/<dir>` — which 404s.

Every attachment directory in a box has this shape, so any card-page link or
pasted URL that names one lands on the error instead of the directory listing.
