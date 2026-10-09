---
title: "Box docs do not say how a person turns on notifications"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — F-newcomer journey walks, 2026-10-09
---

In the F-newcomer walk, the walker asked how notifications are set up. The agent grepped `box-docs` five times (transcript 12:26:50-12:27:03) and could not answer. It then filed its own system-feedback card, `_bookkeeping/system-feedback/Notification_Setup_Undocumented.doc.card` (box commit `d599eaa`). The card is accurate. This is the second F walk with the gap (2026-10-08 row 54).

What the docs say today: `beebox/box-docs/bbx-commands.md` ("bbx notify", from line 596) and the agent guide's REACHING_THE_BOXHOLDER section (`beebox/src/core/agent-guide/guide/reaching.ts`) cover how to send a notification and how to check for a channel. Neither says how a person enables a channel or where: Admin > Overview > Host > Notifications, or Settings > iOS Companion.

Also seen: the agent offered to "set up notifications so reminders reach your phone" right after `bbx notify --check` returned no channel. It has no way to do that. That form of the problem belongs to [agent-promises-unconfigured-calendar-delivery](../bugs/2026-09-21-agent-promises-unconfigured-calendar-delivery.md).

Direction: add the enable steps to the agent guide and `bbx-commands.md`, so the agent can tell the person where to go. Evidence for the wider design in [notifications-and-proactive-design](../features/2026-09-25-notifications-and-proactive-design.md).

Report: [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (rows 33-36).
