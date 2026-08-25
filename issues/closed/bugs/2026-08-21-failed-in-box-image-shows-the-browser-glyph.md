---
title: "An in-box image that 404s shows the browser's broken-image glyph, not the app's placeholder"
workstream: unattached
area: callback-box
labels: [user-stories-audit]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — checking the "a broken image says so" user story on /browse
resolution: implemented
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

## Updating the user-story catalog

This issue is why [`browse/images-still-show-when-the-source-blocks`](../../../callback-box/user-stories/catalog/2026-08-21.md#flagged-worth-a-human-glance) is currently
flagged ❌ in [the user-story catalog](../../../callback-box/user-stories/catalog/2026-08-21.md) — a catalogue of what callback-box can
actually do, where every claim is checked against the source.

**When you fix this, re-check that story so the catalog stops being wrong.** It is a
short agent run over just the affected stories, not the full regeneration:

```
Workflow({scriptPath: "callback-box/user-stories/pipeline/recheck.workflow.mjs",
          args: {root: "<repo root>", date: "2026-08-21",
                 ids: ["browse/images-still-show-when-the-source-blocks"]}})

pnpm exec tsx callback-box/user-stories/pipeline/apply-recheck.ts 2026-08-21
pnpm exec tsx callback-box/user-stories/pipeline/render.ts \
  > callback-box/user-stories/catalog/2026-08-21.md
```

The recheck is adversarial by design: it will not mark the story accurate just because
this issue was closed — it re-reads the code. If it still refutes, that is worth knowing
before you call the fix done. Details in
[the pipeline README](../../../callback-box/user-stories/README.md).

Catalogued as `browse/images-still-show-when-the-source-blocks` in the [user-story catalog](../../../callback-box/user-stories/catalog/2026-08-21.md).
