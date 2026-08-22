---
title: "Composer Add menu: 'Attach file…' vs 'Upload files…' are indistinguishable"
workstream: add-files-menu
needs: [design]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder couldn't tell the two apart
priority: important
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
auto-routes from the first to the second (now `file-routing.ts`). The two are
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

## Resolution (2026-08-22)

Merged into one menu entry: **"Add files…"**, never disabled. Code decides where
a file set goes, in one place —
`src/frontend/src/components/chat/file-routing.ts` · `routeAddedFiles`:

- any file in the set is **not an image** → the whole set goes to the bulk-upload
  batch (a document has no in-message representation, and a split selection would
  leave half of it undescribed by the composer text);
- else the composer's existing inline photos **plus** the incoming ones fit under
  `INLINE_PHOTO_LIMIT` → inline as `[imageN]` attachments;
- else → batch.

The same rule now applies to every entry point: the picker, paste, drop, and the
screenshot grab. Paste and drop used to filter to images and silently ignore
other files; they no longer do. `INLINE_PHOTO_LIMIT` dropped 4 → 3
(`docs/mobile-contract.md` §8 and the iOS mirror updated with it).

Two follow-on effects:

- The old inline `[fileN]` path (`/chat/upload-file` from the web composer) is no
  longer reachable and its frontend code is gone. The route and the wire format
  stay — the native iOS composer still uses both.
- When the batch path is needed but the chat has no session id yet (a Codex box,
  before the first message), the files used to vanish: the overlay simply didn't
  render. It now raises "Send a message first, then add files" instead.
