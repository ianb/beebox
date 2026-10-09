---
title: "Admin Notifications description names only health alerts and questions, not reminders"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — F-newcomer journey walks, 2026-10-09
---

The Admin Notifications section says: "Get a push notification on this device when the box needs you — health alerts and questions waiting for an answer." (`beebox/src/frontend/src/components/admin/NotificationsSection/view.tsx:26-27`). Scheduled `notify:` reminders and `<callout loudness>` outcomes also push (`beebox/src/core/chat/callout-tags.ts`; REACHING_THE_BOXHOLDER in the agent guide). In the F-newcomer walk the walker could not tell whether enabling the setting would bring the Tuesday reminder.

Fix direction: name reminders and agent notes in the description. Check the wording against what the design in [notifications-and-proactive-design](../features/2026-09-25-notifications-and-proactive-design.md) settles on.

Report: [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (row 49, shot 17).
