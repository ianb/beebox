---
title: "Composer Add menu: 'Attach file…' vs 'Upload files…' are indistinguishable"
workstream: unknown
needs: [design]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder couldn't tell the two apart
---

The chat composer's Add menu (`InteractiveChat-composer.tsx:224,226`) has two
items whose labels read as synonyms — **"Attach file…"** and **"Upload files…"** —
but they do genuinely different things. A user cannot tell which to pick, and the
real axis (inline vs. batch, in-message vs. referenced-card) is invisible. The
boxholder's reaction: "it's clearly silly."

## What each actually does

- **Attach file…** → `handleAttachFiles` (`InteractiveChat-attachments.ts:258`)
  opens a file picker; the files become **inline attachments to the message you are
  composing** — a `[fileN]` token goes into the composer text and the file rides
  *with* that chat turn (images as inline base64/object-URL payload). For a **few**
  files you want the agent to see in context.
- **Upload files…** → `onUploadFiles` opens the full-screen **bulk-upload overlay**
  (`components/bulk-upload/BulkUploadOverlay.tsx`,
  `use-bulk-upload-launch.ts`; `docs/implemented-plans/chat-photo-batch-upload.md`
  Track 2). The files upload as a **batch** that becomes an `upload-batch` card plus
  a *reference* in chat — NOT inlined into the message — with the composer text
  carried as the batch's introduction. For **large sets**; disabled until there is a
  chat session.

## Why both exist

Inlining works for a handful of files but fails on a big selection (the earlier
70-photos failure). So inline-attach stayed for small in-context files and
bulk-upload was added as the scalable path — a too-large photo selection even
auto-routes from the first to the second (`photo-batch-threshold.ts`). The two are
real, they are just badly labelled.

## Job to be done

When the boxholder wants to give the box some files mid-chat, they want to pick the
right option without guessing — "a couple of files in this message" vs. "a big
batch to file away" — from the menu alone.

## Fix directions (needs design)

- **Clearer labels** that name the axis — e.g. "Attach to this message" vs. "Upload
  a batch" (or "Add a few files" vs. "Upload many files").
- **Merge into one** "Add files…" that auto-picks the path by count/size, reusing
  the existing threshold auto-route so the user never chooses at all.
- **One entry with an inline hint** describing when each applies.

This is part of the composer Add-menu surface the chat-menu IA review is already
looking at (`worktree-chat-menu-mobile-overflow`), so it may fold in there rather
than being fixed in isolation.
