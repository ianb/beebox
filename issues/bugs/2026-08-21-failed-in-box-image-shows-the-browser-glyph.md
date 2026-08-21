---
title: "An in-box image that 404s shows the browser's broken-image glyph, not the app's placeholder"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — checking the "a broken image says so" user story on /browse
---

An in-box image URL that 404s renders the browser's native broken-image glyph.
The app's labelled placeholder never appears: the DOM has no element with
`role="img"` / `aria-label` "Failed to load", the page text contains no "Failed
to load", `naturalWidth` is 0, and the `<img>` keeps the dead `src` across a
reload.

Repro used: `/browse/box/inbox/scan-20260429T0246-6c66f791.attach/attach/photo-001.jpg`
in the test1 clone (a path `/api/files` answers with 404).

**The cause was not located.** The placeholder exists and the path to it looks
intact: `Image`'s `onError` records the failed URL and re-renders to
`ErrorPlaceholder`
(`callback-box/src/frontend/src/components/ui/Image.tsx:99-120`, `:293-300`,
`:325`), and the raw-image renderer for a plain `.jpg` goes through that same
component (`callback-box/src/frontend/src/renderers/image.tsx:184-197`). Whatever
rendered the observed `<img>` either is not that component or did not reach the
error branch. One bare `<img>` with no error handling does exist, in the file-list
thumbnail (`callback-box/src/frontend/src/components/file-entries/ImageCardListEntry.tsx:27`),
but the observation was of the detail pane.

Reproducing it against a live server and identifying which element renders the
dead `src` is the first step.
