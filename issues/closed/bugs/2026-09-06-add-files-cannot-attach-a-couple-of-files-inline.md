---
title: "\"Add files…\" sends every non-image file to the bulk-upload process — you can no longer attach a couple of files to a message"
workstream: add-files-inline
area: beebox
priority: important
labels: [chat, composer, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "Add files now just goes to a big dedicated upload process, and doesn't let me attach a couple files"
resolution: implemented
---

Closed: fixed in `af42d07ec` (`worktree-add-files-inline`). `routeAddedFiles`
now returns a split — a representation, not a destination: photos inline
while the composer's total stays within `INLINE_PHOTO_LIMIT`, everything else
uploads and is referenced with a `[file#N]` token, and both halves land in the
same message. No file-count limit and no byte ceiling were added — the
developer specified that directly, superseding this issue's proposal of a
size- and count-aware rule (3 files / 25MB): an inline file is a path token,
not bytes in the send, so there is nothing to cap. The web bulk-upload
overlay was deleted as unreachable; the bulk backend and the native iOS
composer are unchanged.

Picking one or two files (a PDF, a document) from the composer's "Add files…"
opens the full-screen bulk-upload overlay instead of attaching them to the
message being written. The boxholder: "We need to fix that. This is
something of a regression from when the two upload options were created."

Where it comes from: when the twin menu entries ("Attach file…" and "Upload
files…") were merged into one "Add files…" routed in code
(`issues/closed/features/2026-08-03-attach-vs-upload-menu-confusing.md`,
`5336b291`), the rule in `components/chat/file-routing.ts` became:

```ts
if (files.some((file) => !file.type.startsWith("image/"))) return "batch";
return existingInline + files.length > INLINE_PHOTO_LIMIT ? "batch" : "inline";
```

So only images can ride inline, and at most `INLINE_PHOTO_LIMIT` (3) of them;
any non-image file batches regardless of count. The file's own comment argues
"a document is something to file rather than something for the model to look
at mid-sentence" — but the inline file attachment path still exists
(`[file#N]` tokens, `ChatAttachments.tsx`, `message-parsing.ts`), and the
old "Attach file…" entry used it for exactly this: a couple of files the
agent should see with the message. The merge kept the inline path for photos
and dropped it for everything else.

The photo threshold exists for a real reason (tens of megabytes of base64
in one send failed on iOS; `2026-07-30-many-photos-to-chat-fails-ios.md`),
and the same size concern applies to a big PDF. So the fix is a size- and
count-aware rule, not a revert: a few small non-image files ride inline like
a few photos do; many files, or a large one, batch. The limit is a product
judgment for the boxholder to confirm (count, and a per-file or total byte
ceiling). `docs/mobile-contract.md` carries the shared statement of the rule
and the iOS composer duplicates it — change all three together
(`bbx-ios-overlap`).

Reproduce: chat → Add files… → pick one PDF. Expected: a `[file#1]` token in
the composer and the file sent with the message. Actual: the bulk-upload
overlay.
