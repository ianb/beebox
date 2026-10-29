---
title: "A recurring calendar series older than 500 occurrences shows no upcoming events"
workstream: unattached
area: beebox
labels: [calendar]
filed-by: agent
discovered-by: agent
discovered-in: worktree-calendar-cards — cross-model plan review of the calendar card page
---

`expandRecurring` (`src/connectors/google-calendar/utils.ts`) walks a series
from its first occurrence and stops after `MAX_EXPANSIONS = 500`, before it
checks the requested range. A daily series that began more than 500 days ago
is exhausted before it reaches today, so `bbx calendar` and the calendar
card's page show none of its upcoming occurrences, and nothing says a series
was cut short.

A fix could start the iterator near the range start, or count only
occurrences inside the range toward the limit, and report a series that still
hits the limit.
