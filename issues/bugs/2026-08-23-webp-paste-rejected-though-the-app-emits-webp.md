---
title: "A pasted WebP was rejected, though the app's own encoder prefers WebP"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey B, from assets an agent had wrongly converted to WebP
priority: normal
---

Two WebP images pasted into the chat composer were rejected. The composer
reported that the files could not be added, and the console recorded
`ImageProcessingError`. The same two photos re-saved as JPEG attached
immediately.

**The cause is not established.** The debug log dropped the error's `message`
(see `describeArg`, fixed in `ab5f483e`), so the only surviving evidence is the
class name. Every statement below about *why* is a suspicion, not a finding.

What makes it worth a look is an apparent asymmetry:

- `lib/canvas-encode.ts` sets `PREFERRED_TYPES = ["image/webp"]` and prefers
  WebP for every re-encoded photo, because it is the smallest format the
  Anthropic Messages API accepts.
- So the app *produces* WebP attachments on the same path that appears to
  refuse a WebP a user brings in.

If that holds, a user who saved an image the app itself generated could not
paste it back.

Browsers that can encode WebP can also decode it, so a plain decode failure in
`processImageBlob` is not the obvious explanation — which is the reason to
reproduce rather than assume.

## How this was found, and its limits

Not a user-reported problem. An agent preparing journey B converted the walk's
source photographs to WebP; the boxholder had asked for ordinary JPEGs. The
walk then spent much of its length on the failure, and the walker's conclusion
("maybe this thing only takes JPEGs") is a first-time user's guess, not a
diagnosis. The journey assets are JPEG again.

Exercising exotic image formats is explicitly **not** what the journey process
is for, so this is filed as noticed, not as scheduled work.

Reproducing it is now cheap: paste a WebP into the composer and read the debug
log, which since `ab5f483e` carries the reason.

Related: [implementation-vocab-leaks-into-ui](2026-08-08-implementation-vocab-leaks-into-ui.md)
— the message the user saw named neither the format nor the reason; that half
is fixed in `8cecbe33`.
