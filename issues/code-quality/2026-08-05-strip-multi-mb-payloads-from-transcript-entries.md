---
title: "Keep multi-MB payloads out of transcript entries the history path serves (strip/sidecar at write or render)"
area: callback-box
filed-by: agent
discovered-in: main session — direction 4 spun out of the closed chat.history parse-OOM bug
---

Follow-up hardening from
[chat-history-parse-transient-oom](../closed/bugs/2026-08-04-chat-history-parse-transient-oom.md),
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

## Related

- [chat-history-parse-transient-oom](../closed/bugs/2026-08-04-chat-history-parse-transient-oom.md)
  — the closed parent (directions 1–3 landed + verified).
- The bounded-retention design: `callback-box/docs/implemented-plans/chat-history-oom-mobile-lock.md`.
- Sibling unbounded-bytes items: `turn-buffer-bounds-frames-not-bytes`,
  `session-retention-counts-entries-not-bytes`.
