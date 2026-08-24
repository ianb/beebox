---
title: "Photos you sent become [image unavailable] in your own transcript, permanently"
workstream: unattached
area: callback-box
labels: [journey-findings]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey B, 2026-08-24 walk
---

A walker sent two photographs into chat, and the agent read them correctly and
catalogued twenty items from them. In the transcript, both photographs render
as `[image unavailable]`. So do the Landmark titles derived from that turn.

It does not heal on reload. The images are gone from the user's view of their
own conversation while the work done from them remains.

The placeholder is `session-content.ts:91`, returned when an image block has a
`base64` source with no `data`. The data is removed upstream by
`stripInlineMedia` (`session-oversize.ts`), which strips inline media from
session logs that grow too large — two 500KB photos in one session will do it.

So this is a designed trade-off surfacing with no explanation. The stripping
protects the session log; the cost lands on the user as a permanent hole in
their history, labelled with a phrase that does not say what happened or
whether anything can be done.

At minimum the placeholder should say that the image was removed to keep the
conversation loadable, rather than "unavailable", which reads as a fault. The
larger question is whether the original should be recoverable at all — the box
has the photograph, since it was uploaded; only the inline copy in the session
log was stripped. If the two can be reconnected, the placeholder could link to
the stored image instead of standing in for it.

Related: [implementation-vocab-leaks-into-ui](2026-08-08-implementation-vocab-leaks-into-ui.md).
