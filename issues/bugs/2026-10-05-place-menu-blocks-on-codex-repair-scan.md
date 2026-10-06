---
title: "The landmark menu takes ~22 s to open after a server restart, waiting on a Codex repair scan it does not need"
workstream: unattached
area: beebox
labels: [codex, performance]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder noticed the landmark menu is slow
---

The landmark menu (`chat.placeMenu`,
`beebox/src/webapp/trpc/routers/chat/place-menu-procedure.ts`) is slow to
open. It loads lazily on first open (`PlacePill.tsx`: nothing prefetches it
since ChatPage was replaced), so the boxholder waits for the whole query.

## Measured (2026-10-05, a local box: 91 landmarks, 205 chats, 39 Codex)

| Step | Time |
|---|---|
| `loadLandmarkSummaries` (whole-box glob, read 91 cards) | 0.3–0.5 s |
| Chat husks and engine resolution | 0.1 s |
| Codex app-server thread list, cold | 1.4 s |
| **Codex repair scan** (`listThreadPages(..., repair: true)`) | **~22 s** |
| Whole query, warm (second run in the same process) | ~0.5 s |

## Cause

`placeMenu` calls `listSessionEntries`, which goes through `enumerateChats`
(`core/chat/session/list/core.ts`) and `listCodexThreadMetadata`
(`core/chat/session/codex-transcript.ts:330`). On this box, 25 of 39 Codex
chats are absent from Codex's thread index (likely archived, cleaned up, or
from an older Codex version). Any absent id triggers a full repair scan. The
"already attempted" set (`repairAttempted`, line 321) lives in memory, so every
server process pays it again on its first enumeration, and the scan does not
find those threads anyway. In development the box server restarts on every
rebuild.

## Fix

1. The menu draws only per-landmark counts of fresh chats and recency. It
   should not wait on Codex at all: use the husk's or transcript's own mtime,
   or at least never run the repair scan from `placeMenu`.
2. Make a failed repair durable: record ids that the repair scan could not
   find (on disk, per box) so later processes skip the scan for them, or
   classify those chats as dead. This also speeds the Landmarks page and the
   chats picker, which share the enumeration.
3. Restore an idle prefetch of the menu after page load, as `PlacePill.tsx`'s
   comment describes.
4. Minor: `loadLandmarkSummaries` globs the whole box on each call. It is not
   the bottleneck here, but check whether the landmark list can be cached or
   watched.
