---
title: "Keep multi-MB payloads out of transcript entries the history path serves (strip/sidecar at write or render)"
workstream: live-vs-stored
resolution: wontfix
area: beebox
filed-by: agent
discovered-in: main session — direction 4 spun out of the closed chat.history parse-OOM bug
---

> **Closed wontfix, 2026-08-25 (boxholder).** The transcript is not ours. It
> belongs to Claude Code: the agent subprocess writes
> `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, and this codebase only
> ever reads it (`core/chat/session/transcript-sync.ts` waits on the SDK's flush
> rather than performing it). There is no write hook to strip or sidecar at, and
> the SDK's `sessionStore` option is a secondary mirror that fires *after* the
> local write, so it cannot bound the local line either. Rewriting the file
> behind the SDK would race its own resume reads.
>
> The reachable half was done and is on main: a stripped image is now
> addressable and fetched per image, so the history read carries no image bytes
> — see
> [reloaded-conversation-hides-the-photos-you-sent](../bugs/2026-08-24-reloaded-conversation-hides-the-photos-you-sent.md).
> The one residual that IS ours — our own readers, not the transcript — is spun
> out as
> [transcript-readers-without-the-oversize-guard](2026-08-25-transcript-readers-without-the-oversize-guard.md).

Follow-up hardening from
[chat-history-parse-transient-oom](../bugs/2026-08-04-chat-history-parse-transient-oom.md),
whose acute OOM (per-request transient parse cost × client concurrency) is fixed
and prod-verified (directions 1–3: read coalescing, an oversize-line parse bound,
and client refetch backoff/dedupe). This is its **direction 4**, deliberately left
open as the longer-term structural fix.

## The residual

The acute crash is gone, but the root shape remains: a box with heavy image/capture
use accumulates **multi-MB lines in its active session transcript** (measured: 14
lines >1 MB, ~1.3 MB each — capture-image / tool payloads), and the history path
still has to touch those bytes. The oversize-line bound
(`src/cli/lib/session-oversize.ts`) stops them from being *parsed* per request, but
the fat payloads are still *in* the transcript, so every reader still reads past
them and any future concurrency/allocation gap has multi-MB fuel again.

## Direction

Stop letting multi-MB payloads land in transcript entries the history path serves at
all — **strip or sidecar them at write or render time** (e.g. store the payload once
as an asset/ref and keep only a pointer in the transcript line, so the history read
never carries the bytes). Bounds the transcript-line size at the source rather than
defending against it on every read.

## Half of this is done; the "at write" half is not available (2026-08-25)

**Render-time addressing landed.** A stripped image now comes back as a
reference the client can resolve (`shared/session-media.ts`,
`webapp/routes/api-session-media.ts`), so the bytes leave the history read
entirely and are fetched per image, lazily, only when looked at. That is the
part of this direction that was reachable, and it closed
[reloaded-conversation-hides-the-photos-you-sent](../bugs/2026-08-24-reloaded-conversation-hides-the-photos-you-sent.md)
without weakening the read guard.

**"At write" is not ours to do.** The transcript is written entirely by the
Claude Code subprocess to `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`;
this codebase only ever reads it (`core/chat/session/transcript-sync.ts` waits
on the SDK's flush rather than performing it). There is no write hook to
sidecar at. The SDK's `sessionStore` option is a *secondary* mirror that fires
after the local write, so it cannot bound the local line either. Rewriting the
file behind the SDK's back would put us in a race with its own resume reads.

## What remains

1. **The raw line is still materialized.** `readline` builds the whole 1.3 MB
   string before `stripInlineMedia` can drop anything from it — the module says
   so itself. A chunked line assembler that elides base64 runs *while* reading
   would never allocate the payload at all. `cli/lib/session-line-scan.ts` now
   does byte-level scanning for the media route and is the shape to generalize.
2. **Four other transcript readers have no oversize guard at all** and
   `JSON.parse` fat lines whole: `getSessionMetadata` (`cli/lib/session.ts:196`),
   `session-snippet.ts:74`, `chat/session/backfill.ts:22`, and
   `chat/session/deliver-user-message.ts:95`. None is on the web hot path — the
   worst is chat review, a scheduled job — but the bound belongs in a shared
   reader rather than in `parseSessionLog` alone.

## Related

- [chat-history-parse-transient-oom](../bugs/2026-08-04-chat-history-parse-transient-oom.md)
  — the closed parent (directions 1–3 landed + verified).
- The bounded-retention design: `beebox/docs/implemented-plans/chat-history-oom-mobile-lock.md`.
- Sibling unbounded-bytes items: `turn-buffer-bounds-frames-not-bytes`,
  `session-retention-counts-entries-not-bytes`.
