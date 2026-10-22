---
title: "Agent promises calendar delivery before checking availability"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey F newcomer walk
priority: backlog
---

A newcomer asked what help was possible with a future neighbour meal. The
assistant offered to “Put it on your calendar” and remind them before shopping.
The person had already seen that Calendar was disabled and Google OAuth was
unconfigured, so they challenged the promise. The assistant then checked and
explicitly withdrew it. No event or reminder was created.

Screenshots 20 and 21 in the [journey F report](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-09-21.md)
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

## 2026-09-26 (notifications workstream)

Partly addressed, not closed. The notifications work added `bbx notify
--check` and an agent-guide rule — *"Before you promise a reminder or a
watch, run `bbx notify --check`. If nothing can reach the person, say so
instead of promising."*
(`beebox/src/core/agent-guide/guide/reaching.ts`) — that covers the
notify/remind promise class generically. It does not check Calendar/Google
OAuth availability specifically, so the calendar-delivery promise this issue
reports is not directly covered; that needs its own check at the point an
agent offers calendar delivery.

## Re-encounter 2026-10-08 (journey walks)

Seen in two walks. [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (rows 6, 9): turn 1 promised "gentle reminders" with no tool call, and turn 2 offered Google Calendar reminders and to "put the lunch on your calendar" without checking. The box had no `googleServices` in `_config/box.json` (`calendar.available failed` in `hub-child.log`). [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (rows 93, 101): the notify class recurred despite the guide rule. A real `notify` schedule card existed with no channel and no scheduler; a fresh chat read it and said "I'll send you a reminder" without running `bbx notify --check`. The rule did not trigger when the agent described an existing reminder. Its correction, "it will only open a new chat in here", is also wrong: with no channel the run fails with `ScheduledNotificationUndeliveredError` (`core/schedule/run-action.ts:74-80`). The calendar promise itself did not recur in F. The priority may be stale given the recurrence.

## Re-encounter 2026-10-09 (journey walks)

Seen again in three walks, in two forms. [A](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) (R2): the first reply offered to "set reminders, sync with your calendar and email" on a box with neither; the session held no `mcp__` tools, so the offer came from the box docs. [C](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) (row 31): "I can also remind you this evening to send it." (11:45:15) after a turn that ran no `bbx notify --check`; the guide requires one first (`beebox/src/core/agent-guide/guide.md:457`). Turn 11 ran the check and withdrew the offer. [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (row 13): the agent did run `notify --check` first and said there was no channel, but then offered to "set up notifications so reminders reach your phone", which it cannot do and said two turns later it did not know how. This is a new form: an offer to set up delivery, not a promise of delivery. The priority may be stale given the repeat.

## Re-encounter 2026-10-22 (journey walks)

Seen in four of seven walks; the priority may be stale given the repeats.

- [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-22.md) (row 10): the first reply offered "Nudge you to ask for things back. For example, I could remind you to text Idris about the stove a few weeks before your next trip." The agent had not run `bbx notify --check`. It ran the check on the next turn, after the person said "Reminders sound good", then withdrew the offer and made a dated todo.
- [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (rows 9, 24), both forms, fourth C walk with this. Turn 1: "Want me to set a reminder for this evening so you don't lose the moment?" with no check. Turn 6: "If she says yes, I can also put the dinner on your calendar." The box has no connectors and no `googleServices`. The walker: "'your calendar' makes me wary: which calendar?" Turn 11 ran the check and reported the failure plainly.
- [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (row 19), a deferred form: the agent ran the check, said nothing could reach the person, and made no reminder card. Then it said "Once you've turned them on … I'll set it up to come every Thursday", and repeated the promise twice. Nothing tells the agent when a channel is turned on, and no card records the promise.
- [H-handover](../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (row 34): asked to put a party on the calendar, the agent wrote an `.ics` file and said it "will go across to Google Calendar at the next sync". The box has no connectors and no Google services. A cause in the guidance: the calendar skill says sync with Google Calendar "is **two-way**" with no condition (`beebox/src/core/box/guidance-sync/skills/content.ts:27`), and the guide's calendar template says the same (`beebox/src/schemas/guide/templates.tsx:86`). The walker: "Tomas's Google or mine?"
- Did not recur in [G-paperwork](../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) (rows 4, 34), where reminders were the person's main goal: the agent checked first and promised nothing.

The sessions had no `mcp__` tools, so each offer came from the agent's own reading of the guidance.
