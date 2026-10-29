---
title: "A calendar should be a card, with its events under it"
workstream: calendar-cards
area: beebox
labels: [calendar, connectors, cards]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-plugins-planning — plugins slice 3 discussion, 2026-10-10
resolution: implemented
---

> **Closed:** Closed by the calendar-cards workstream (merged to main). Each synced calendar is a `calendar` card with its events as `.ics` files in the card attach folder; migration `calendar-folders-2026-10` moves existing files. See beebox/docs/connectors/calendar.md.

Today a calendar is a bare directory of `.ics` files under `_content/calendar/`,
written by the Google Calendar connector. The connector declares a
`calendar-event` type (`src/connectors/google-calendar/connector.ts:72`) that
has no card schema, so there is no card for the calendar and none for an
event. Email already has its card shape (`email-thread`, `email-message`,
`email-outbound`), which is why email is a universal format other connectors
can fill and calendar is not yet.

The boxholder's thought: a calendar should be a card, and its events sit
under it. Whether each event is also a card, or the `.ics` files stay as they
are under the calendar card, is the open question. The event files are a
format other connectors (CalDAV, an `.ics` subscription) could fill, so
keeping them as `.ics` is the lean.

Not needed for the plugins connector slice: a connector plugin can keep
writing `.ics` files into the directory. This is a product question for
another day.

Related: [caldir calendar-as-a-directory](../exploration/2026-09-17-caldir-calendar-as-a-directory.md),
[.ics filenames carry the title](2026-09-17-calendar-ics-filenames-carry-the-title.md).
