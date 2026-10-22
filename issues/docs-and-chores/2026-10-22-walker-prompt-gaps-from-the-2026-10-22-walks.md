---
title: "Walker prompt gaps from the 2026-10-22 walks: return visits, time of day, screenshot names, turn waits, hidden text"
workstream: unattached
area: beebox
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — A-lending, C-reconnecting, G-paperwork and H-handover walks, 2026-10-22
---

Each item below changed what a walker recorded, and each is a line in `beebox/test/user-stories/journeys/walker-prompt.md` or a small `bin/browse` addition. The 2026-10-22 fixes (`6f1a200b9`, `5866397ff`, `6f22f4d8d`) covered invented events, scratch paths, discarded output, and fill quoting; these remain.

- **Coming back is the same browser session.** C's "come back later" was `open /` in the same session, the third C round with this (C row 31, H5). Fix: come back with a new `--session` name.
- **The persona's evening runs in the box's morning.** C's messages carried `07:40 CDT (morning)`; H's situation is also an evening (C H6, H "Time of day"). G's closing asks the walker to act "a few weeks from now" on a real clock (G H3). Fix: `prepare` tells the walker the box's local time, journeys avoid a time of day, or the closing asks about "the next two weeks".
- **A screenshot name was reused.** C wrote `10-marisol-draft.png` twice, and the second write destroyed the only picture of the hidden-reply send (C H2). Fix: `bin/browse screenshot` refuses to overwrite a file in a run's `shots/`, or the prompt says each name is used once.
- **The wait loop waits for "Stop" to go.** The focus layout has no Stop button, so C's loop ended at once and captured mid-turn (C H3). Fix: a `bin/browse` wait that reads turn state, or a documented wait on the "Thinking…" band.
- **Snapshot and `eval` text include what is not on screen.** A's walker read accessible names and a zero-size footer as visible UI, as on 2026-10-09 (A row 2, H5). Fix: the prompt says that the screenshot is the record of what a person sees.

Reports: [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-22.md), [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md), [G-paperwork](../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md), [H-handover](../../beebox/test/user-stories/journeys/H-handover/reports/2026-10-22.md) (Harness defects sections).
