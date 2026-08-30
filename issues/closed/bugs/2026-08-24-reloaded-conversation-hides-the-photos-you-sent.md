---
title: "A reloaded conversation shows [image not displayed] where your photos were"
workstream: live-vs-stored
area: beebox
labels: [journey-findings]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey B, 2026-08-24 walk
resolution: implemented
---

Closed 2026-08-25 by commit `a6517d3c` (workstream `live-vs-stored`) — see the
"Fixed" section below for the mechanism.

A walker sent two photographs into chat, and the agent read them correctly and
catalogued twenty items from them. In the transcript, both photographs render
as `[image unavailable]`. So do the Landmark titles derived from that turn.

This is the *replayed* view: the images are there while the conversation is
live, and the placeholder appears once the stored session is read back. So the
photograph is not lost — what is lost is the inline copy in the session log,
and with it the user's ability to see what they sent.

The placeholder is `session-content.ts:91`, returned when an image block has a
`base64` source with no `data`. The data is removed upstream by
`stripInlineMedia` (`session-oversize.ts`), which strips inline media from
session logs that grow too large — two 500KB photos in one session will do it.

So this is a designed trade-off surfacing with no explanation. The stripping
protects the session log; the cost lands on the user as a permanent hole in
their history, labelled with a phrase that does not say what happened or
whether anything can be done.

The wording is fixed: it now reads `[image not displayed]` rather than
`[image unavailable]`, which described a fault to someone whose images were
fine when they sent them. That is a smaller claim and a true one.

## Fixed (2026-08-25) — the placeholder became the photograph

The filing's guess about *where* the photo survives was wrong in a way that made
the fix easier, not harder. The box does **not** hold a copy: a composer photo
goes straight into the SDK's transcript line as base64 and is stored nowhere
else. But `stripInlineMedia` runs at **read** time — it removes the payload from
the line the scan is holding, and never touches the file. The bytes were still
on disk the whole time.

So the reader now emits the photo's coordinates instead of a placeholder —
`<sessionId>/<entryUuid>/<index>` (`src/shared/session-media.ts`) — and
`GET /api/session-media/<ref>` reads that one line back out and serves that one
image (`src/webapp/routes/api-session-media.ts`). The history path still carries
no image bytes, so the OOM this trade-off was protecting against stays fixed.

Per the boxholder: the image loads **on demand**. The block renders as a lazy
`<img>`, so an old photo further back in the scrollback is fetched only when it
is scrolled to, and never at all otherwise.

One deliberate behavior change came with it: a user turn whose *only* content is
an image is now dropped from history, as a normally-sized one always was. Such a
turn used to survive by accident, because stripping left a text placeholder and
the plumbing filter looks for text. Nothing a person sends is affected — chat
wraps every message in `<typed>`/`<speech>` before it reaches the log, so a real
photo turn carries text with or without a caption.

Still a placeholder, correctly: an image block whose bytes never arrived (a
failed upload). Nothing was stripped from that line, so there is nothing to
point at, and it still reads `[image not displayed]`.

Related: [implementation-vocab-leaks-into-ui](../../bugs/2026-08-08-implementation-vocab-leaks-into-ui.md).
