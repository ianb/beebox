---
title: "The landmark menu takes ~22 s to open after a server restart, waiting on a Codex repair scan it does not need"
workstream: place-menu-speed
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

## Resolution (2026-10-05, workstream place-menu-speed)

The 25 "missing" threads were not missing. Each had its rollout file and a
row in Codex's state database. Codex recorded the cwd each thread started
in, and these started before the one-root migration, so their cwd is the v2
`<box>/content/...` path. `thread/list` filters on exact cwd, so the listing
(which asked only for v3 cwds) excluded them. The repair scan cannot fix a
cwd filter, so it found nothing. As a result, all 25 husks listed as dead in
the chats picker and the Landmarks page although they could be resumed.

Changes:

1. `listCodexThreadMetadata` also asks for each cwd's retired v2 aliases
   (`retiredV2ContentCwds`, from the new inverse `v2ContentPathsFor` in
   `one-root-mapping.ts`; each candidate is checked against `mapV2Path`). On
   the measured box, all 39 Codex chats now list as live (before: 14), and
   no repair scan runs.
2. Ids that a repair scan looked for are recorded in
   `.beebox/codex-repair-attempted.json`, pruned to ids that still have
   husks, so a later process does not scan again for a thread that is
   really gone.
3. `chat.placeMenu` lists with `repairCodexIndex: false`. It never waits on
   the scan.
4. `PlacePill` warms `chat.placeMenu` in idle time again (restored
   `useIdlePrefetch`), so the first open renders rows without a wait.
5. An idle shared Codex history app-server no longer holds the Node process
   open (it is unref'd while idle). Before, a short-lived process that listed
   chats waited up to 30 s for the idle close.

Measured on the same box, cold process: `listSessionEntries` went from 13.7 s
to 1.2 s; warm stays ~0.2–0.5 s. Most of the remaining cold time is the
Codex app-server start (~1 s). The idle prefetch hides it from the menu.

Not changed: `loadLandmarkSummaries` still globs the whole box on each call
(0.3–0.5 s on this box). It is now the largest warm cost of the menu. A cached
landmark list invalidated by the box file watcher would remove it. That is a
separate change if the warm open still feels slow.
