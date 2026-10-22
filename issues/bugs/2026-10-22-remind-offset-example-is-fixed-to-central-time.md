---
title: "bbx remind's no-timezone error suggests -06:00 for every box"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — C-reconnecting walk, 2026-10-22
---

`bbx remind --at 2026-11-05T18:00` on a box with no `timezone` fails with "add an offset (…Z for UTC, or 2026-11-05T18:00-06:00)". The `-06:00` is fixed text (`beebox/src/cli/commands/remind/time.ts:94`). The agent copied it. By chance that was right for 5 November in US Central. An agent on a box in another zone that copies the example sets the wrong hour.

A new box has no `timezone` in `_config/box.json`. Each chat message already carries the client's zone (`local-time="… CDT"`).

Report: [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (R5).

## Why the fix is not obvious

Options: drop the example offset; derive it from the zone on the latest chat message; or set the box timezone from the first web client. The last option changes box config without the person asking.
