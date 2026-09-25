---
title: "Calendar setup surfaces a raw host error and box.json instruction"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — F newcomer journey
priority: normal
---

The Settings path gives a boxholder implementation details without a usable
setup explanation. Calendar setup can point at `_config/box.json` and
`googleServices.calendar: true`, while Admin can only say “Google OAuth is not
configured on this host”. The boxholder cannot tell what access is requested,
which calendar is selected, or which operator must configure the host.

## Research (2026-09-21)

- `beebox/src/frontend/src/components/settings/CalendarSection.tsx:73-83`
  renders the query error and a link to Admin; lines 98-106 describe `.ics`
  pulls during `bbx wakeup`.
- `beebox/src/frontend/src/components/admin/GoogleServicesSection.tsx:79-81`
  renders the literal host-configuration error.
- `beebox/src/core/box/config.ts:56-61,130-137` confirms that missing
  `googleServices` disables the service and that `calendar: true` is the box
  policy gate.
- F's `_config/box.json` has only `agentBrowsing: "owner"`; it has no
  `googleServices` key. Screenshot 07 matches the host error. No calendar
  event or reminder was created.

This report does not claim that scheduled work cannot run while the page is
closed. It records the setup and explanation gap only.

Evidence: [journey F report](../../beebox/user-stories/journeys/F-newcomer/reports/2026-09-21.md).
