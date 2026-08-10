---
title: "Delivered capture renders as raw <capture> markup when the message was queued"
workstream: fixup-capture
area: callback-box
filed-by: agent
discovered-in: worktree-fixup-capture — boxholder reported it while reporting the capture upload failures
resolution: implemented
---

**Closed 2026-08-06** — resolved by `ab43e787`. Delivered capture and upload
wrappers now share a closed codec, and the transcript renderer parses them as
ordered parts alongside queue-combined prose. The implementation also strips
the persisted `<chat-app>` snapshot before recognition, which proved to be an
additional ordinary trigger beyond the originally suspected multi-message
queue shape.

The boxholder's delivered capture showed the raw `<capture doc="…" images="…">`
tag text in the chat transcript instead of the compact chip.

The chip renderer exists and is wired (`user-message.tsx:149` →
`parseCaptureWrapper`), so this is a parse miss, not a missing feature.
`parseCaptureWrapper` deliberately requires the wrapper to be the **entire**
trimmed message — a message with prose around it is ordinary text that happens
to mention `<capture>`, and rendering it as a chip would swallow that text
(`capture-message.ts`, the `match[0] !== trimmed` guard).

The likely trigger: a capture delivered while the agent is mid-turn is
**enqueued**, and `ChatSession.drainQueue` combines the queued inputs into a
single turn with **text joined by blank lines**
(`core/chat/session/index.ts:296-307`, `combineQueuedInputs`). The wrapper is
then no longer the whole message, the parse returns null, and the raw markup
renders. A single queued message still parses (nothing to join it with), so this
needs two or more messages combined — which is exactly what happens when a
capture lands during a busy turn, as the boxholder's did.

Not confirmed against the actual transcript: prod chat sessions live in the
server's Claude Code session store, not the box, and the specific transcript
wasn't located. Worth confirming before fixing.

Fix directions, roughly in order of preference:

1. Have the chip renderer find a `<capture>` block *within* a message and render
   the chip alongside the surrounding text, rather than all-or-nothing. This
   also covers a user typing something in the same turn.
2. Exempt structured wrappers (`<capture>`, `<upload>`) from queue-combining, so
   a delivered capture always arrives as its own turn.

(1) is more general; (2) is narrower but preserves the "one delivery, one
message" property that the wrapper vocabulary assumes elsewhere.

Out of scope for the upload/Done-gating work in `worktree-fixup-capture` — the
boxholder scoped that to the transport and the Done button.
