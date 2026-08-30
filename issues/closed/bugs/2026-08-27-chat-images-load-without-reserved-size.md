---
title: "Chat images load without reserved dimensions, so late decodes still jank the scroll"
workstream: chat-image-dimensions
resolution: implemented
area: beebox
labels: [ui, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "we should figure out image size because there's still jank when they load"
---

Closed by `3e09d7d9e`. The implementation reserves the existing full-width
`70vh` chat presentation frame and letterboxes the decoded image, instead of
plumbing intrinsic dimensions through every upload and transcript path as the
issue originally sketched. This covers ordinary `size="chat"` images while
leaving intentionally small attachment thumbnails unchanged.

The scroll model *compensates* for image loads (anchor deltas in
`chat-scroll.ts`; `waitForImages` in the open-thread hold) but compensation is
after-the-fact: the reflow happens, then the view is corrected — visible jank.
The fix the platform offers is to never reflow: render `<img>` with
`width`/`height` (or `aspect-ratio`) so layout reserves the box before a byte
arrives.

That needs the dimensions to exist somewhere the renderer can see:

- At upload/ingest, probe and store dimensions (manifest, card frontmatter, or
  a sidecar the file API serves) — new metadata, needs a place.
- Or serve them per-request (image endpoint returns dimensions in headers the
  client can't use for layout — insufficient alone).
- Markdown-rendered images (`![…]`) need the renderer to look dimensions up by
  src; the `<Image>` component (`src/frontend/src/components/ui/Image.tsx`) is
  the chokepoint for attachment renders.

Related: the scroll model's compensation stays — dimensions can't cover every
embed (external images, cards) — but chat-local images are the common case and
can stop moving at all. The live `chat-scroll` workstream owns the
compensation half; the dimensions half touches upload/manifest and is separable.
