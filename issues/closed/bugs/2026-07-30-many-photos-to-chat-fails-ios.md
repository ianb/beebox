---
title: "Submitting many photos to chat fails (iOS); route >N through upload+references"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder hit it on a prod box
resolution: implemented
design: ../../../callback-box/docs/plans/chat-photo-batch-upload.md
labels: [mobile]
---

**Closed (implemented + boxholder-confirmed) 2026-07-31.** The
`chat-photo-batch-upload` work landed on main (plan `80f2d0e2`, plus the
bulk-upload robustness/silent-loss fixes in `189639a3` and `ea408a04`): above 4
photos, both composers now upload the selection as a bounded-concurrency bulk
batch instead of base64-inlining it, with the composer text carried as the
batch's `note` so the agent files against it. Boxholder confirms the core failure
is fixed on-device (70+ photos submit and land). Minor tweaks are still in
progress on the worktree, but the reported bug is resolved. Reopen only if
large-batch submits fail again.

**Fix implemented on worktree `chat-photo-batch-upload`** (design:
[chat-photo-batch-upload](../../../callback-box/docs/plans/chat-photo-batch-upload.md)).
Above 4 photos, both composers now upload the selection as a bulk batch instead
of base64-inlining it, and the composer text rides along as the batch's `note`
so the agent files against it rather than asking what the files are.

**`needs: manual-testing` — this cannot be closed on green tests.** The two
failures it fixes (WKWebView memory pressure carrying a huge script message, and
iOS photo import at camera-roll scale) are exactly what a simulator and a
headless browser cannot reproduce. On a real device: select 70+ camera-roll
photos in the iOS app, type a sentence saying what they are, submit. Expected —
a live "Uploading photos — N of M" line in the composer, then one `<upload>`
message in chat carrying your sentence above the summary, an `upload-batch` card
listing 70 received and 0 missing, and an agent that files them against what you
typed instead of asking what they are. Watch for: photos silently dropped
(count < 70), the composer text lost, or a stall with no progress line.

Boxholder selected **70+ photos** from the camera roll and submitted them to a
box's chat **in the iOS app**; it failed. Reproduced from logs, and it validates
the boxholder's own read: many photos should not go inline in a chat message —
above a small threshold they should be **uploaded and referenced** (like capture
does), not base64-inlined into `/chat/send`.

## Evidence (box `client-debug.log`)

- `2026-07-30T19:20:39Z [error] [chat] send failed: Chat send failed` — the 70-photo
  submit.
- **No server-side error** (hub journal + box log both clean for that submit) →
  the request **never reached the server**. Base64-inlining ~70 images into one
  `/chat/send` payload is too large to send; iOS aborts (or the edge rejects) it
  before the box processes it.
- Prior day, same box: `[chat] send rejected … no outcome reported (timeout)`.

## The other half: capture already references, but also struggles at scale

The **capture** path already does the desired shape — upload each photo, drop a
reference — but it too failed under a big batch:
`2026-07-29T15:39Z [error] [capture] Photo upload failed (photo-003.jpg): Upload
failed (network error after 4 attempts): Fetch is aborted` (≈12 photos aborted
after retries). So "just route many photos through the capture-style flow" is the
right direction **but not sufficient on its own** — the uploader aborts under a
large concurrent batch on iOS.

## Proposed behavior (boxholder)

- Below a small threshold (**>3?**), keep today's inline-in-chat attach.
- Above it, **upload the photos and put references in the chat** — the chat then
  gets a message that N files landed somewhere, and the agent files them (same
  model as [capture] and the bulk-upload work).
- Make the batch upload **robust at scale**: bounded concurrency, sequential or
  resumable, don't fire 70 concurrent fetches an iOS webview will abort.

## Relationship to other work

This is the concrete, real-world driver for the **bulk-file-upload** feature
(worktree `bulk-file-upload`, Fable session) — feed this failure + the iOS
specifics + the "capture aborts at scale" finding into that design. Also relevant
to the mobile contract (`docs/mobile-contract.md`) and the iOS composer
attachment path.

## To verify a fix (needs mobile)

Select 70+ camera-roll photos in the iOS app → submit → they upload with a
progress affordance, the chat gets a "N photos uploaded" message with references,
and none are dropped. Confirm on a real device (payload size + webview fetch
abort behavior can't be emulated headlessly).
