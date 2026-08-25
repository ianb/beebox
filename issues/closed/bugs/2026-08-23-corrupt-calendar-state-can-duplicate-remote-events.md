---
title: "Corrupt Calendar state can duplicate remote events"
workstream: connector-integrity
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-sync-isolation — independent review of Calendar failure isolation
priority: normal
resolution: implemented
---

**Closed 2026-08-25** in ca356806: `saveCalendarState` writes atomically; `loadCalendarState` tolerates only ENOENT and throws `CalendarStateCorruptError` otherwise, so the sync fails before any push. Doctest: corrupt state → no insert.

`saveCalendarState` in `callback-box/src/connectors/google-calendar-state.ts` writes the persistent Calendar state with a plain truncate-and-write operation. An interrupted write can leave invalid JSON. `loadCalendarState` catches that parse error and returns empty `syncTokens` and `eventFiles` maps.

The empty `eventFiles` map is not a safe recovery value. `pushAndCleanOrphans` in `google-calendar-push.ts` treats every Calendar file absent from that index as a locally created event. A later sync can therefore insert copies of every existing local event into Google.

The recovery policy must fail closed. The implementation should use an atomic persistent-state write and must not convert a present but corrupt index into the same state as a new connector. A doctest should interrupt or corrupt the state write and prove that no remote insert is attempted.
