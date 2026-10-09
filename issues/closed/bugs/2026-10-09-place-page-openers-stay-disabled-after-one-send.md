---
title: "Opener buttons on a place page stay disabled after one is sent"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending journey walk, 2026-10-09
resolution: implemented
---

Fixed on worktree-journey-walks-oct: the place page passes its openers as
standing shortcuts (`ChatOpeners` `standing`). They disable while the chat
beside the page is busy with a turn and enable again when it ends. The empty
chat keeps its once-only latch. Verified in a browser on the A-lending box: one
opener sent beside the started Loans chat, the buttons disabled during the
turn, then enabled.

In the A-lending walk the person had a Loans chat open beside the Loans place
page. They sent "What should I chase this week?" from one of the page's three
"Start something" buttons. Later all three buttons were greyed out. The walker
wrote that the buttons "only work on a fresh chat", and that "I just lent
something" did nothing. The walker's explanation is wrong. A fresh mount shows
the buttons enabled again (reproduced in a second browser session).

## Mechanism

`ChatOpeners` keeps a `sent` flag and disables every button once one send is
accepted (`beebox/src/frontend/src/components/openers/ChatOpeners.tsx:49,59`).
The comment on the component assumes the list unmounts a moment later, once the
first message lands (`ChatOpeners.tsx:15-16`). That holds for the unstarted
chat. It does not hold on a place page: the page shows the openers when the
chat beside it is the same place and already started
(`beebox/src/frontend/src/components/openers/place-chat.ts:46-47` hides them
only while the chat shows its own). So the list stays mounted and the flag is
never reset.

## Why the fix is not obvious

The flag guards a double click while the first send is in flight. On a place
page the buttons are standing shortcuts, so the guard should clear when the
send settles. Alternatively the page can hide the buttons once the chat has
started in this place. That second option is a design call: the landmark-arrival
plan decided when "Start something" shows
([landmark arrival](../../../beebox/docs/implemented-plans/landmark-arrival.md),
decision b).

Related: [fresh-chat-reservation-suppresses-openers](2026-09-21-fresh-chat-reservation-suppresses-openers.md) (closed).

Report: [A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) row 46.
