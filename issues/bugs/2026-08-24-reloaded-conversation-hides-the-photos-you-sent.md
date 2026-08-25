---
title: "A reloaded conversation shows [image not displayed] where your photos were"
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

What remains is whether the original should be recoverable at all — the box
has the photograph, since it was uploaded; only the inline copy in the session
log was stripped. If the two can be reconnected, the placeholder could show the
stored image instead of standing in for it — which would make this disappear
rather than merely read better.

Related: [implementation-vocab-leaks-into-ui](2026-08-08-implementation-vocab-leaks-into-ui.md).
