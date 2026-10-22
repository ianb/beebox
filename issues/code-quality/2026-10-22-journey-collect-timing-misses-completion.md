---
title: "Journey collect.ts timing counts interim lines as first text and does not report turn completion"
workstream: unattached
area: beebox
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — F-newcomer, I-deciding and C-reconnecting walks, 2026-10-22
---

`collect.ts` reports first-response time per turn from the box transcript. Three gaps showed in this round:

- Two of three I-deciding "first text" values (67 s, 65 s) were the silent-turn interim line ("I'm still checking prices…"), not the answer. Completion was 152 s and 97 s, and nothing reported it.
- In F-newcomer one turn lost 8 s between the hub's "Sending message" and the transcript's user message, so the measured time started late.
- Seven walks ran at once on one server; CLI calls took 15-27 s in C. Times are not comparable across rounds, and the run does not record load.

The box's `.beebox/hub-child.log` has "Sending message" and "Turn complete" lines that give both ends of a turn.

Reports: [I-deciding](../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (H4), [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (H8), [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (H7).

## Fix direction

Report, per turn, the time from the hub's send to the first answer text and to completion, and mark an interim line as such. Record the number of concurrent walks, or the machine load, with the run.
