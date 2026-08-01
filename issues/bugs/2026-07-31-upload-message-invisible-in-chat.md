---
title: "A delivered <upload> message doesn't appear in the chat log (agent sees it, user doesn't)"
area: callback-box
filed-by: agent
discovered-in: prod (estate box) — first real run of chat-photo-batch-upload
labels: [mobile]
---

First real-world run of the photo-batch path, on the `estate` prod box,
2026-07-31 ~23:50 UTC. **The pipeline worked**: seven photos uploaded, the batch
landed and committed (`6f34b5afaa`), delivered (`a829008df2`), and the chat agent
filed and annotated them into
`store/documents/property/powderhorn-garage/photos-2026-07-31.attach/`
(`50c1b4afb7`).

**But the boxholder never saw a user message for it.** The agent replied about
the photos; the transcript shows no corresponding user entry. From the
boxholder's side the assistant answered a message that isn't there.

This is worse than cosmetic now that the composer text rides along as the
batch's `note`: the boxholder's own words go INTO the `<upload>` body, so an
unrendered `<upload>` means their message disappears from their own chat log.

## Two candidate causes — neither confirmed

**1. Busy-path delivery may not write a transcript entry.** The timing fits: a
text send at 23:51:02 started a run that ran until 23:55:52, so the batch
finalized *while the session was busy*. Busy delivery is an in-memory enqueue
(`core/chat/session/deliver-user-message.ts`, noted in
`docs/implemented-plans/bulk-file-upload.md` §3). If the enqueue feeds the SDK
without writing the user entry the UI renders, the symptom is exactly this. Not
verified — I could not locate the chat transcript file on the server to check;
`<upload ` appears in `.callback-box/events.db-wal` but nowhere else in the box.

**2. `<upload>` has no frontend renderer.** `<capture>` has `parseCaptureWrapper`
+ `CaptureChip` (`components/chat/user-message.tsx`); `<upload>` has neither, and
`stripUserDisplayTags` (`components/chat/message-parsing.ts`) doesn't strip it.
So it should fall through and render as *raw markup* — visible, not absent. That
means (2) alone does NOT explain this report, but it is a real gap that will bite
the moment (1) is fixed: the message would then appear as
`<upload doc="…" files="7" …>` instead of a chip. Related:
the raw-`<capture>`-markup rendering bug filed from `worktree-fixup-capture`.

## Next step

Reproduce locally rather than diagnosing further on prod: send a message that
starts a long run, finalize a bulk batch while it's still going, and check
whether the `<upload>` user entry reaches the transcript. That distinguishes (1)
from (2) directly. Then give `<upload>` a renderer either way — a chip like
capture's, with the note shown as the user's own text.
