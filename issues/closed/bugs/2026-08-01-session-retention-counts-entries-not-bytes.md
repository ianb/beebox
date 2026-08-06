---
title: "Session-log retention is bounded by entry count, not bytes"
area: callback-box
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — Codex review of Track A
resolution: implemented
---

> **Fixed in `9c578c78`** (merged `26f95c78`). Added a generous 32 MiB
> `MAX_RETAINED_BYTES` co-limit alongside the entry count in `session-retention.ts`:
> per-entry serialized size is tracked as a running total, tail-mode evicts on
> whichever limit trips first, page-mode clips at the byte budget (`hasMore` reflects
> it), the graft window is byte-bounded too, and evicted slots are cleared so large
> payloads become collectible. Mirrors the sibling turn-buffer byte budget. Doctest
> + typecheck green.

`parseSessionLog` no longer retains a whole transcript
(`callback-box/src/cli/lib/session-retention.ts`), which removes the OOM this
was filed against: retention is now O(window) instead of O(file). But the
window is counted in *entries*, and one entry can be arbitrarily large — a
`Write` tool_use keeps the whole file body it wrote
(`cli/lib/session-content.ts`, `input` is retained verbatim) and an image block
keeps the whole base64 payload.

So the chat's `tail: 200` is bounded in entries and unbounded in bytes: 200
entries that each carry a few MB of pasted photo is still hundreds of MB. That
is a much smaller and much rarer exposure than the original bug (which scaled
with total transcript length, not with the window), but it is the same failure
class, and bulk photo uploads into a chat are a real pattern on this box.

Options, unsettled:

- A byte budget alongside the entry count: stop growing the window once the
  retained payload passes N MB, and report the shortfall (the response would
  then carry fewer than `tail` entries, which the frontend already tolerates —
  it drives "N earlier messages" off the exact `total`, not off the window).
- Drop `input`/`dataBase64` from *retained* entries and re-fetch a block's
  payload on demand (bigger change; the chat UI renders history images inline).
- Cap a single block's retained payload and mark it elided.

Not done inline with the incident fix: the bounded window is what stops the
observed failure, and byte-budgeting changes the response contract enough to
want its own design pass.
