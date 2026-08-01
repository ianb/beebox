---
title: "<upload> has no chat renderer — it shows as raw markup, not a chip"
area: callback-box
filed-by: agent
resolution: implemented
discovered-in: prod (estate box) — first real run of chat-photo-batch-upload
labels: [mobile]
---

**Closed 2026-08-01** — confirmed by the boxholder ("the `<upload...>` stuff
still shows up in the user message, unformatted") and fixed: `<upload>` now has a
parser (`components/chat/upload-message.ts`) and a chip
(`components/chat/UploadChip.tsx`), mirroring capture's, with the boxholder's
introduction rendered as their own words above the batch metadata. Pinned by
`test/frontend/upload-message.doctest.md` against the exact wrapper
`buildUploadWrapper` emits.

The item was originally filed with a wrong headline ("the user message doesn't
appear"), based on an in-the-moment report the boxholder later corrected. The
real defects from that first prod run were the missing `note` (fixed separately)
and this rendering gap.

---

First real-world run of the photo-batch path, on the `estate` prod box,
2026-07-31 ~23:50 UTC. **The pipeline worked**: seven photos uploaded, the batch
landed and committed (`6f34b5afaa`), delivered (`a829008df2`), and the chat agent
filed and annotated them into
`store/documents/property/powderhorn-garage/photos-2026-07-31.attach/`
(`50c1b4afb7`).

**Correction to this item's original framing.** It was filed as "the user message
doesn't appear in chat" based on an in-the-moment report; the boxholder then
confirmed they *do* see the message. The real defect from that run was the
missing `note`, which is fixed separately (the introduction is now read at
finalize rather than when the picker closes). What remains here is smaller and
was found by reading the code, not by observation — so treat it as unconfirmed
until someone looks at a delivered `<upload>` message in the UI.

## The remaining gap

`<capture>` has a renderer: `parseCaptureWrapper` + `CaptureChip`
(`components/chat/user-message.tsx`). `<upload>` has neither, and
`stripUserDisplayTags` (`components/chat/message-parsing.ts`) doesn't strip it.
So a delivered batch should render as literal
`<upload doc="…" files="7" bytes="31 MB">…</upload>` markup rather than as a
chip.

That matters more than it looks, because the composer text now rides *inside* the
`<upload>` body as the batch's introduction — so the boxholder's own words are
wrapped in markup in their own chat log.

Related: the raw-`<capture>`-markup rendering bug filed from
`worktree-fixup-capture` — likely the same fix shape, and worth doing together.

## What a fix looks like

Give `<upload>` a parser and chip mirroring capture's, with the note rendered as
the user's own text rather than as an attribute dump. Confirm first by looking at
a real delivered batch in the UI, since nobody has actually eyeballed one.
