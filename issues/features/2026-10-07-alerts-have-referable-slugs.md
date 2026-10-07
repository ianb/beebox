---
title: "Schedule alerts need a short, readable slug so the developer can refer to one"
workstream: unattached
area: schedules
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder reading the alerts page
---

The developer wants each alert on the dev dashboard's alerts page
(`/workstreams/alerts`) to have a unique slug they can quote when talking to
an agent ("what is knip-sweep-not-landed-3?").

Each alert record already has a unique id, for example `20261007-083752-51e8`
(timestamp plus a random suffix, in the schedule store's `alerts/` files),
but it is not memorable, and the alerts page does not show it. Today the
developer pastes the alert's title and schedule instead.

## Wanted

- A short, human-readable slug per alert, unique across all schedules, for
  example `<schedule>-<condition or short title>-<n>`
  (`knip-sweep-unlanded-2`). Stable for the alert's life, including when a
  standing condition updates the same record.
- Shown on the alerts page and in each alert's digest line and notification.
- Accepted by `bin/schedules` commands that take an alert (`resolve`, and any
  show or close command) and findable by an agent from the slug alone
  (`bin/schedules alerts show <slug>` or similar), so the developer's
  reference resolves to the record.

Questions: whether the slug replaces the id in the filename or sits beside
it; how to number repeats of the same condition; whether closed alerts keep
their slug for history.
