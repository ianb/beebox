---
title: "An uploaded chat image is visible but unusable: the agent sees the pixels and has no file"
workstream: unattached
area: beebox
priority: important
labels: [chat, images]
filed-by: agent
discovered-by: Ian
discovered-in: main — the boxholder wants images to be both seen and usable
---

Images uploaded into chat arrive base64-inline, so the agent sees them with no
tool call at all — which is the good half. The bad half is that there is no
file: nothing to move, crop, OCR, annotate, attach to a card, or hand to an
API. The image is visible and untouchable at the same time.

## What exists

- Chat image blocks are `{ type: "image", source: { type: "base64" | "url",
  media_type, data } }` (`core/chat/message-types.ts:22-33`). Nothing writes
  them to disk.
- `.beebox/image-cache/v1` is **not** related — it is a resize/transform cache
  for serving box images (`webapp/image-transform-cache.ts:87`).
- The audio precedent the boxholder named is `bbx chat get-last-audio` /
  `ask-about-audio` / `retranscribe` (`cli/commands/chat-audio.ts`). Note what
  it actually does: it fetches the recording **from the connected browser tab**
  over the event bus, with a `--timeout` defaulting to 10 s of waiting "for a
  browser tab to answer". The bytes live in the browser's cache, not in the
  box.

That last detail matters for the proposal: a fetch-from-the-tab command works
for a boxholder sitting in front of a chat, and does not work for a wakeup, a
schedule, or any run where no tab is open.

## Prior art: this is a known, named problem

Claude Code has the identical bug, filed as
[anthropics/claude-code#57623](https://github.com/anthropics/claude-code/issues/57623):
*"Pasted/dropped images no longer expose a filesystem path — Claude can only
'see' them, can't Read/Edit/upload."* Two things there are worth more than the
report itself:

- **It is a regression.** Earlier versions persisted the image to a
  session-scoped temp directory and exposed its path in the message context,
  so `Read`, PIL/OpenCV/ImageMagick, and `curl -F image=@<path>` all worked.
  Someone built the obvious answer, then lost it — so "persist on arrival" has
  been shipped and is known to work.
- **The trap to avoid:** in the broken state the `Read` tool returns only a
  *downscaled thumbnail* (402×342 in the report), not the original. Any design
  here must hand back the original bytes, or it will look like it works and
  quietly degrade every image that passes through it.

The workaround users are left with — save it yourself, then paste the path — is
exactly the friction this should remove.

## Directions

**A. Persist on arrival.** Write the upload somewhere on the box as it lands
and carry the path alongside the inline image. Zero extra calls to *see*, and
the file is already there to *use*. Costs: a location (`_tmp`? an attach
scope?), a lifetime and a sweep, and a decision about whether these enter Git.

**B. Fetch on demand,** the boxholder's proposal — a sibling of the audio
commands, probably grouped with them. Familiar shape, nothing stored until
asked. Costs: an extra round trip, and the tab dependency above unless the
bytes are persisted server-side anyway, which collapses it into A.

**C. Make it a card immediately.** An upload becomes an `.image.card` plus its
attach scope, and chat carries both the pixels and the ref. Most native to a
box where everything is a card, and it makes the image durable, linkable and
tracked. Costs: every throwaway screenshot becomes box content.

## The question under all three

**Is a pasted image conversational ephemera or box content?** A screenshot
pasted to ask "why does this look wrong" is the former; a photo of a receipt is
the latter, and the boxholder cannot be asked to declare which at paste time
without ruining the gesture. A design that treats them alike will either
litter the box or keep losing files people wanted.

Worth deciding before picking A, B or C — the answer probably selects one.

## Research (incomplete)

The Claude Code issue and its pre-regression behaviour are summarized above.
Not yet examined: how the image actually reaches a chat message today (the
upload path, and whether the bytes ever touch the server), what the iOS/native
composer does with attachments, and whether the `url` source variant is used
anywhere — it may already point at something fetchable.
