---
title: "\"The open chat is in another place. Go to ...\" reads like an error"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, D-chemistry journey walks, 2026-10-09
---

When a place page sits beside a chat from another place, the page replaces its
"Start something" buttons with one line and a button: "The open chat is in
another place." and "Go to Loans".

- A-lending: "not sure what that means; the chat is right here". Later: it
  "reads like an error message". After the click the walker was surprised that
  the conversation was replaced by a fresh, empty chat and assumed the old one
  was "still somewhere".
- D-chemistry (second walk): the line took three readings to understand.

## Mechanism

The text is fixed copy (`beebox/src/frontend/src/components/PlaceView/view.tsx:112`),
shown by `startSomething` when the chat's `contextDir` differs from the page's
place (`beebox/src/frontend/src/components/openers/place-chat.ts:46`). The
behavior is as designed (decision b of
[landmark arrival](../../beebox/docs/implemented-plans/landmark-arrival.md)). The
words are the defect. "Place" is not a word the person uses, the line says
nothing is wrong yet sounds as if it is, and the button does not say it opens
that place's own chat and leaves this one. The button calls the same hook as the
place menu (`useOpenLandmarkChat`), so the old conversation stays in Recent
chats but is not the one that opens.

Related: [chats-bind-to-a-landmark-once-and-never-move](2026-08-25-chats-bind-to-a-landmark-once-and-never-move.md)
(why the conversation does not follow the person to the new place).

Reports: [A-lending](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) rows 24, 37, and 62,
[D-chemistry second walk](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) row 40.
