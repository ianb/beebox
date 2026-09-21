---
title: "Agent promises calendar delivery before checking availability"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey F newcomer walk
---

A newcomer asked what help was possible with a future neighbour meal. The
assistant offered to “Put it on your calendar” and remind them before shopping.
The person had already seen that Calendar was disabled and Google OAuth was
unconfigured, so they challenged the promise. The assistant then checked and
explicitly withdrew it. No event or reminder was created.

Screenshots 20 and 21 in the [journey F report](../../beebox/user-stories/journeys/F-newcomer/reports/2026-09-21.md)
show the promise and correction. The fresh fixture's `_config/box.json` has
only `agentBrowsing: owner`; no Google services are enabled. Missing services
default to disabled in `beebox/src/core/box/config.ts`. The Settings and Admin
screens independently showed the disabled service and unavailable OAuth host.

The defect is presenting an available delivery outcome before checking the
current box, not the absence of an optional integration. A local calendar
file is not delivery to the person's phone calendar. The correction's claims
about a never-run scheduler and closed-page reminders were not independently
verified; do not treat those claims as established mechanisms.

Keep generic possible uses distinct from capabilities available here now.
This one run verifies an output reliability failure, not a deterministic
prompt cause. No product or prompt fix was attempted. The meal itself,
external accounts, notifications and future delivery were not tested.
