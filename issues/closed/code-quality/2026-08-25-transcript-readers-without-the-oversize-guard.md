---
title: "Four transcript readers parse multi-MB lines with no oversize guard"
workstream: live-vs-stored
resolution: implemented
area: callback-box
filed-by: agent
discovered-in: worktree-live-vs-stored — spun out when strip-multi-mb-payloads closed wontfix
labels: [code-error]
---

> **Fixed 2026-08-25.** The guard moved into a shared reader,
> `src/cli/lib/session-lines.ts`, which every transcript scan now goes through —
> so a reader takes the bound by construction rather than by remembering to.
> It hands back either a `parseable` line (the line, or the line with its media
> payloads removed, flagged) or an `oversize` one for the caller to decide
> about. `parseSessionLog` still makes its placeholder stub; the other readers
> skip. Covered by `test/cli/lib/session-lines.doctest.md`.
>
> **This issue named four readers. Only three were real** — checked before
> fixing rather than trusted. `deliver-user-message.ts:95` does NOT parse: it
> runs `line.includes(docPath)`, a substring match, and carries a comment
> explaining that it streams precisely to avoid the allocation class this issue
> is about. It was already correct and is left alone. The three that did parse
> — `getSessionMetadata`, `readFirstUserSnippet`, and `backfill`'s
> `logHasWebChatMarkers` — are converted.
>
> One accepted degradation, in the same spirit as the ones `session-oversize.ts`
> already documents: `getSessionMetadata` no longer counts a turn whose line is
> still past the bound with its images gone, so an enormous *text* turn goes
> uncounted. The common fat line is image-bearing and strips down to an ordinary
> parse, so this is rare; counting it without parsing it would mean sniffing the
> head, which is more machinery than the undercount is worth.

The 2026-08 OOM fix put a per-line byte bound on `parseSessionLog`
(`src/cli/lib/session-oversize.ts`): a line past `MAX_SESSION_LINE_BYTES` has its
base64 payloads stripped before parsing, or becomes a stub. That guard was
applied to one reader. Four others walk the same transcripts and `JSON.parse`
every line whole, at whatever size it happens to be:

- `getSessionMetadata` — `src/cli/lib/session.ts:196`
- `readFirstUserSnippet` — `src/cli/lib/session-snippet.ts:74`
- `src/core/chat/session/backfill.ts:22`
- ~~`src/core/chat/session/deliver-user-message.ts:95`~~ — **not actually a
  parser.** It does a substring match, never `JSON.parse`. Listed here in error
  when this was filed; see the closing note.

A box with heavy image use has lines of ~1.3 MB, and the parse builds an object
graph several times the line. None of these is on the web hot path — the worst
is chat review, a scheduled job, and `session-label` memoizes on `(path, mtime)`
— so this is not the acute shape that took prod down (per-request parse ×
client concurrency). It is the same fuel sitting behind slower readers.

## Why this is separate from its parent

[strip-multi-mb-payloads-from-transcript-entries](2026-08-05-strip-multi-mb-payloads-from-transcript-entries.md)
was closed **wontfix** because the transcript belongs to Claude Code and we have
no write hook to bound the line at its source. This is the part that was never
about the transcript: it is about our own read code, and it is entirely ours to
fix.

## Direction

The bound belongs in a shared reader rather than in `parseSessionLog` alone.
`src/cli/lib/session-line-scan.ts` already reads a transcript at the byte level
without materializing lines it does not want — that is the shape to generalize.
A chunked line assembler that elides base64 runs *while* reading would go
further than the current guard does anywhere: `readline` materializes the whole
1.3 MB string before `stripInlineMedia` can drop anything from it, which the
guard's own docstring names as what it does not bound.
