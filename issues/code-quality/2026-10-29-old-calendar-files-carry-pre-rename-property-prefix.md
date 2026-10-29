---
title: "Calendar files synced before the product rename carry calendar properties nothing reads"
workstream: unattached
area: beebox
labels: [calendar]
filed-by: agent
discovered-by: agent
discovered-in: worktree-calendar-cards — reading the test box's event files
---

Event files written before the product rename carry the calendar id, name,
and role under the old product's property prefix instead of `X-BBX-CALENDAR-*`.
Nothing reads the old prefix (`extractMeta` and `icsToGoogleEvent` read only
`x-bbx-calendar-*`), so `bbx calendar` cannot show which calendar such an
event is from. Since the calendar-folders change the folder decides the
calendar, so sync is unaffected; only display metadata is missing.

A pull rewrites a file with the current prefix, but only for events Google
returns, so untouched old events keep the old properties. Rewriting them in
place changes the file's bytes, which the connector reads as a local edit and
pushes; a fix has to re-stamp the recorded hash for files that matched it.
