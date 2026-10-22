---
title: "The first screen shows the root question twice and does not say they are one question"
workstream: unattached
area: beebox
labels: [onboarding]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — C-reconnecting and F-newcomer walks, 2026-10-22
---

A new box shows its root question in more than one place on the first view:

- The Box page's count line: "1 question waiting" (`RootCounts`, `beebox/src/frontend/src/components/PlaceView/view.tsx:86-114`).
- A nav badge: "1".
- The empty chat: "What do you want to keep track of here?" with its memo (`OpenQuestionLine`, `beebox/src/frontend/src/components/chat/EmptyChat.tsx:16-40`).

Nothing says that the count and the chat line are the same question. Both walkers answered the question in the chat without knowing it:

- C-reconnecting, at the end: "'1 question waiting' at the top: I never found out what it asked."
- F-newcomer asked "who is asking?" at the start, and at the end still asked where it went. The reply to the answering message reflected the purpose back but did not say that a question was answered. The count and the badge went away.

Reports: [C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (row 4; shot 01), [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (row 3; shot 01).

## Why the fix is not obvious

The count is right and goes away when the question is answered. Options: leave the root question out of the count while the empty chat shows it; name the question in the count line; or, when a chat message answers an open question, show that it was answered.

Related: [root question left pending when the first message is a task](2026-10-22-root-question-left-pending-when-first-message-is-a-task.md) (the opposite outcome: the question stays), [first-run experience](../features/2026-07-20-first-run-experience.md).
