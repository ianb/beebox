---
title: "Many pending questions: which one opens beside a new chat, and how often one returns"
workstream: front-door
needs: [design]
area: beebox
labels: [questions, chat]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-front-door — 2026-10-25 discussion of questions beside the chat
---

## What the boxholder said

> If it backs up some (lots of pending questions) it'll open interesting
> questions about how to deal with these.

(Boxholder, 2026-10-25.)

## Where it stands

A new root chat opens the newest pending question beside the chat
(`beebox/docs/questions.md`, "Beside a new chat"). Closing its tab dismisses
it, so the next new chat opens the next newest. The test box holds about
forty pending questions, most filed by triage and scan runs, so a person who
opens chats often meets a different question each time until the queue is
empty or aging expires them at 30 days.

## Open questions

- Which question to pick: newest, oldest, the root question first, a
  question filed for the chat, or one the person is most likely to answer.
- Whether an ignored question (the person typed something unrelated) should
  open again in the next chat, or wait.
- Whether a large backlog should open the Questions page instead, or a
  count, and what "Next question" after an answer would be.
- Whether a long, old agent question is ever the right opening (the
  boxholder's first report was such a question).

Deferred from `beebox/docs/plans/questions-beside-the-chat.md` (NOT in
scope).
