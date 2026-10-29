---
title: "Saving calendar settings drops the cached calendar names and roles"
workstream: unattached
area: beebox
labels: [calendar, settings]
filed-by: agent
discovered-by: agent
discovered-in: worktree-calendar-cards — cross-model plan review
---

The settings mutation `calendar.updateConfig`
(`src/webapp/trpc/routers/calendar.ts`) builds a new config with only
`calendars`, `syncDaysBack`, and `syncDaysForward` and passes it to
`saveCalendarConfig`, which overwrites the file. The cached `calendarNames`
and `calendarRoles` the sync wrote are lost until the next sync restores them.

Anything that reads those caches between a settings save and the next sync
sees nothing: `bbx calendar calendars` labels, and the calendar-folders
migration, which names new calendar cards from the cache (it falls back to
the calendar id and leaves `access` out). The mutation could merge into the
existing config instead of replacing it.
