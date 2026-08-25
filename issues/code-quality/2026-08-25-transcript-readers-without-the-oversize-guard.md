---
title: "Four transcript readers parse multi-MB lines with no oversize guard"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-live-vs-stored — spun out when strip-multi-mb-payloads closed wontfix
labels: [code-error]
---

The 2026-08 OOM fix put a per-line byte bound on `parseSessionLog`
(`src/cli/lib/session-oversize.ts`): a line past `MAX_SESSION_LINE_BYTES` has its
base64 payloads stripped before parsing, or becomes a stub. That guard was
applied to one reader. Four others walk the same transcripts and `JSON.parse`
every line whole, at whatever size it happens to be:

- `getSessionMetadata` — `src/cli/lib/session.ts:196`
- `readFirstUserSnippet` — `src/cli/lib/session-snippet.ts:74`
- `src/core/chat/session/backfill.ts:22`
- `src/core/chat/session/deliver-user-message.ts:95`

A box with heavy image use has lines of ~1.3 MB, and the parse builds an object
graph several times the line. None of these is on the web hot path — the worst
is chat review, a scheduled job, and `session-label` memoizes on `(path, mtime)`
— so this is not the acute shape that took prod down (per-request parse ×
client concurrency). It is the same fuel sitting behind slower readers.

## Why this is separate from its parent

[strip-multi-mb-payloads-from-transcript-entries](../closed/code-quality/2026-08-05-strip-multi-mb-payloads-from-transcript-entries.md)
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
